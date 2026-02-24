use std::{
    future::ready,
    pin::Pin,
    sync::{Arc, Weak},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use bytes::Bytes;
use common::{
    StreamSettings,
    api_bindings::{
        RtcIceCandidate, RtcSdpType, RtcSessionDescription, StreamClientMessage,
        StreamServerMessage, StreamSignalingMessage, TransportChannelId,
    },
    config::{PortRange, WebRtcConfig},
    ipc::{ServerIpcMessage, StreamerIpcMessage},
};
use log::{debug, error, info, trace, warn};
use moonlight_common::stream::{
    bindings::{
        AudioConfig, DecodeResult, OpusMultistreamConfig, SupportedVideoFormats, VideoDecodeUnit,
    },
    video::VideoSetup,
};
use tokio::{
    runtime::Handle,
    spawn,
    sync::{
        Mutex, Notify,
        mpsc::{Receiver, Sender, channel},
    },
    time::{sleep, timeout},
};
use webrtc::{
    api::{
        APIBuilder, interceptor_registry::register_default_interceptors, media_engine::MediaEngine,
        setting_engine::SettingEngine,
    },
    data_channel::{RTCDataChannel, data_channel_message::DataChannelMessage},
    ice::udp_network::{EphemeralUDP, UDPNetwork},
    ice_transport::{
        ice_candidate::{RTCIceCandidate, RTCIceCandidateInit},
        ice_connection_state::RTCIceConnectionState,
    },
    interceptor::registry::Registry,
    peer_connection::{
        RTCPeerConnection,
        configuration::RTCConfiguration,
        offer_answer_options::RTCOfferOptions,
        peer_connection_state::RTCPeerConnectionState,
        sdp::{sdp_type::RTCSdpType, session_description::RTCSessionDescription},
    },
};

use crate::{
    convert::{
        from_webrtc_sdp, into_webrtc_ice, into_webrtc_ice_candidate, into_webrtc_network_type,
    },
    transport::{
        InboundPacket, OutboundPacket, TransportChannel, TransportError, TransportEvent,
        TransportEvents, TransportSender,
        webrtc::{
            audio::{WebRtcAudio, register_audio_codecs},
            sender::register_header_extensions,
            video::{WebRtcVideo, register_video_codecs},
        },
    },
};

pub const TIMEOUT_DURATION: Duration = Duration::from_secs(10);

mod audio;
mod sender;
mod video;

struct WebRtcInner {
    peer: Arc<RTCPeerConnection>,
    event_sender: Sender<TransportEvent>,
    general_channel: Arc<RTCDataChannel>,
    stats_channel: Mutex<Option<Arc<RTCDataChannel>>>,
    video: Mutex<WebRtcVideo>,
    audio: Mutex<WebRtcAudio>,
    // Timeout / Terminate
    pub timeout_terminate_request: Mutex<Option<Instant>>,
    // Renegotiation mutex to prevent concurrent offer sends (race condition fix)
    renegotiating: Mutex<()>,
    // Notifies when an answer is received (for renegotiation completion)
    answer_received: Notify,
    // Timing: when the peer connection was created, for T+ offset logging
    created_at: Instant,
}

pub async fn new(
    config: &WebRtcConfig,
    video_frame_queue_size: usize,
    audio_sample_queue_size: usize,
) -> Result<(WebRTCTransportSender, WebRTCTransportEvents), anyhow::Error> {
    // -- Configure WebRTC
    let rtc_config = RTCConfiguration {
        ice_servers: config
            .ice_servers
            .clone()
            .into_iter()
            .map(into_webrtc_ice)
            .collect(),
        ..Default::default()
    };
    let mut api_settings = SettingEngine::default();

    if let Some(PortRange { min, max }) = config.port_range {
        match EphemeralUDP::new(min, max) {
            Ok(udp) => {
                api_settings.set_udp_network(UDPNetwork::Ephemeral(udp));
            }
            Err(err) => {
                warn!("[Stream]: Invalid port range in config: {err:?}");
            }
        }
    }
    if let Some(mapping) = config.nat_1to1.as_ref() {
        api_settings.set_nat_1to1_ips(
            mapping.ips.clone(),
            into_webrtc_ice_candidate(mapping.ice_candidate_type),
        );
    }
    api_settings.set_network_types(
        config
            .network_types
            .iter()
            .copied()
            .map(into_webrtc_network_type)
            .collect(),
    );

    api_settings.set_include_loopback_candidate(config.include_loopback_candidates);

    // ICE keepalive and timeout settings to prevent data channel disconnection
    // Default disconnected timeout is 5 seconds, which is too aggressive
    // Set to 30 seconds to allow for idle periods
    api_settings.set_ice_timeouts(
        Some(Duration::from_secs(30)),  // disconnected_timeout
        Some(Duration::from_secs(60)),  // failed_timeout
        Some(Duration::from_secs(2)),   // keepalive_interval
    );

    // -- Register media codecs
    // TODO: register them based on the sdp
    let mut api_media = MediaEngine::default();
    register_audio_codecs(&mut api_media).expect("failed to register audio codecs");
    register_video_codecs(&mut api_media).expect("failed to register video codecs");
    register_header_extensions(&mut api_media).expect("failed to register header extensions");

    // -- Build Api
    let mut api_registry = Registry::new();

    // Use the default set of Interceptors
    api_registry = register_default_interceptors(api_registry, &mut api_media)
        .expect("failed to register webrtc default interceptors");

    let api = APIBuilder::new()
        .with_setting_engine(api_settings)
        .with_media_engine(api_media)
        .with_interceptor_registry(api_registry)
        .build();

    let (event_sender, event_receiver) = channel::<TransportEvent>(20);

    let peer = Arc::new(api.new_peer_connection(rtc_config).await?);

    let general_channel = peer.create_data_channel("general", None).await?;

    let runtime = Handle::current();
    let this_owned = Arc::new(WebRtcInner {
        peer: peer.clone(),
        event_sender,
        general_channel,
        stats_channel: Mutex::new(None),
        video: Mutex::new(WebRtcVideo::new(
            runtime.clone(),
            Arc::downgrade(&peer),
            video_frame_queue_size,
        )),
        audio: Mutex::new(WebRtcAudio::new(
            runtime,
            Arc::downgrade(&peer),
            audio_sample_queue_size,
        )),
        timeout_terminate_request: Mutex::new(None),
        renegotiating: Mutex::new(()),
        answer_received: Notify::new(),
        created_at: Instant::now(),
    });
    info!("[Streamer T+0ms] WebRTC peer created");

    let this = Arc::downgrade(&this_owned);

    // -- Connection state
    peer.on_ice_connection_state_change(create_event_handler(
        this.clone(),
        async move |this, state| {
            this.on_ice_connection_state_change(state).await;
        },
    ));
    peer.on_peer_connection_state_change(create_event_handler(
        this.clone(),
        async move |this, state| {
            this.on_peer_connection_state_change(state).await;
        },
    ));

    // -- Signaling
    peer.on_ice_candidate(create_event_handler(
        this.clone(),
        async move |this, candidate| {
            this.on_ice_candidate(candidate).await;
        },
    ));

    // -- Data Channels
    peer.on_data_channel(create_event_handler(
        this.clone(),
        async move |this, channel| {
            this.on_data_channel(channel).await;
        },
    ));

    drop(peer);

    Ok((
        WebRTCTransportSender {
            inner: this_owned.clone(),
        },
        WebRTCTransportEvents { event_receiver },
    ))
}

// It compiling...
#[allow(clippy::complexity)]
fn create_event_handler<F, Args>(
    inner: Weak<WebRtcInner>,
    f: F,
) -> Box<
    dyn FnMut(Args) -> Pin<Box<dyn Future<Output = ()> + Send + 'static>> + Send + Sync + 'static,
>
where
    Args: Send + 'static,
    F: AsyncFn(Arc<WebRtcInner>, Args) + Send + Sync + Clone + 'static,
    for<'a> F::CallRefFuture<'a>: Send,
{
    Box::new(move |args: Args| {
        let inner = inner.clone();
        let Some(inner) = inner.upgrade() else {
            debug!("Called webrtc event handler while the main type is already deallocated");
            return Box::pin(ready(())) as Pin<Box<dyn Future<Output = ()> + Send + 'static>>;
        };

        let future = f.clone();
        Box::pin(async move {
            future(inner, args).await;
        }) as Pin<Box<dyn Future<Output = ()> + Send + 'static>>
    })
        as Box<
            dyn FnMut(Args) -> Pin<Box<dyn Future<Output = ()> + Send + 'static>>
                + Send
                + Sync
                + 'static,
        >
}
#[allow(clippy::complexity)]
fn create_channel_message_handler(
    inner: Weak<WebRtcInner>,
    channel: TransportChannel,
) -> Box<
    dyn FnMut(DataChannelMessage) -> Pin<Box<dyn Future<Output = ()> + Send + 'static>>
        + Send
        + Sync
        + 'static,
> {
    create_event_handler(inner, async move |inner, message: DataChannelMessage| {
        let Some(packet) = InboundPacket::deserialize(channel, &message.data) else {
            return;
        };

        if let Err(err) = inner
            .event_sender
            .send(TransportEvent::RecvPacket(packet))
            .await
        {
            warn!("Failed to dispatch RecvPacket event: {err:?}");
        };
    })
}

/// Extract ice-ufrag from SDP for debugging
fn extract_ice_ufrag(sdp: &str) -> Option<String> {
    for line in sdp.lines() {
        if line.starts_with("a=ice-ufrag:") {
            return Some(line.trim_start_matches("a=ice-ufrag:").to_string());
        }
    }
    None
}

/// Extract ice-pwd from SDP for debugging
fn extract_ice_pwd(sdp: &str) -> Option<String> {
    for line in sdp.lines() {
        if line.starts_with("a=ice-pwd:") {
            return Some(line.trim_start_matches("a=ice-pwd:").to_string());
        }
    }
    None
}

/// Log SDP with ice credentials highlighted
fn log_sdp(prefix: &str, sdp: &str) {
    let ufrag = extract_ice_ufrag(sdp).unwrap_or_else(|| "NONE".to_string());
    let pwd = extract_ice_pwd(sdp).unwrap_or_else(|| "NONE".to_string());
    info!("{} ICE-UFRAG={} ICE-PWD={}", prefix, ufrag, pwd);
}

impl WebRtcInner {
    fn t_plus(&self) -> String {
        format!("T+{}ms", self.created_at.elapsed().as_millis())
    }

    // -- Handle Connection State
    async fn on_ice_connection_state_change(self: &Arc<Self>, state: RTCIceConnectionState) {
        info!("[ICE {}] State changed: {:?} (signaling={:?}, peer={:?}, gathering={:?})",
              self.t_plus(), state, self.peer.signaling_state(), self.peer.connection_state(),
              self.peer.ice_gathering_state());
    }
    async fn on_peer_connection_state_change(self: Arc<Self>, state: RTCPeerConnectionState) {
        info!("[PEER {}] State changed: {:?} (ICE={:?}, signaling={:?}, gathering={:?})",
              self.t_plus(), state, self.peer.ice_connection_state(), self.peer.signaling_state(),
              self.peer.ice_gathering_state());

        #[allow(clippy::collapsible_if)]
        if matches!(state, RTCPeerConnectionState::Connected) {
            info!("[PEER] State is CONNECTED");
            self.clear_terminate_request().await;
        } else if matches!(state, RTCPeerConnectionState::Closed) {
            info!("[PEER] State is CLOSED, sending TransportEvent::Closed");
            if let Err(err) = self.event_sender.send(TransportEvent::Closed).await {
                warn!("[PEER] Failed to send peer closed event to stream: {err:?}");
                self.request_terminate().await;
            };
        } else if matches!(state, RTCPeerConnectionState::Failed) {
            // Do NOT auto-terminate on Failed - WebRTC can recover, and only the user should close the stream
            info!("[PEER] State is FAILED (not terminating - waiting for recovery or user close)");
        } else if matches!(state, RTCPeerConnectionState::Disconnected) {
            // Disconnected is temporary - TURN relay should recover automatically
            info!("[PEER] State is DISCONNECTED (temporary, not terminating)");
        } else {
            info!("[PEER] State is {:?}, clearing terminate request", state);
            self.clear_terminate_request().await;
        }
    }

    // -- Handle Signaling
    async fn send_answer(&self) -> bool {
        info!("[ANSWER {}] Creating answer (signaling={:?}, ICE={:?})",
              self.t_plus(), self.peer.signaling_state(), self.peer.ice_connection_state());

        let local_description = match self.peer.create_answer(None).await {
            Err(err) => {
                error!("[ANSWER] Failed to create answer: {err:?}");
                return false;
            }
            Ok(value) => value,
        };

        log_sdp("[ANSWER]", &local_description.sdp);

        info!("[ANSWER {}] Calling set_local_description (signaling={:?})", self.t_plus(), self.peer.signaling_state());
        if let Err(err) = self
            .peer
            .set_local_description(local_description.clone())
            .await
        {
            error!("[ANSWER] Failed to set local description: {err:?}");
            return false;
        }
        info!("[ANSWER {}] set_local_description OK (signaling={:?}, ICE={:?})",
              self.t_plus(), self.peer.signaling_state(), self.peer.ice_connection_state());

        if let Err(err) = self
            .event_sender
            .send(TransportEvent::SendIpc(StreamerIpcMessage::WebSocket(
                StreamServerMessage::WebRtc(StreamSignalingMessage::Description(
                    RtcSessionDescription {
                        ty: from_webrtc_sdp(local_description.sdp_type),
                        sdp: local_description.sdp,
                    },
                )),
            )))
            .await
        {
            error!("[ANSWER] Failed to send answer via WebSocket: {err:?}");
            return false;
        }

        info!("[ANSWER {}] Complete (signaling={:?}, ICE={:?})",
              self.t_plus(), self.peer.signaling_state(), self.peer.ice_connection_state());
        true
    }
    async fn send_offer(&self) -> bool {
        info!("[OFFER {}] Starting renegotiation (signaling={:?}, ICE={:?})",
              self.t_plus(), self.peer.signaling_state(), self.peer.ice_connection_state());

        let _renegotiation_guard = self.renegotiating.lock().await;

        // Prepare the notified future BEFORE creating the offer
        let answer_notified = self.answer_received.notified();

        let offer_options = RTCOfferOptions {
            ice_restart: false,
            ..Default::default()
        };
        let local_description = match self.peer.create_offer(Some(offer_options)).await {
            Err(err) => {
                error!("[OFFER] Failed to create offer: {err:?}");
                return false;
            }
            Ok(value) => value,
        };

        // webrtc-rs generates new ICE credentials when switching from answerer to offerer
        // role, even with ice_restart=false. This triggers an ICE restart on the browser
        // side (Chrome sees changed credentials → restarts ICE). The restart causes a brief
        // hiccup (~200ms) but recovers since NAT mappings are still fresh.
        //
        // Previously this code tried to replace the new credentials with the originals to
        // prevent ICE restart. However, webrtc-rs's internal ICE agent uses the NEW credentials
        // regardless of what's in the SDP passed to set_local_description. This caused a
        // credential mismatch: server STUN checks used new creds, browser expected old ones,
        // and Chrome's 5-second ICE timeout killed the connection every time.
        {
            let new_ufrag = extract_ice_ufrag(&local_description.sdp);
            info!("[OFFER] Using webrtc-rs generated ICE credentials (ufrag={}). Browser will ICE-restart.",
                  new_ufrag.unwrap_or_default());
        }

        log_sdp("[OFFER]", &local_description.sdp);

        info!("[OFFER {}] Calling set_local_description (signaling={:?}, ICE={:?})",
              self.t_plus(), self.peer.signaling_state(), self.peer.ice_connection_state());
        if let Err(err) = self
            .peer
            .set_local_description(local_description.clone())
            .await
        {
            error!("[OFFER] Failed to set local description: {err:?}");
            return false;
        }
        info!("[OFFER {}] set_local_description OK (signaling={:?}, ICE={:?}, gathering={:?})",
              self.t_plus(), self.peer.signaling_state(), self.peer.ice_connection_state(),
              self.peer.ice_gathering_state());

        if let Err(err) = self
            .event_sender
            .send(TransportEvent::SendIpc(StreamerIpcMessage::WebSocket(
                StreamServerMessage::WebRtc(StreamSignalingMessage::Description(
                    RtcSessionDescription {
                        ty: from_webrtc_sdp(local_description.sdp_type),
                        sdp: local_description.sdp,
                    },
                )),
            )))
            .await
        {
            error!("[OFFER] Failed to send offer via WebSocket: {err:?}");
            return false;
        };

        info!("[OFFER {}] Offer sent, waiting for answer (30s timeout)...", self.t_plus());

        match timeout(Duration::from_secs(30), answer_notified).await {
            Ok(_) => {
                info!("[OFFER {}] Renegotiation complete (signaling={:?}, ICE={:?})",
                      self.t_plus(), self.peer.signaling_state(), self.peer.ice_connection_state());
                true
            }
            Err(_) => {
                error!("[OFFER {}] Timed out waiting for answer after 30s (ICE={:?})",
                       self.t_plus(), self.peer.ice_connection_state());
                false
            }
        }
    }

    async fn on_ws_message(&self, message: StreamClientMessage) {
        match message {
            StreamClientMessage::StartStream {
                bitrate,
                packet_size,
                fps,
                width,
                height,
                play_audio_local,
                video_supported_formats,
                video_colorspace,
                video_color_range_full,
                hdr,
            } => {
                info!("[WS {}] StartStream: {}x{}@{}fps bitrate={}", self.t_plus(), width, height, fps, bitrate);

                let video_supported_formats = SupportedVideoFormats::from_bits(video_supported_formats).unwrap_or_else(|| {
                    warn!("[WS] Failed to deserialize SupportedVideoFormats: {video_supported_formats}, falling back to only H264");
                    SupportedVideoFormats::H264
                });

                {
                    let mut video = self.video.lock().await;
                    video.set_codecs(video_supported_formats).await;
                }

                if let Err(err) = self
                    .event_sender
                    .send(TransportEvent::StartStream {
                        settings: StreamSettings {
                            bitrate,
                            packet_size,
                            fps,
                            width,
                            height,
                            video_supported_formats,
                            video_color_range_full,
                            video_colorspace: video_colorspace.into(),
                            play_audio_local,
                            hdr,
                        },
                    })
                    .await
                {
                    error!("[WS] Failed to send StartStream: {err}");
                }
            }
            StreamClientMessage::WebRtc(StreamSignalingMessage::Description(description)) => {
                info!("[WS {}] Received SDP {:?} (signaling={:?}, ICE={:?})",
                      self.t_plus(), description.ty, self.peer.signaling_state(), self.peer.ice_connection_state());
                log_sdp("[WS]", &description.sdp);

                let description = match &description.ty {
                    RtcSdpType::Offer => RTCSessionDescription::offer(description.sdp),
                    RtcSdpType::Answer => RTCSessionDescription::answer(description.sdp),
                    RtcSdpType::Pranswer => RTCSessionDescription::pranswer(description.sdp),
                    _ => {
                        error!("[WS] Unknown SDP type: {:?}", description.ty);
                        return;
                    }
                };

                let Ok(description) = description else {
                    error!("[WS] Invalid RTCSessionDescription");
                    return;
                };

                let remote_ty = description.sdp_type;

                if let Err(err) = self.peer.set_remote_description(description).await {
                    error!("[WS] Failed to set remote description: {err:?}");
                    return;
                }

                info!("[WS {}] set_remote_description OK (signaling={:?}, ICE={:?})",
                      self.t_plus(), self.peer.signaling_state(), self.peer.ice_connection_state());

                if remote_ty == RTCSdpType::Offer {
                    info!("[WS {}] Remote SDP was OFFER, creating answer...", self.t_plus());
                    let result = self.send_answer().await;
                    info!("[WS {}] send_answer returned: {} (ICE={:?})", self.t_plus(), result, self.peer.ice_connection_state());
                } else if remote_ty == RTCSdpType::Answer {
                    info!("[WS {}] Remote SDP was ANSWER, notifying renegotiation waiter (ICE={:?})",
                          self.t_plus(), self.peer.ice_connection_state());
                    self.answer_received.notify_one();
                }
            }
            StreamClientMessage::WebRtc(StreamSignalingMessage::AddIceCandidate(description)) => {
                info!("[WS] Received remote ICE candidate: {} ufrag={:?} (ICE={:?})",
                      description.candidate, description.username_fragment,
                      self.peer.ice_connection_state());

                if let Err(err) = self
                    .peer
                    .add_ice_candidate(RTCIceCandidateInit {
                        candidate: description.candidate.clone(),
                        sdp_mid: description.sdp_mid.clone(),
                        sdp_mline_index: description.sdp_mline_index,
                        username_fragment: description.username_fragment.clone(),
                    })
                    .await
                {
                    error!("[WS] Failed to add ICE candidate: {err:?} (candidate={})", description.candidate);
                } else {
                    info!("[WS] Added remote ICE candidate OK (ICE={:?})", self.peer.ice_connection_state());
                }
            }
            _ => {}
        }
    }

    async fn on_ws_binary(&self, bytes: Bytes) {
        // Binary WebSocket messages come from WebSocketDataChannel on the frontend
        // Format: encrypt([channelId:u8][payload]) or just [channelId:u8][payload] if no encryption
        // For now, we assume NO encryption (as crypto.ts makes it optional)

        if bytes.len() < 2 {
            warn!("[WS-Binary] Received message too short: {} bytes", bytes.len());
            return;
        }

        // Extract channel ID (first byte)
        let channel_id = bytes[0];
        let payload = &bytes[1..];

        trace!("[WS-Binary] Received {} bytes on channel {}", bytes.len(), channel_id);

        // Deserialize the packet using existing InboundPacket::deserialize
        let packet = match InboundPacket::deserialize(TransportChannel(channel_id), payload) {
            Some(packet) => packet,
            None => {
                warn!("[WS-Binary] Failed to deserialize packet on channel {}", channel_id);
                return;
            }
        };

        // Send the packet to the event handler (same as WebRTC data channels)
        if let Err(err) = self.event_sender.send(TransportEvent::RecvPacket(packet)).await {
            warn!("[WS-Binary] Failed to send packet to event handler: {err:?}");
        }
    }

    async fn on_ice_candidate(&self, candidate: Option<RTCIceCandidate>) {
        let Some(candidate) = candidate else {
            info!("[ICE-CAND] ICE gathering complete (ICE={:?})", self.peer.ice_connection_state());
            return;
        };

        let Ok(candidate_json) = candidate.to_json() else {
            error!("[ICE-CAND] Failed to convert candidate to JSON");
            return;
        };

        info!("[ICE-CAND] Sending local candidate: {} (ICE={:?})",
              candidate_json.candidate, self.peer.ice_connection_state());

        let message =
            StreamServerMessage::WebRtc(StreamSignalingMessage::AddIceCandidate(RtcIceCandidate {
                candidate: candidate_json.candidate.clone(),
                sdp_mid: candidate_json.sdp_mid,
                sdp_mline_index: candidate_json.sdp_mline_index,
                username_fragment: candidate_json.username_fragment,
            }));

        if let Err(err) = self
            .event_sender
            .send(TransportEvent::SendIpc(StreamerIpcMessage::WebSocket(
                message,
            )))
            .await
        {
            error!("[ICE-CAND] Failed to send ICE candidate to browser: {err:?}");
        }
    }

    async fn on_data_channel(self: Arc<Self>, channel: Arc<RTCDataChannel>) {
        let label = channel.label();
        info!("[DATA-CH] Adding data channel: \"{}\" (ICE={:?}, peer={:?})",
              label, self.peer.ice_connection_state(), self.peer.connection_state());

        let inner = Arc::downgrade(&self);

        match label {
            "stats" => {
                let mut stats = self.stats_channel.lock().await;

                channel.on_close({
                    let this = Arc::downgrade(&self);

                    Box::new(move ||{
                        let this = this.clone();

                        Box::pin(async move {
                            let Some(this) = this.upgrade() else {
                                warn!("Failed to close stats channel because the main type is already deallocated");
                                return;
                            };

                            this.close_stats().await;
                        })
                    })
                });

                *stats = Some(channel);
            }
            "mouse_reliable" | "mouse_absolute" | "mouse_relative" => {
                channel.on_message(create_channel_message_handler(
                    inner,
                    TransportChannel(TransportChannelId::MOUSE_ABSOLUTE),
                ));
            }
            "touch" => {
                channel.on_message(create_channel_message_handler(
                    inner,
                    TransportChannel(TransportChannelId::TOUCH),
                ));
            }
            "keyboard" => {
                channel.on_message(create_channel_message_handler(
                    inner,
                    TransportChannel(TransportChannelId::KEYBOARD),
                ));
            }
            "controllers" => {
                channel.on_message(create_channel_message_handler(
                    inner,
                    TransportChannel(TransportChannelId::CONTROLLERS),
                ));
            }
            _ if let Some(number) = label.strip_prefix("controller")
                && let Ok(id) = number.parse::<usize>()
                && id < InboundPacket::CONTROLLER_CHANNELS.len() =>
            {
                channel.on_message(create_channel_message_handler(
                    inner,
                    TransportChannel(InboundPacket::CONTROLLER_CHANNELS[id]),
                ));
            }
            _ => {}
        };
    }

    async fn close_stats(&self) {
        let mut stats = self.stats_channel.lock().await;

        *stats = None;
    }

    // -- Termination
    async fn request_terminate(self: &Arc<Self>) {
        let this = self.clone();

        let mut terminate_request = self.timeout_terminate_request.lock().await;
        *terminate_request = Some(Instant::now());
        drop(terminate_request);

        spawn(async move {
            sleep(TIMEOUT_DURATION + Duration::from_millis(200)).await;

            let now = Instant::now();

            let terminate_request = this.timeout_terminate_request.lock().await;
            if let Some(terminate_request) = *terminate_request
                && (now - terminate_request) > TIMEOUT_DURATION
            {
                info!("Stopping because of timeout");
                if let Err(err) = this.event_sender.send(TransportEvent::Closed).await {
                    warn!("Failed to send that the peer should close: {err:?}");
                };
            }
        });
    }
    async fn clear_terminate_request(&self) {
        let mut request = self.timeout_terminate_request.lock().await;

        *request = None;
    }
}

pub struct WebRTCTransportEvents {
    event_receiver: Receiver<TransportEvent>,
}

#[async_trait]
impl TransportEvents for WebRTCTransportEvents {
    async fn poll_event(&mut self) -> Result<TransportEvent, TransportError> {
        trace!("Polling WebRTCEvents");
        self.event_receiver
            .recv()
            .await
            .ok_or(TransportError::Closed)
    }
}

pub struct WebRTCTransportSender {
    inner: Arc<WebRtcInner>,
}

#[async_trait]
impl TransportSender for WebRTCTransportSender {
    async fn setup_video(&self, setup: VideoSetup) -> i32 {
        info!("[Streamer {}] setup_video() called", self.inner.t_plus());
        let mut video = self.inner.video.lock().await;
        let result = if video.setup(&self.inner, setup).await {
            0
        } else {
            -1
        };
        info!("[Streamer {}] setup_video() complete (result={})", self.inner.t_plus(), result);
        result
    }
    async fn send_video_unit<'a>(
        &'a self,
        unit: &'a VideoDecodeUnit<'a>,
    ) -> Result<DecodeResult, TransportError> {
        let mut video = self.inner.video.lock().await;
        Ok(video.send_decode_unit(unit).await)
    }

    async fn setup_audio(
        &self,
        audio_config: AudioConfig,
        stream_config: OpusMultistreamConfig,
    ) -> i32 {
        info!("[Streamer {}] setup_audio() called", self.inner.t_plus());
        let mut audio = self.inner.audio.lock().await;
        let result = audio.setup(&self.inner, audio_config, stream_config).await;
        info!("[Streamer {}] setup_audio() complete (result={})", self.inner.t_plus(), result);
        result
    }
    async fn send_audio_sample(&self, data: &[u8]) -> Result<(), TransportError> {
        let mut audio = self.inner.audio.lock().await;

        audio.send_audio_sample(data).await;

        Ok(())
    }

    async fn send(&self, packet: OutboundPacket) -> Result<(), TransportError> {
        let mut buffer = Vec::new();

        let Some((channel, range)) = packet.serialize(&mut buffer) else {
            warn!("Failed to serialize packet: {packet:?}");
            return Ok(());
        };

        let bytes = Bytes::from(buffer);
        let bytes = bytes.slice(range);

        match channel.0 {
            TransportChannelId::GENERAL => match self.inner.general_channel.send(&bytes).await {
                Ok(_) => {}
                Err(webrtc::Error::ErrDataChannelNotOpen) => {
                    return Err(TransportError::ChannelClosed);
                }
                _ => {}
            },
            TransportChannelId::STATS => {
                let stats = self.inner.stats_channel.lock().await;
                if let Some(stats) = stats.as_ref() {
                    match stats.send(&bytes).await {
                        Ok(_) => {}
                        Err(webrtc::Error::ErrDataChannelNotOpen) => {
                            return Err(TransportError::ChannelClosed);
                        }
                        _ => {}
                    }
                } else {
                    return Err(TransportError::ChannelClosed);
                }
            }
            _ => {
                warn!("Cannot send data on channel {channel:?}");
                return Err(TransportError::ChannelClosed);
            }
        }
        Ok(())
    }

    async fn on_ipc_message(&self, message: ServerIpcMessage) -> Result<(), TransportError> {
        match message {
            ServerIpcMessage::WebSocket(message) => {
                self.inner.on_ws_message(message).await;
            }
            ServerIpcMessage::WebSocketTransport(bytes) => {
                self.inner.on_ws_binary(bytes).await;
            }
            _ => {}
        }
        Ok(())
    }

    async fn close(&self) -> Result<(), TransportError> {
        info!("[CLOSE {}] Closing peer connection (ICE={:?}, peer={:?}, signaling={:?})",
              self.inner.t_plus(), self.inner.peer.ice_connection_state(), self.inner.peer.connection_state(),
              self.inner.peer.signaling_state());
        self.inner
            .peer
            .close()
            .await
            .map_err(|err| TransportError::Implementation(err.into()))?;
        info!("[CLOSE] Peer connection closed");

        Ok(())
    }
}
