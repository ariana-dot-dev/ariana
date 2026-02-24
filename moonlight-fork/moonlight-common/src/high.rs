//!
//! The high level api of the moonlight wrapper
//!

use std::{
    io,
    net::{Ipv4Addr, SocketAddrV4},
};

use pem::Pem;
use tokio::{net::UdpSocket, task::JoinError};
use uuid::Uuid;

use crate::{
    Error, MoonlightError, PairPin, PairStatus, ServerState, ServerVersion,
    mac::MacAddress,
    network::{
        ApiError, App, ClientAppBoxArtRequest, ClientInfo, DEFAULT_UNIQUE_ID, HostInfo,
        ServerAppListResponse, host_app_box_art, host_app_list, host_cancel, host_info,
        pair::host_unpair, request_client::RequestClient,
    },
    pair::{ClientAuth, PairError, PairSuccess, host_pair},
};

pub async fn broadcast_magic_packet(mac: MacAddress) -> Result<(), io::Error> {
    let mut magic_packet = [0u8; 6 * 17];

    magic_packet[0..6].copy_from_slice(&[255, 255, 255, 255, 255, 255]);
    for i in 1..17 {
        magic_packet[(i * 6)..((i + 1) * 6)].copy_from_slice(&mac.to_bytes());
    }

    let broadcast = SocketAddrV4::new(Ipv4Addr::new(255, 255, 255, 255), 9);

    let socket = UdpSocket::bind("0.0.0.0:0").await?;

    socket.set_broadcast(true)?;
    socket.send_to(&magic_packet, &broadcast).await?;

    Ok(())
}

#[derive(Debug, Error)]
pub enum HostError<RequestError> {
    #[error("{0}")]
    Moonlight(#[from] MoonlightError),
    #[error("{0}")]
    BlockingJoin(#[from] JoinError),
    #[error("this action requires pairing")]
    NotPaired,
    #[error("{0}")]
    Api(#[from] ApiError<RequestError>),
    #[error("{0}")]
    Pair(#[from] PairError<RequestError>),
    #[error("{0}")]
    StreamConfig(#[from] StreamConfigError),
    #[error("the host is likely offline")]
    LikelyOffline,
}

#[derive(Debug, Error)]
pub enum StreamConfigError {
    #[error("hdr not supported")]
    NotSupportedHdr,
    #[error("4k not supported")]
    NotSupported4k,
    #[error("4k not supported: Your device must support HEVC or AV1 to stream at 4k")]
    NotSupported4kCodecMissing,
    #[error("4k not supported: Update GeForce Experience")]
    NotSupported4kUpdateGfe,
}

pub struct MoonlightHost<Client> {
    client_unique_id: String,
    client: Client,
    address: String,
    http_port: u16,
    tried_connect: bool,
    cache_info: Option<HostInfo>,
    // Paired
    paired: Option<Paired>,
}

#[derive(Clone)]
struct Paired {
    client_private_key: Pem,
    client_certificate: Pem,
    server_certificate: Pem,
    cache_app_list: Option<ServerAppListResponse>,
}

impl<C> MoonlightHost<C>
where
    C: RequestClient,
{
    pub fn new(
        address: String,
        http_port: u16,
        unique_id: Option<String>,
    ) -> Result<Self, HostError<C::Error>> {
        Ok(Self {
            client: C::with_defaults()
                .map_err(|err| HostError::Api(ApiError::RequestClient(err)))?,
            client_unique_id: unique_id.unwrap_or_else(|| DEFAULT_UNIQUE_ID.to_string()),
            address,
            http_port,
            tried_connect: false,
            cache_info: None,
            paired: None,
        })
    }

    pub fn address(&self) -> &str {
        &self.address
    }
    pub fn http_port(&self) -> u16 {
        self.http_port
    }

    pub fn http_address(&self) -> String {
        format!("{}:{}", self.address, self.http_port)
    }

    async fn host_info(&mut self) -> Result<&HostInfo, HostError<C::Error>> {
        let has_cache = self.cache_info.is_some();
        let mut https_port = None;

        if self.tried_connect && !has_cache {
            return Err(HostError::LikelyOffline);
        }
        self.tried_connect = true;

        if !has_cache {
            let http_address = self.http_address();

            let client_info = ClientInfo {
                unique_id: &self.client_unique_id,
                uuid: Uuid::new_v4(),
            };

            let info = host_info(&mut self.client, false, &http_address, Some(client_info)).await?;

            https_port = Some(info.https_port);

            self.cache_info = Some(info);
        }
        if !has_cache
            && let Some(https_port) = https_port
            && self.is_paired() == PairStatus::Paired
        {
            let https_address = Self::build_https_address(&self.address, https_port);

            let client_info = ClientInfo {
                unique_id: &self.client_unique_id,
                uuid: Uuid::new_v4(),
            };
            self.cache_info =
                Some(host_info(&mut self.client, true, &https_address, Some(client_info)).await?);
        }

        let Some(info) = &self.cache_info else {
            unreachable!()
        };

        Ok(info)
    }
    pub fn clear_cache(&mut self) {
        self.tried_connect = false;
        self.cache_info = None;
        if let Some(paired) = self.paired.as_mut() {
            paired.cache_app_list = None;
        }
    }

    pub async fn https_port(&mut self) -> Result<u16, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.https_port)
    }

    fn build_https_address(address: &str, https_port: u16) -> String {
        format!("{address}:{https_port}")
    }
    pub async fn https_address(&mut self) -> Result<String, HostError<C::Error>> {
        let https_port = self.https_port().await?;
        Ok(Self::build_https_address(&self.address, https_port))
    }
    pub async fn external_port(&mut self) -> Result<u16, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.external_port)
    }

    pub async fn host_name(&mut self) -> Result<&str, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.host_name.as_str())
    }
    pub async fn version(&mut self) -> Result<ServerVersion, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.app_version)
    }

    pub async fn gfe_version(&mut self) -> Result<&str, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.gfe_version.as_str())
    }
    pub async fn unique_id(&mut self) -> Result<Uuid, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.unique_id)
    }

    /// Returns None if unpaired
    pub async fn mac(&mut self) -> Result<Option<MacAddress>, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.mac)
    }
    pub async fn local_ip(&mut self) -> Result<&str, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.local_ip.as_str())
    }

    pub async fn current_game(&mut self) -> Result<u32, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.current_game)
    }

    pub async fn state(&mut self) -> Result<(&str, ServerState), HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok((info.state_string.as_str(), info.state))
    }
    pub async fn is_nvidia_software(&mut self) -> Result<bool, HostError<C::Error>> {
        let (state_str, _) = self.state().await?;
        // Real Nvidia host software (GeForce Experience and RTX Experience) both use the 'Mjolnir'
        // codename in the state field and no version of Sunshine does. We can use this to bypass
        // some assumptions about Nvidia hardware that don't apply to Sunshine hosts.
        Ok(state_str.contains("Mjolnir"))
    }

    pub async fn max_luma_pixels_hevc(&mut self) -> Result<u32, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.max_luma_pixels_hevc)
    }
    pub async fn server_codec_mode_support_raw(&mut self) -> Result<u32, HostError<C::Error>> {
        let info = self.host_info().await?;
        Ok(info.server_codec_mode_support)
    }

    #[cfg(feature = "stream")]
    pub async fn server_codec_mode_support(
        &mut self,
    ) -> Result<crate::stream::bindings::ServerCodeModeSupport, HostError<C::Error>> {
        use crate::stream::bindings::ServerCodeModeSupport;

        let bits = self.server_codec_mode_support_raw().await?;
        Ok(ServerCodeModeSupport::from_bits(bits).expect("valid server code mode support"))
    }

    pub fn set_pairing_info(
        &mut self,
        client_auth: &ClientAuth,
        server_certificate: &Pem,
    ) -> Result<(), HostError<C::Error>> {
        self.client = C::with_certificates(
            &client_auth.private_key,
            &client_auth.certificate,
            server_certificate,
        )
        .map_err(ApiError::RequestClient)?;

        self.paired = Some(Paired {
            client_private_key: client_auth.private_key.clone(),
            client_certificate: client_auth.certificate.clone(),
            server_certificate: server_certificate.clone(),
            cache_app_list: None,
        });

        Ok(())
    }

    pub async fn verify_paired(&mut self) -> Result<PairStatus, HostError<C::Error>> {
        let https_address = match self.https_address().await {
            Err(err) => return Err(err),
            Ok(value) => value,
        };

        let client_info = ClientInfo {
            unique_id: &self.client_unique_id,
            uuid: Uuid::new_v4(),
        };

        let info = host_info(&mut self.client, true, &https_address, Some(client_info)).await?;

        let pair_status = info.pair_status;
        self.cache_info = Some(info);

        Ok(pair_status)
    }

    pub fn clear_pairing_info(&mut self) -> Result<(), HostError<C::Error>> {
        self.client = C::with_defaults().map_err(ApiError::RequestClient)?;
        self.paired = None;

        Ok(())
    }

    pub fn is_paired(&self) -> PairStatus {
        if self.paired.is_some() {
            PairStatus::Paired
        } else {
            PairStatus::NotPaired
        }
    }

    pub fn client_private_key(&self) -> Option<&Pem> {
        self.paired.as_ref().map(|x| &x.client_private_key)
    }
    pub fn client_certificate(&self) -> Option<&Pem> {
        self.paired.as_ref().map(|x| &x.client_certificate)
    }
    pub fn server_certificate(&self) -> Option<&Pem> {
        self.paired.as_ref().map(|x| &x.server_certificate)
    }

    pub async fn pair(
        &mut self,
        auth: &ClientAuth,
        device_name: String,
        pin: PairPin,
    ) -> Result<(), HostError<C::Error>> {
        let http_address = self.http_address();
        let server_version = self.version().await?;
        let https_address = self.https_address().await?;

        let client_info = ClientInfo {
            unique_id: &self.client_unique_id,
            uuid: Uuid::new_v4(),
        };

        let mut client = C::with_defaults_long_timeout().map_err(ApiError::RequestClient)?;

        let PairSuccess {
            server_certificate,
            client: new_client,
        } = host_pair(
            &mut client,
            &http_address,
            &https_address,
            client_info,
            &auth.private_key,
            &auth.certificate,
            &device_name,
            server_version,
            pin,
        )
        .await?;

        self.client = new_client;

        self.paired = Some(Paired {
            client_private_key: auth.private_key.clone(),
            client_certificate: auth.certificate.clone(),
            server_certificate,
            cache_app_list: None,
        });

        let Some(info) = self.cache_info.as_mut() else {
            unreachable!()
        };
        info.pair_status = PairStatus::Paired;

        self.clear_cache();

        Ok(())
    }

    fn check_paired(&self) -> Result<(), HostError<C::Error>> {
        if self.is_paired() == PairStatus::Paired {
            Ok(())
        } else {
            Err(HostError::NotPaired)
        }
    }

    pub async fn unpair(&mut self) -> Result<(), HostError<C::Error>> {
        self.check_paired()?;

        let http_address = self.http_address();
        let client_info = ClientInfo {
            unique_id: &self.client_unique_id,
            uuid: Uuid::new_v4(),
        };

        host_unpair(&mut self.client, &http_address, client_info).await?;

        self.clear_pairing_info()?;

        Ok(())
    }

    pub async fn app_list(&mut self) -> Result<&[App], HostError<C::Error>> {
        self.check_paired()?;

        let https_address = self.https_address().await?;
        let client_info = ClientInfo {
            unique_id: &self.client_unique_id,
            uuid: Uuid::new_v4(),
        };

        let Some(paired) = self.paired.as_mut() else {
            return Err(HostError::NotPaired);
        };

        // Recache
        if paired.cache_app_list.is_none() {
            let response = host_app_list(&mut self.client, &https_address, client_info).await?;

            paired.cache_app_list = Some(response);
        }

        let Some(cache_app_list) = &paired.cache_app_list else {
            unreachable!()
        };

        Ok(cache_app_list.apps.as_slice())
    }

    pub async fn request_app_image(
        &mut self,
        app_id: u32,
    ) -> Result<C::Bytes, HostError<C::Error>> {
        self.check_paired()?;

        let https_address = self.https_address().await?;

        let client_info = ClientInfo {
            unique_id: &self.client_unique_id,
            uuid: Uuid::new_v4(),
        };

        let response = host_app_box_art(
            &mut self.client,
            &https_address,
            client_info,
            ClientAppBoxArtRequest { app_id },
        )
        .await?;

        Ok(response)
    }

    pub async fn cancel(&mut self) -> Result<bool, HostError<C::Error>> {
        self.check_paired()?;

        let https_hostport = self.https_address().await?;

        let client_info = ClientInfo {
            unique_id: &self.client_unique_id,
            uuid: Uuid::new_v4(),
        };

        let response = host_cancel(&mut self.client, &https_hostport, client_info).await?;

        self.clear_cache();

        let current_game = self.current_game().await?;
        if current_game != 0 {
            // We're not the device that opened this session
            return Ok(false);
        }

        Ok(response)
    }
}

#[cfg(feature = "stream")]
mod stream {
    use openssl::rand::rand_bytes;
    use tokio::task::spawn_blocking;
    use uuid::Uuid;

    use crate::{
        high::{HostError, MoonlightHost, StreamConfigError},
        network::{
            ClientInfo,
            launch::{ClientStreamRequest, host_launch, host_resume},
            request_client::RequestClient,
        },
        pair::PairError,
        stream::{
            MoonlightInstance, MoonlightStream, ServerInfo,
            audio::AudioDecoder,
            bindings::{
                ActiveGamepads, ColorRange, Colorspace, EncryptionFlags, ServerCodeModeSupport,
                StreamConfiguration, StreamingConfig, SupportedVideoFormats,
            },
            connection::ConnectionListener,
            video::VideoDecoder,
        },
    };

    impl<C> MoonlightHost<C>
    where
        C: RequestClient,
    {
        // Stream config correction
        pub async fn is_hdr_supported(&mut self) -> Result<bool, HostError<C::Error>> {
            let server_codec_mode_support = self.server_codec_mode_support().await?;

            Ok(
                server_codec_mode_support.contains(ServerCodeModeSupport::HEVC_MAIN10)
                    || server_codec_mode_support.contains(ServerCodeModeSupport::AV1_MAIN10),
            )
        }
        pub async fn is_4k_supported(&mut self) -> Result<bool, HostError<C::Error>> {
            let is_nvidia = self.is_nvidia_software().await?;
            let server_codec_mode_support = self.server_codec_mode_support().await?;

            Ok(
                server_codec_mode_support.contains(ServerCodeModeSupport::HEVC_MAIN10)
                    || !is_nvidia,
            )
        }
        pub async fn is_4k_supported_gfe(&mut self) -> Result<bool, HostError<C::Error>> {
            let gfe = self.gfe_version().await?;

            Ok(!gfe.starts_with("2."))
        }

        pub async fn is_resolution_supported(
            &mut self,
            width: usize,
            height: usize,
            supported_video_formats: SupportedVideoFormats,
        ) -> Result<(), HostError<C::Error>> {
            let resolution_above_4k = width > 4096 || height > 4096;

            if resolution_above_4k && !self.is_4k_supported().await? {
                return Err(StreamConfigError::NotSupported4k.into());
            } else if resolution_above_4k
                && supported_video_formats.contains(!SupportedVideoFormats::MASK_H264)
            {
                return Err(StreamConfigError::NotSupported4kCodecMissing.into());
            } else if height > 2160 && self.is_4k_supported_gfe().await? {
                return Err(StreamConfigError::NotSupported4kUpdateGfe.into());
            }

            Ok(())
        }

        pub async fn should_disable_sops(
            &mut self,
            width: usize,
            height: usize,
        ) -> Result<bool, HostError<C::Error>> {
            // Using an unsupported resolution (not 720p, 1080p, or 4K) causes
            // GFE to force SOPS to 720p60. This is fine for < 720p resolutions like
            // 360p or 480p, but it is not ideal for 1440p and other resolutions.
            // When we detect an unsupported resolution, disable SOPS unless it's under 720p.
            // FIXME: Detect support resolutions using the serverinfo response, not a hardcoded list
            const NVIDIA_SUPPORTED_RESOLUTIONS: &[(usize, usize)] =
                &[(1280, 720), (1920, 1080), (3840, 2160)];

            let is_nvidia = self.is_nvidia_software().await?;

            Ok(!NVIDIA_SUPPORTED_RESOLUTIONS.contains(&(width, height)) && is_nvidia)
        }

        pub async fn start_stream(
            &mut self,
            instance: &MoonlightInstance,
            app_id: u32,
            width: u32,
            height: u32,
            mut fps: u32,
            hdr: bool,
            mut sops: bool,
            local_audio_play_mode: bool,
            gamepads_attached: ActiveGamepads,
            gamepads_persist_after_disconnect: bool,
            color_space: Colorspace,
            color_range: ColorRange,
            bitrate: u32,
            packet_size: u32,
            encryption_flags: EncryptionFlags,
            connection_listener: impl ConnectionListener + Send + Sync + 'static,
            video_decoder: impl VideoDecoder + Send + 'static,
            audio_decoder: impl AudioDecoder + Send + 'static,
        ) -> Result<MoonlightStream, HostError<C::Error>> {
            // Change streaming options if required

            if hdr && !self.is_hdr_supported().await? {
                return Err(HostError::StreamConfig(StreamConfigError::NotSupportedHdr));
            }

            self.is_resolution_supported(
                width as usize,
                height as usize,
                video_decoder.supported_formats(),
            )
            .await?;

            if self.is_nvidia_software().await? {
                // Using an FPS value over 60 causes SOPS to default to 720p60,
                // so force it to 0 to ensure the correct resolution is set. We
                // used to use 60 here but that locked the frame rate to 60 FPS
                // on GFE 3.20.3. We don't need this hack for Sunshine.
                if fps > 60 {
                    fps = 0;
                }

                if self
                    .should_disable_sops(width as usize, height as usize)
                    .await?
                {
                    sops = false;
                }
            }

            // Clearing cache so we refresh and can see if there's a game -> launch or resume?
            self.clear_cache();

            let address = self.address.clone();
            let https_address = self.https_address().await?;

            let current_game = self.current_game().await?;

            let mut aes_key = [0u8; 16];
            rand_bytes(&mut aes_key).map_err(PairError::from)?;

            let mut aes_iv = [0u8; 4];
            rand_bytes(&mut aes_iv).map_err(PairError::from)?;
            let aes_iv = u32::from_be_bytes(aes_iv);

            let request = ClientStreamRequest {
                app_id,
                mode_width: width,
                mode_height: height,
                mode_fps: fps,
                hdr,
                sops,
                local_audio_play_mode,
                gamepads_attached_mask: gamepads_attached.bits() as i32,
                gamepads_persist_after_disconnect,
                ri_key: aes_key,
                ri_key_id: aes_iv,
            };

            let client_info = ClientInfo {
                unique_id: &self.client_unique_id,
                uuid: Uuid::new_v4(),
            };

            let rtsp_session_url = if current_game == 0 {
                let launch_response = host_launch(
                    instance,
                    &mut self.client,
                    &https_address,
                    client_info,
                    request,
                )
                .await?;

                launch_response.rtsp_session_url
            } else {
                let resume_response = host_resume(
                    instance,
                    &mut self.client,
                    &https_address,
                    client_info,
                    request,
                )
                .await?;

                resume_response.rtsp_session_url
            };

            let app_version = self.version().await?;
            let server_codec_mode_support = self.server_codec_mode_support().await?;
            let gfe_version = self.gfe_version().await?.to_owned();

            let instance_clone = instance.clone();
            let connection = spawn_blocking(move || {
                let server_info = ServerInfo {
                    address: &address,
                    app_version,
                    gfe_version: &gfe_version,
                    rtsp_session_url: &rtsp_session_url,
                    server_codec_mode_support,
                };

                let stream_config = StreamConfiguration {
                    width: width as i32,
                    height: height as i32,
                    fps: fps as i32,
                    bitrate: bitrate as i32,
                    packet_size: packet_size as i32,
                    streaming_remotely: StreamingConfig::Auto,
                    audio_configuration: audio_decoder.config().raw() as i32,
                    supported_video_formats: video_decoder.supported_formats(),
                    client_refresh_rate_x100: (fps * 100) as i32,
                    color_space,
                    color_range,
                    encryption_flags,
                    remote_input_aes_key: aes_key,
                    remote_input_aes_iv: aes_iv,
                };

                instance_clone.start_connection(
                    server_info,
                    stream_config,
                    connection_listener,
                    video_decoder,
                    audio_decoder,
                )
            })
            .await??;

            // Clear cache because now there's an active app
            self.clear_cache();

            Ok(connection)
        }
    }
}
