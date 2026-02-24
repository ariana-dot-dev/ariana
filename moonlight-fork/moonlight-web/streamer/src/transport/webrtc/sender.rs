use std::{
    collections::VecDeque,
    sync::{Arc, Weak},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::anyhow;
use log::{debug, info, warn};
use tokio::{
    runtime::Handle,
    sync::{Mutex, Notify},
};
use webrtc::{
    api::media_engine::MediaEngine,
    media::Sample,
    peer_connection::RTCPeerConnection,
    rtcp::packet::Packet,
    rtp::{
        self,
        extension::{
            HeaderExtension, abs_send_time_extension::AbsSendTimeExtension,
            playout_delay_extension::PlayoutDelayExtension,
        },
    },
    rtp_transceiver::rtp_codec::{RTCRtpHeaderExtensionCapability, RTPCodecType},
    sdp::extmap::ABS_SEND_TIME_URI,
    track::track_local::{
        TrackLocal, track_local_static_rtp::TrackLocalStaticRTP,
        track_local_static_sample::TrackLocalStaticSample,
    },
};

const PLAYOUT_DELAY_URI: &str = "http://www.webrtc.org/experiments/rtp-hdrext/playout-delay";

pub fn register_header_extensions(api_media: &mut MediaEngine) -> Result<(), webrtc::Error> {
    api_media.register_header_extension(
        RTCRtpHeaderExtensionCapability {
            uri: PLAYOUT_DELAY_URI.to_string(),
        },
        RTPCodecType::Video,
        None,
    )?;
    api_media.register_header_extension(
        RTCRtpHeaderExtensionCapability {
            uri: PLAYOUT_DELAY_URI.to_string(),
        },
        RTPCodecType::Audio,
        None,
    )?;

    api_media.register_header_extension(
        RTCRtpHeaderExtensionCapability {
            uri: ABS_SEND_TIME_URI.to_string(),
        },
        RTPCodecType::Video,
        None,
    )?;
    api_media.register_header_extension(
        RTCRtpHeaderExtensionCapability {
            uri: ABS_SEND_TIME_URI.to_string(),
        },
        RTPCodecType::Audio,
        None,
    )?;

    Ok(())
}

pub struct TrackLocalSender<Track>
where
    Track: TrackLike,
{
    runtime: Handle,
    peer: Weak<RTCPeerConnection>,
    channel_queue_size: usize,
    new_samples_notify: Arc<Notify>,
    queue: Arc<Mutex<VecDeque<FrameSamples<Track>>>>,
}

struct FrameSamples<Track>
where
    Track: TrackLike,
{
    important: bool,
    samples: Vec<Track::Sample>,
}

impl<Track> TrackLocalSender<Track>
where
    Track: TrackLike,
{
    pub fn new(runtime: Handle, peer: Weak<RTCPeerConnection>, channel_queue_size: usize) -> Self {
        Self {
            runtime,
            peer,
            channel_queue_size,
            new_samples_notify: Default::default(),
            queue: Default::default(),
        }
    }

    pub async fn create_track(
        &mut self,
        track: Track,
        mut on_packet: impl FnMut(Box<dyn Packet + Send + Sync>) + Send + 'static,
    ) -> Result<(), anyhow::Error> {
        info!("[TRACK-SENDER] ========== CREATE_TRACK CALLED ==========");

        info!("[TRACK-SENDER] Upgrading peer weak reference...");
        let Some(peer) = self.peer.upgrade() else {
            info!("[TRACK-SENDER] FAILED: peer weak reference could not be upgraded!");
            return Err(anyhow!(
                "Failed to create track because of missing webrtc peer!"
            ));
        };
        info!("[TRACK-SENDER] Peer reference upgraded successfully");
        info!("[TRACK-SENDER] Peer signaling state: {:?}", peer.signaling_state());
        info!("[TRACK-SENDER] Peer ICE connection state: {:?}", peer.ice_connection_state());
        info!("[TRACK-SENDER] Peer connection state: {:?}", peer.connection_state());

        let track = Arc::new(track);
        info!("[TRACK-SENDER] Track wrapped in Arc");

        let new_samples_notify = self.new_samples_notify.clone();
        let queue = Arc::downgrade(&self.queue);
        info!("[TRACK-SENDER] Spawning sample_sender task...");
        self.runtime.spawn({
            let track = track.clone();
            async move {
                sample_sender(track, &new_samples_notify, queue).await;
            }
        });
        info!("[TRACK-SENDER] sample_sender task spawned");

        info!("[TRACK-SENDER] Calling peer.add_track()...");
        info!("[TRACK-SENDER] Peer signaling state BEFORE add_track: {:?}", peer.signaling_state());
        info!("[TRACK-SENDER] Peer ICE connection state BEFORE add_track: {:?}", peer.ice_connection_state());

        let track_sender = match peer.add_track(track.track()).await {
            Ok(sender) => {
                info!("[TRACK-SENDER] add_track() succeeded");
                sender
            }
            Err(err) => {
                info!("[TRACK-SENDER] add_track() FAILED: {:?}", err);
                return Err(err.into());
            }
        };

        info!("[TRACK-SENDER] Peer signaling state AFTER add_track: {:?}", peer.signaling_state());
        info!("[TRACK-SENDER] Peer ICE connection state AFTER add_track: {:?}", peer.ice_connection_state());

        // Read incoming RTCP packets
        // Before these packets are returned they are processed by interceptors. For things
        // like NACK this needs to be called.
        info!("[TRACK-SENDER] Spawning RTCP reader task...");
        self.runtime.spawn(async move {
            let mut rtcp_buf = vec![0u8; 1500];
            while let Ok((packets, _)) = track_sender.read(&mut rtcp_buf).await {
                for packet in packets {
                    on_packet(packet);
                }
            }
            info!("[TRACK-SENDER] RTCP reader loop ended");
        });
        info!("[TRACK-SENDER] RTCP reader task spawned");

        info!("[TRACK-SENDER] ========== CREATE_TRACK COMPLETE ==========");
        Ok(())
    }

    /// Returns if the frame will be delivered
    pub async fn send_samples(&self, samples: Vec<Track::Sample>, important: bool) -> bool {
        let mut queue = self.queue.lock().await;

        let result = if important {
            queue.push_front(FrameSamples { important, samples });
            true
        } else {
            if queue.len() > self.channel_queue_size {
                return false;
            }

            queue.push_front(FrameSamples { important, samples });
            true
        };

        self.new_samples_notify.notify_waiters();

        result
    }

    /// Returns if the frame will be delivered
    pub async fn clear_queue(&self, clear_important: bool) {
        let mut queue = self.queue.lock().await;

        if clear_important {
            queue.clear();
        } else {
            queue.retain(|frame| frame.important);
        }
    }
}

async fn sample_sender<Track>(
    track: Arc<Track>,
    new_samples_notify: &Notify,
    queue: Weak<Mutex<VecDeque<FrameSamples<Track>>>>,
) where
    Track: TrackLike,
{
    loop {
        let frame = {
            let Some(queue) = queue.upgrade() else {
                debug!("no sample queue available: stopping to submit samples");
                continue;
            };

            let mut queue = queue.lock().await;
            let Some(new_frame) = queue.pop_back() else {
                drop(queue); // Important: drop the mutex

                new_samples_notify.notified().await;
                continue;
            };

            new_frame
        };

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock went backwards");
        let now_secs = now.as_secs() as f64 + now.subsec_nanos() as f64 * 1e-9;
        let abs_send_time: u64 = (now_secs * 262_144.0) as u64;

        for sample in frame.samples {
            if let Err(err) = track
                .write_with_extensions(
                    sample,
                    &[
                        HeaderExtension::PlayoutDelay(PlayoutDelayExtension::new(0, 0)),
                        HeaderExtension::AbsSendTime(AbsSendTimeExtension {
                            timestamp: abs_send_time,
                        }),
                    ],
                )
                .await
            {
                warn!("[Stream]: track.write_sample failed: {err}");
            }
        }
    }
}

pub trait TrackLike: Send + Sync + 'static {
    type Sample: Send + 'static;

    fn write_with_extensions(
        &self,
        sample: Self::Sample,
        extensions: &[HeaderExtension],
    ) -> impl Future<Output = Result<(), anyhow::Error>> + Send;

    fn track(self: Arc<Self>) -> Arc<dyn TrackLocal + Send + Sync + 'static>;
}

impl TrackLike for TrackLocalStaticSample {
    type Sample = Sample;

    async fn write_with_extensions(
        &self,
        sample: Self::Sample,
        extensions: &[HeaderExtension],
    ) -> Result<(), anyhow::Error> {
        self.write_sample_with_extensions(&sample, extensions)
            .await
            .map_err(anyhow::Error::from)
    }

    fn track(self: Arc<Self>) -> Arc<dyn TrackLocal + Send + Sync + 'static> {
        self
    }
}

pub struct SequencedTrackLocalStaticRTP {
    track: Arc<TrackLocalStaticRTP>,
    sequence_number: Mutex<u16>,
}

impl From<TrackLocalStaticRTP> for SequencedTrackLocalStaticRTP {
    fn from(value: TrackLocalStaticRTP) -> Self {
        Self {
            track: Arc::new(value),
            sequence_number: Mutex::new(0),
        }
    }
}

impl TrackLike for SequencedTrackLocalStaticRTP {
    type Sample = rtp::packet::Packet;

    async fn write_with_extensions(
        &self,
        mut sample: Self::Sample,
        extensions: &[HeaderExtension],
    ) -> Result<(), anyhow::Error> {
        let (any_paused, all_paused) = (
            self.track.any_binding_paused().await,
            self.track.all_binding_paused().await,
        );

        if all_paused {
            // Abort already here to not increment sequence numbers.
            return Ok(());
        }
        if any_paused {
            warn!("WebRTC: not all paused but any paused");
        }

        let mut sequence_number = self.sequence_number.lock().await;
        sample.header.sequence_number = *sequence_number;
        *sequence_number = sequence_number.wrapping_add(1);

        self.track
            .write_rtp_with_extensions(&sample, extensions)
            .await
            .map_err(anyhow::Error::from)
            .map(|_| ())
    }

    fn track(self: Arc<Self>) -> Arc<dyn TrackLocal + Send + Sync + 'static> {
        self.track.clone()
    }
}
