use std::process::Stdio;
use std::time::Instant;

use actix_web::{
    Error, HttpRequest, HttpResponse, get, post, rt as actix_rt,
    web::{Data, Json, Payload},
};
use actix_ws::{Closed, Message, Session};
use common::{
    api_bindings::{
        LogMessageType, PostCancelRequest, PostCancelResponse, StreamClientMessage,
        StreamServerMessage,
    },
    ipc::{ServerIpcMessage, StreamerConfig, StreamerIpcMessage, create_child_ipc},
    serialize_json,
};
use log::{error, info, warn};
use tokio::{process::Command, spawn};

use crate::app::{
    App, AppError,
    host::{AppId, HostId},
    user::AuthenticatedUser,
};

#[get("/host/stream")]
pub async fn start_host(
    web_app: Data<App>,
    mut user: AuthenticatedUser,
    request: HttpRequest,
    payload: Payload,
) -> Result<HttpResponse, Error> {
    let (response, mut session, mut stream) = actix_ws::handle(&request, payload)?;

    let client_unique_id = user.host_unique_id().await?;

    let web_app = web_app.clone();
    actix_rt::spawn(async move {
        let t0 = Instant::now();
        let t_plus = || format!("T+{}ms", t0.elapsed().as_millis());
        info!("[Stream-WS {}] WebSocket accepted, waiting for Init message...", t_plus());

        // -- Init and Configure
        let message;
        loop {
            message = match stream.recv().await {
                Some(Ok(Message::Text(text))) => text,
                Some(Ok(Message::Binary(_))) => {
                    return;
                }
                Some(Ok(_)) => continue,
                Some(Err(_)) => {
                    return;
                }
                None => {
                    return;
                }
            };
            break;
        }

        let message = match serde_json::from_str::<StreamClientMessage>(&message) {
            Ok(value) => value,
            Err(_) => {
                return;
            }
        };

        let StreamClientMessage::Init {
            host_id,
            app_id,
            video_frame_queue_size,
            audio_sample_queue_size,
        } = message
        else {
            let _ = session.close(None).await;

            warn!("WebSocket didn't send init as first message, closing it");
            return;
        };

        let host_id = HostId(host_id);
        let app_id = AppId(app_id);
        info!("[Stream-WS {}] Init received: host_id={:?}, app_id={:?}, video_queue={}, audio_queue={}",
              t_plus(), host_id, app_id, video_frame_queue_size, audio_sample_queue_size);

        // -- Collect host data
        let mut host = match user.host(host_id).await {
            Ok(host) => host,
            Err(AppError::HostNotFound) => {
                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because the host was not found"
                            .to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
            Err(err) => {
                warn!("failed to start stream for host {host_id:?} (at host): {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because of a server error".to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        info!("[Stream-WS {}] Host validated", t_plus());

        let apps = match host.list_apps(&mut user).await {
            Ok(apps) => apps,
            Err(err) => {
                warn!("failed to start stream for host {host_id:?} (at list_apps): {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because of a server error".to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        let Some(app) = apps.into_iter().find(|app| app.id == app_id) else {
            warn!("failed to start stream for host {host_id:?} because the app couldn't be found!");

            let _ = send_ws_message(
                &mut session,
                StreamServerMessage::DebugLog {
                    message: "Failed to start stream because the app was not found".to_string(),
                    ty: Some(LogMessageType::FatalDescription),
                },
            )
            .await;
            let _ = session.close(None).await;
            return;
        };

        info!("[Stream-WS {}] App found, fetching address...", t_plus());

        let (address, http_port) = match host.address_port(&mut user).await {
            Ok(address_port) => address_port,
            Err(err) => {
                warn!("failed to start stream for host {host_id:?} (at get address_port): {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because of a server error".to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        info!("[Stream-WS {}] Address fetched, getting pair info...", t_plus());

        let pair_info = match host.pair_info(&mut user).await {
            Ok(pair_info) => pair_info,
            Err(err) => {
                warn!("failed to start stream for host {host_id:?} (at get pair_info): {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because the host is not paired"
                            .to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        info!("[Stream-WS {}] Pair info fetched, launching streamer...", t_plus());

        // -- Send App info
        let _ = send_ws_message(
            &mut session,
            StreamServerMessage::UpdateApp { app: app.into() },
        )
        .await;

        // -- Starting stage: launch streamer
        let _ = send_ws_message(
            &mut session,
            StreamServerMessage::DebugLog {
                message: "Launching streamer".to_string(),
                ty: None,
            },
        )
        .await;

        // Spawn child
        let (mut child, stdin, stdout) = match Command::new(&web_app.config().streamer_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(mut child) => {
                if let Some(stdin) = child.stdin.take()
                    && let Some(stdout) = child.stdout.take()
                {
                    (child, stdin, stdout)
                } else {
                    error!("[Stream]: streamer process didn't include a stdin or stdout");

                    let _ = send_ws_message(
                        &mut session,
                        StreamServerMessage::DebugLog {
                            message: "Failed to start stream because of a server error".to_string(),
                            ty: Some(LogMessageType::FatalDescription),
                        },
                    )
                    .await;
                    let _ = session.close(None).await;

                    if let Err(err) = child.kill().await {
                        warn!("[Stream]: failed to kill child: {err}");
                    }

                    return;
                }
            }
            Err(err) => {
                error!("[Stream]: failed to spawn streamer process: {err}");

                let _ = send_ws_message(
                    &mut session,
                    StreamServerMessage::DebugLog {
                        message: "Failed to start stream because of a server error".to_string(),
                        ty: Some(LogMessageType::FatalDescription),
                    },
                )
                .await;
                let _ = session.close(None).await;
                return;
            }
        };

        // Take stderr before transferring child ownership to App
        let stderr = child.stderr.take();

        // Kill any previous streamer and register the new one.
        // This ensures only one streamer process runs at a time.
        web_app.replace_active_streamer(child).await;

        // Create ipc
        let (mut ipc_sender, mut ipc_receiver) = create_child_ipc::<
            ServerIpcMessage,
            StreamerIpcMessage,
        >(
            "Streamer", stdin, stdout, stderr
        )
        .await;

        // Redirect ipc message into ws
        spawn(async move {
            while let Some(message) = ipc_receiver.recv().await {
                match message {
                    StreamerIpcMessage::WebSocket(message) => {
                        if let Err(Closed) = send_ws_message(&mut session, message).await {
                            warn!(
                                "[Ipc]: Tried to send a ws message (text) but the socket is already closed"
                            );
                            break;
                        }
                    }
                    StreamerIpcMessage::WebSocketTransport(data) => {
                        if let Err(Closed) = session.binary(data).await {
                            warn!(
                                "[Ipc]: Tried to send a ws message (binary) but the socket is already closed"
                            );
                            break;
                        }
                    }
                    StreamerIpcMessage::Stop => {
                        info!("[Ipc]: ipc receiver stopped by streamer");
                        break;
                    }
                }
            }
            info!("[Ipc]: ipc receiver is closed");

            // close the websocket when the streamer crashed / disconnected / whatever
            if let Err(err) = session.close(None).await {
                warn!("failed to close streamer web socket: {err}");
            }
        });

        // Send init into ipc
        ipc_sender
            .send(ServerIpcMessage::Init {
                config: StreamerConfig {
                    webrtc: web_app.config().webrtc.clone(),
                    log_level: web_app.config().log.level_filter,
                },
                host_address: address,
                host_http_port: http_port,
                client_unique_id: Some(client_unique_id),
                client_private_key: pair_info.client_private_key,
                client_certificate: pair_info.client_certificate,
                server_certificate: pair_info.server_certificate,
                app_id: app_id.0,
                video_frame_queue_size,
                audio_sample_queue_size,
            })
            .await;

        info!("[Stream-WS {}] Streamer process launched, IPC Init sent. Forwarding WS messages to streamer.", t_plus());
        // Redirect ws message into ipc
        while let Some(Ok(message)) = stream.recv().await {
            match message {
                Message::Text(text) => {
                    let Ok(message) = serde_json::from_str::<StreamClientMessage>(&text) else {
                        warn!("[Stream]: failed to deserialize from json");
                        return;
                    };

                    ipc_sender.send(ServerIpcMessage::WebSocket(message)).await;
                }
                Message::Binary(binary) => {
                    ipc_sender
                        .send(ServerIpcMessage::WebSocketTransport(binary))
                        .await;
                }
                _ => {}
            }
        }
        info!("[Stream-WS {}] WebSocket closed (client disconnected or stream ended)", t_plus());

        // Signal the streamer to stop so it cleans up the Moonlight/Sunshine session
        // and exits. Without this, zombie streamer processes and Sunshine encoding
        // sessions accumulate, starving the CPU.
        ipc_sender.send(ServerIpcMessage::Stop).await;
    });

    Ok(response)
}

async fn send_ws_message(sender: &mut Session, message: StreamServerMessage) -> Result<(), Closed> {
    let Some(json) = serialize_json(&message) else {
        return Ok(());
    };

    sender.text(json).await
}

#[post("/host/cancel")]
pub async fn cancel_host(
    mut user: AuthenticatedUser,
    Json(request): Json<PostCancelRequest>,
) -> Result<Json<PostCancelResponse>, AppError> {
    let host_id = HostId(request.host_id);

    let mut host = user.host(host_id).await?;

    host.cancel_app(&mut user).await?;

    Ok(Json(PostCancelResponse { success: true }))
}
