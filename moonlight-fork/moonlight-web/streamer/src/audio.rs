use std::sync::Weak;

use log::{debug, error, warn};
use moonlight_common::stream::{
    audio::AudioDecoder,
    bindings::{AudioConfig, Capabilities, OpusMultistreamConfig},
};

use crate::StreamConnection;

pub(crate) struct StreamAudioDecoder {
    pub(crate) stream: Weak<StreamConnection>,
}

impl AudioDecoder for StreamAudioDecoder {
    fn setup(
        &mut self,
        audio_config: AudioConfig,
        stream_config: OpusMultistreamConfig,
        _ar_flags: i32,
    ) -> i32 {
        let Some(stream) = self.stream.upgrade() else {
            warn!("Failed to setup audio because stream is deallocated");
            return -1;
        };

        {
            let mut stream_info = stream.stream_setup.blocking_lock();
            stream_info.audio = Some(stream_config.clone());
        }

        stream.runtime.clone().block_on(async move {
            let sender = stream.transport_sender.read().await;
            if let Some(sender) = sender.as_ref() {
                sender.setup_audio(audio_config, stream_config).await
            } else {
                error!("Failed to setup audio because of missing transport!");
                -1
            }
        })
    }

    fn start(&mut self) {}
    fn stop(&mut self) {}

    fn decode_and_play_sample(&mut self, data: &[u8]) {
        let Some(stream) = self.stream.upgrade() else {
            warn!("Failed to send audio sample because stream is deallocated");
            return;
        };

        stream.runtime.clone().block_on(async move {
            let sender = stream.transport_sender.read().await;

            if let Some(sender) = sender.as_ref() {
                if let Err(err) = sender.send_audio_sample(data).await {
                    warn!("Failed to send audio sample: {err}");
                }
            } else {
                debug!("Dropping audio packet because of missing transport");
            }
        });
    }

    fn config(&self) -> AudioConfig {
        AudioConfig::STEREO
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities::empty()
    }
}
