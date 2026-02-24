use std::{
    marker::PhantomData,
    sync::atomic::{AtomicUsize, Ordering},
};

use bytes::Bytes;
use log::{LevelFilter, info, trace, warn};
use pem::Pem;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::{
    io::{
        AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader, Lines, Stdin, Stdout,
    },
    process::{ChildStderr, ChildStdin, ChildStdout},
    spawn,
    sync::mpsc::{Receiver, Sender, channel},
};

use crate::{
    api_bindings::{StreamClientMessage, StreamServerMessage},
    config::WebRtcConfig,
};

#[derive(Debug, Serialize, Deserialize)]
pub struct StreamerConfig {
    pub webrtc: WebRtcConfig,
    pub log_level: LevelFilter,
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Serialize, Deserialize)]
pub enum ServerIpcMessage {
    Init {
        config: StreamerConfig,
        host_address: String,
        host_http_port: u16,
        client_unique_id: Option<String>,
        client_private_key: Pem,
        client_certificate: Pem,
        server_certificate: Pem,
        app_id: u32,
        video_frame_queue_size: usize,
        audio_sample_queue_size: usize,
    },
    WebSocket(StreamClientMessage),
    WebSocketTransport(Bytes),
    Stop,
}

#[derive(Debug, Serialize, Deserialize)]
pub enum StreamerIpcMessage {
    WebSocket(StreamServerMessage),
    WebSocketTransport(Bytes),
    Stop,
}

// We're using the:
// Stdin: message passing
// Stdout: message passing
// Stderr: logging

static CHILD_COUNTER: AtomicUsize = AtomicUsize::new(0);

pub async fn create_child_ipc<Message, ChildMessage>(
    log_target: &str,
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: Option<ChildStderr>,
) -> (IpcSender<Message>, IpcReceiver<ChildMessage>)
where
    Message: Send + Serialize + 'static,
    ChildMessage: DeserializeOwned,
{
    let id = CHILD_COUNTER.fetch_add(1, Ordering::Relaxed);
    let log_target = format!("{log_target} {id}");

    if let Some(stderr) = stderr {
        let log_target = log_target.clone();

        spawn(async move {
            let buf_reader = BufReader::new(stderr);
            let mut lines = buf_reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                info!("{log_target}: {line}");
            }
        });
    }

    let (sender, receiver) = channel::<Message>(10);

    let sender_log_format = format!("{log_target}: ");
    spawn(async move {
        ipc_sender(stdin, receiver, &sender_log_format).await;
    });

    let log_target = format!("{log_target}: ");
    (
        IpcSender {
            sender,
            log_target: log_target.clone(),
        },
        IpcReceiver {
            errored: false,
            read: create_lines(stdout),
            phantom: Default::default(),
            log_target,
        },
    )
}

pub async fn create_process_ipc<ParentMessage, Message>(
    stdin: Stdin,
    stdout: Stdout,
) -> (IpcSender<Message>, IpcReceiver<ParentMessage>)
where
    ParentMessage: DeserializeOwned,
    Message: Send + Serialize + 'static,
{
    let (sender, receiver) = channel::<Message>(10);

    spawn(async move {
        ipc_sender(stdout, receiver, "").await;
    });

    (
        IpcSender {
            sender,
            log_target: "".to_string(),
        },
        IpcReceiver {
            errored: false,
            read: create_lines(stdin),
            phantom: Default::default(),
            log_target: "".to_string(),
        },
    )
}
fn create_lines(
    read: impl AsyncRead + Send + Unpin + 'static,
) -> Lines<Box<dyn AsyncBufRead + Send + Unpin + 'static>> {
    (Box::new(BufReader::new(read)) as Box<dyn AsyncBufRead + Send + Unpin + 'static>).lines()
}

async fn ipc_sender<Message>(
    mut write: impl AsyncWriteExt + Unpin,
    mut receiver: Receiver<Message>,
    log_target: &str,
) where
    Message: Serialize,
{
    while let Some(value) = receiver.recv().await {
        let mut json = match serde_json::to_string(&value) {
            Ok(value) => value,
            Err(err) => {
                warn!("[Ipc]: failed to encode message: {err:?}");
                continue;
            }
        };

        trace!("{log_target}[Ipc] sending {json}");

        json.push('\n');

        if let Err(err) = write.write_all(json.as_bytes()).await {
            warn!("{log_target}[Ipc]: failed to write message length: {err:?}");
            return;
        };

        if let Err(err) = write.flush().await {
            warn!("{log_target}[Ipc]: failed to flush: {err:?}");
            return;
        }
    }
}

#[derive(Debug)]
pub struct IpcSender<Message> {
    sender: Sender<Message>,
    log_target: String,
}

impl<Message> Clone for IpcSender<Message> {
    fn clone(&self) -> Self {
        Self {
            sender: self.sender.clone(),
            log_target: self.log_target.clone(),
        }
    }
}

impl<Message> IpcSender<Message>
where
    Message: Serialize + Send + 'static,
{
    pub async fn send(&mut self, message: Message) {
        if self.sender.send(message).await.is_err() {
            warn!("{}[Ipc] failed to send message", self.log_target);
        }
    }
    pub fn blocking_send(&mut self, message: Message) {
        if self.sender.blocking_send(message).is_err() {
            warn!("{}[Ipc] failed to send message", self.log_target);
        }
    }
}

pub struct IpcReceiver<Message> {
    errored: bool,
    read: Lines<Box<dyn AsyncBufRead + Send + Unpin>>,
    phantom: PhantomData<Message>,
    log_target: String,
}

impl<Message> IpcReceiver<Message>
where
    Message: DeserializeOwned,
{
    pub async fn recv(&mut self) -> Option<Message> {
        if self.errored {
            return None;
        }

        let line = match self.read.next_line().await {
            Ok(Some(value)) => value,
            Ok(None) => return None,
            Err(err) => {
                self.errored = true;

                warn!("{}[Ipc]: failed to read next line {err:?}", self.log_target);

                return None;
            }
        };

        trace!("{}[Ipc] received {line}", self.log_target);

        match serde_json::from_str::<Message>(&line) {
            Ok(value) => Some(value),
            Err(err) => {
                warn!(
                    "{}[Ipc]: failed to deserialize message: {err:?}",
                    self.log_target
                );

                None
            }
        }
    }
}
