use std::{sync::Weak, time::Duration};

use bytes::Bytes;
use log::{error, info, warn};
use moonlight_common::stream::bindings::{AudioConfig, OpusMultistreamConfig};
use tokio::runtime::Handle;
use webrtc::{
    api::media_engine::{MIME_TYPE_OPUS, MediaEngine},
    media::Sample,
    peer_connection::RTCPeerConnection,
    rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType},
    track::track_local::track_local_static_sample::TrackLocalStaticSample,
};

use crate::transport::webrtc::{WebRtcInner, sender::TrackLocalSender};

pub fn register_audio_codecs(media_engine: &mut MediaEngine) -> Result<(), webrtc::Error> {
    media_engine.register_codec(
        RTCRtpCodecParameters {
            capability: RTCRtpCodecCapability {
                mime_type: MIME_TYPE_OPUS.to_owned(),
                clock_rate: 48000,
                channels: 2,
                sdp_fmtp_line: "minptime=10;useinbandfec=1".to_owned(),
                rtcp_feedback: vec![],
            },
            payload_type: 111,
            ..Default::default()
        },
        RTPCodecType::Audio,
    )?;

    Ok(())
}

pub struct WebRtcAudio {
    sender: TrackLocalSender<TrackLocalStaticSample>,
    config: Option<OpusMultistreamConfig>,
}

impl WebRtcAudio {
    pub fn new(runtime: Handle, peer: Weak<RTCPeerConnection>, channel_queue_size: usize) -> Self {
        Self {
            sender: TrackLocalSender::new(runtime, peer, channel_queue_size),
            config: None,
        }
    }
}

impl WebRtcAudio {
    pub async fn setup(
        &mut self,
        inner: &WebRtcInner,
        audio_config: AudioConfig,
        stream_config: OpusMultistreamConfig,
    ) -> i32 {
        info!("[AUDIO-SETUP {}] ========== AUDIO SETUP STARTING ==========", inner.t_plus());
        info!("[AUDIO-SETUP] audio_config: {:?}", audio_config);
        info!("[AUDIO-SETUP] stream_config: sample_rate={}, samples_per_frame={}, channel_count={}, streams={}, coupled_streams={}",
              stream_config.sample_rate, stream_config.samples_per_frame,
              stream_config.channel_count, stream_config.streams, stream_config.coupled_streams);
        info!("[AUDIO-SETUP] Peer signaling state: {:?}", inner.peer.signaling_state());
        info!("[AUDIO-SETUP] Peer ICE connection state: {:?}", inner.peer.ice_connection_state());
        info!("[AUDIO-SETUP] Peer connection state: {:?}", inner.peer.connection_state());

        const SUPPORTED_SAMPLE_RATES: &[u32] = &[80000, 12000, 16000, 24000, 48000];
        if !SUPPORTED_SAMPLE_RATES.contains(&stream_config.sample_rate) {
            warn!(
                "[AUDIO-SETUP] Sample rate {} not in expected list {SUPPORTED_SAMPLE_RATES:?}",
                stream_config.sample_rate
            );
        }
        if audio_config != self.config() {
            warn!(
                "[AUDIO-SETUP] Different audio config than requested: expected {:?}, got {audio_config:?}",
                self.config()
            );
        }

        info!("[AUDIO-SETUP] Creating audio track...");
        if let Err(err) = self
            .sender
            .create_track(
                TrackLocalStaticSample::new(
                    RTCRtpCodecCapability {
                        mime_type: MIME_TYPE_OPUS.to_string(),
                        ..Default::default()
                    },
                    "audio".to_string(),
                    "moonlight".to_string(),
                ),
                |_| {},
            )
            .await
        {
            error!("[AUDIO-SETUP] FAILED to create opus track: {err:?}");
            return -1;
        };

        info!("[AUDIO-SETUP {}] Audio track created successfully", inner.t_plus());
        info!("[AUDIO-SETUP] Peer signaling state AFTER track creation: {:?}", inner.peer.signaling_state());
        info!("[AUDIO-SETUP] Peer ICE connection state AFTER track creation: {:?}", inner.peer.ice_connection_state());

        self.config = Some(stream_config);
        info!("[AUDIO-SETUP] Config stored");

        // Renegotiate to inform browser about the new audio track
        info!("[AUDIO-SETUP {}] ========== STARTING RENEGOTIATION ==========", inner.t_plus());
        info!("[AUDIO-SETUP] About to call inner.send_offer()");
        info!("[AUDIO-SETUP] Peer signaling state BEFORE renegotiation: {:?}", inner.peer.signaling_state());
        info!("[AUDIO-SETUP] Peer ICE connection state BEFORE renegotiation: {:?}", inner.peer.ice_connection_state());
        info!("[AUDIO-SETUP] Peer ICE gathering state BEFORE renegotiation: {:?}", inner.peer.ice_gathering_state());

        let renegotiation_result = inner.send_offer().await;

        info!("[AUDIO-SETUP {}] send_offer() returned: {}", inner.t_plus(), renegotiation_result);
        info!("[AUDIO-SETUP] Peer signaling state AFTER renegotiation: {:?}", inner.peer.signaling_state());
        info!("[AUDIO-SETUP] Peer ICE connection state AFTER renegotiation: {:?}", inner.peer.ice_connection_state());
        info!("[AUDIO-SETUP] Peer ICE gathering state AFTER renegotiation: {:?}", inner.peer.ice_gathering_state());
        info!("[AUDIO-SETUP] Peer connection state AFTER renegotiation: {:?}", inner.peer.connection_state());

        if !renegotiation_result {
            warn!("[AUDIO-SETUP] RENEGOTIATION FAILED! Audio was added but renegotiation failed.");
        } else {
            info!("[AUDIO-SETUP] Renegotiation succeeded");
        }

        info!("[AUDIO-SETUP {}] ========== AUDIO SETUP COMPLETE ==========", inner.t_plus());
        0
    }

    pub async fn send_audio_sample(&mut self, data: &[u8]) {
        let Some(config) = self.config.as_ref() else {
            return;
        };

        let duration =
            Duration::from_secs_f64(config.samples_per_frame as f64 / config.sample_rate as f64);

        let data = Bytes::copy_from_slice(data);

        let sample = Sample {
            data,
            duration,
            // Time should be set if you want fine-grained sync
            ..Default::default()
        };

        self.sender.send_samples(vec![sample], false).await;
    }

    fn config(&self) -> AudioConfig {
        AudioConfig::STEREO
    }
}
