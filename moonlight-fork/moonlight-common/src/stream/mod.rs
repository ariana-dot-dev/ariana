use std::{
    ffi::{CStr, CString},
    os::raw::{c_char, c_int, c_schar, c_short, c_uchar, c_uint},
    ptr::null_mut,
    str::FromStr,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

use moonlight_common_sys::limelight::{
    _SERVER_INFORMATION, _STREAM_CONFIGURATION, LI_BATTERY_PERCENTAGE_UNKNOWN, LI_ERR_UNSUPPORTED,
    LI_ROT_UNKNOWN, LiGetEstimatedRttInfo, LiGetHostFeatureFlags, LiGetLaunchUrlQueryParameters,
    LiInterruptConnection, LiSendControllerArrivalEvent, LiSendControllerBatteryEvent,
    LiSendControllerEvent, LiSendControllerMotionEvent, LiSendControllerTouchEvent,
    LiSendHScrollEvent, LiSendHighResHScrollEvent, LiSendHighResScrollEvent, LiSendKeyboardEvent,
    LiSendKeyboardEvent2, LiSendMouseButtonEvent, LiSendMouseMoveAsMousePositionEvent,
    LiSendMouseMoveEvent, LiSendMousePositionEvent, LiSendMultiControllerEvent, LiSendScrollEvent,
    LiSendTouchEvent, LiSendUtf8TextEvent, LiStartConnection, LiStopConnection,
    PAUDIO_RENDERER_CALLBACKS, PCONNECTION_LISTENER_CALLBACKS, PDECODER_RENDERER_CALLBACKS,
    PSERVER_INFORMATION, PSTREAM_CONFIGURATION,
};

use crate::{
    MoonlightError, ServerVersion,
    stream::{
        audio::AudioDecoder,
        bindings::{
            ActiveGamepads, BatteryState, ControllerButtons, ControllerCapabilities,
            ControllerType, EstimatedRttInfo, HostFeatures, KeyAction, KeyFlags, KeyModifiers,
            MotionType, MouseButton, MouseButtonAction, ServerCodeModeSupport, StreamConfiguration,
            TouchEventType,
        },
        connection::ConnectionListener,
        video::VideoDecoder,
    },
};

pub mod audio;
pub mod bindings;
pub mod connection;
pub mod debug;
pub mod video;

static INSTANCE: LazyLock<Arc<Handle>> = LazyLock::new(|| {
    Arc::new(Handle {
        connection_exists: Mutex::new(false),
    })
});

pub(crate) struct Handle {
    /// This is also the lock because start / stop Connection is not thread safe
    connection_exists: Mutex<bool>,
}

impl Handle {
    fn aquire() -> Option<Arc<Self>> {
        Some(Arc::clone(&INSTANCE))
    }
}

#[derive(Clone)]
pub struct MoonlightInstance {
    handle: Arc<Handle>,
}

impl MoonlightInstance {
    pub fn global() -> Result<Self, MoonlightError> {
        let handle = Handle::aquire().ok_or(MoonlightError::InstanceAquire)?;

        Ok(Self { handle })
    }

    pub fn launch_url_query_parameters(&self) -> &str {
        unsafe {
            // # Safety
            // The returned string is not freed by the caller and lives long enough
            // https://github.com/moonlight-stream/moonlight-common-c/blob/5f2280183cb62cba1052894d76e64e5f4153377d/src/Connection.c#L537
            let str_raw = LiGetLaunchUrlQueryParameters();
            let str = CStr::from_ptr(str_raw);
            str.to_str().expect("valid moonlight query parameters")
        }
    }

    pub fn start_connection(
        &self,
        server_info: ServerInfo,
        stream_config: StreamConfiguration,
        connection_listener: impl ConnectionListener + Send + 'static,
        video_decoder: impl VideoDecoder + Send + 'static,
        audio_decoder: impl AudioDecoder + Send + 'static,
    ) -> Result<MoonlightStream, MoonlightError> {
        MoonlightStream::start(
            self.handle.clone(),
            server_info,
            stream_config,
            connection_listener,
            video_decoder,
            audio_decoder,
        )
    }

    pub fn interrupt_connection(&self) {
        unsafe {
            LiInterruptConnection();
        }
    }
}

// --------------- Stream ---------------

pub struct ServerInfo<'a> {
    pub address: &'a str,
    pub app_version: ServerVersion,
    pub gfe_version: &'a str,
    pub rtsp_session_url: &'a str,
    pub server_codec_mode_support: ServerCodeModeSupport,
}

pub struct MoonlightStream {
    handle: Arc<Handle>,
}

fn to_c_char_array(bytes: [u8; 16]) -> [c_char; 16] {
    bytes.map(|b| b as c_char)
}

impl MoonlightStream {
    pub(crate) fn start(
        handle: Arc<Handle>,
        server_info: ServerInfo,
        stream_config: StreamConfiguration,
        connection_listener: impl ConnectionListener + Send + 'static,
        video_decoder: impl VideoDecoder + Send + 'static,
        audio_decoder: impl AudioDecoder + Send + 'static,
    ) -> Result<Self, MoonlightError> {
        unsafe {
            let mut connection_guard = handle
                .connection_exists
                .lock()
                .expect("connection lock poisoned");
            if *connection_guard {
                return Err(MoonlightError::ConnectionAlreadyExists);
            }

            *connection_guard = true;

            drop(connection_guard);

            let address = CString::from_str(server_info.address)?;
            let app_version = server_info.app_version.to_string();
            let app_version = CString::from_str(&app_version)?;
            let gfe_version = CString::from_str(server_info.gfe_version)?;
            let rtsp_session_url = CString::from_str(server_info.rtsp_session_url)?;

            let mut server_info_raw = _SERVER_INFORMATION {
                address: address.as_ptr(),
                serverInfoAppVersion: app_version.as_ptr(),
                serverInfoGfeVersion: gfe_version.as_ptr(),
                rtspSessionUrl: rtsp_session_url.as_ptr(),
                serverCodecModeSupport: server_info.server_codec_mode_support.bits() as i32,
            };

            let mut stream_config = _STREAM_CONFIGURATION {
                width: stream_config.width,
                height: stream_config.height,
                fps: stream_config.fps,
                bitrate: stream_config.bitrate,
                packetSize: stream_config.packet_size,
                streamingRemotely: stream_config.streaming_remotely as u32 as i32,
                audioConfiguration: stream_config.audio_configuration,
                supportedVideoFormats: stream_config.supported_video_formats.bits() as i32,
                clientRefreshRateX100: stream_config.client_refresh_rate_x100,
                colorSpace: stream_config.color_space as u32 as i32,
                colorRange: stream_config.color_range as u32 as i32,
                encryptionFlags: stream_config.encryption_flags.bits() as i32,
                remoteInputAesKey: to_c_char_array(stream_config.remote_input_aes_key),
                remoteInputAesIv: to_c_char_array({
                    let mut iv = [0u8; 16];
                    iv[0..4].copy_from_slice(&stream_config.remote_input_aes_iv.to_be_bytes());
                    iv
                }),
            };

            // If something panics this will be dropped -> connection_guard is false again
            let this = Self { handle };

            connection::set_global(connection_listener);
            let mut connection_callbacks = connection::raw_callbacks();

            video::set_global(video_decoder);
            let mut video_callbacks = video::raw_callbacks();

            audio::set_global(audio_decoder);
            let mut audio_callbacks = audio::raw_callbacks();

            // # Safety
            // LiStartConnection is not thread safe so we are using the connection_guard mutex
            let result = LiStartConnection(
                &mut server_info_raw as PSERVER_INFORMATION,
                &mut stream_config as PSTREAM_CONFIGURATION,
                &mut connection_callbacks as PCONNECTION_LISTENER_CALLBACKS,
                &mut video_callbacks as PDECODER_RENDERER_CALLBACKS,
                &mut audio_callbacks as PAUDIO_RENDERER_CALLBACKS,
                null_mut(),
                0,
                null_mut(),
                0,
            );

            if result != 0 {
                return Err(MoonlightError::ConnectionFailed);
            }

            Ok(this)
        }
    }

    // For internal use only as it's possible for this connection to be cancelled
    // and then the next connection setting connection_exists to true
    fn is_connected(&self) -> bool {
        let result = self.handle.connection_exists.lock();

        result.map(|x| *x).unwrap_or(false)
    }

    /// This function returns any extended feature flags supported by the host.
    pub fn host_features(&self) -> Result<HostFeatures, MoonlightError> {
        if !self.is_connected() {
            return Err(MoonlightError::ConnectionFailed);
        }

        let features = unsafe { LiGetHostFeatureFlags() };

        Ok(HostFeatures::from_bits(features).expect("valid host feature flags"))
    }

    /// This function returns an estimate of the current RTT to the host PC obtained via ENet
    /// protocol statistics. This function will fail if the current GFE version does not use
    /// ENet for the control stream (very old versions), or if the ENet peer is not connected.
    /// This function may only be called between LiStartConnection() and LiStopConnection().
    pub fn estimated_rtt_info(&self) -> Result<EstimatedRttInfo, MoonlightError> {
        unsafe {
            let mut rtt = 0u32;
            let mut rtt_variance = 0u32;

            if !LiGetEstimatedRttInfo(&mut rtt as *mut _, &mut rtt_variance as *mut _) {
                if self.is_connected() {
                    return Err(MoonlightError::ConnectionFailed);
                }
                return Err(MoonlightError::ENetRequired);
            }

            Ok(EstimatedRttInfo {
                rtt: Duration::from_millis(rtt as u64),
                rtt_variance: Duration::from_millis(rtt_variance as u64),
            })
        }
    }

    fn send_event_error(error: i32) -> Option<MoonlightError> {
        match error {
            0 => None,
            LI_ERR_UNSUPPORTED => Some(MoonlightError::NotSupportedOnHost),
            _ => Some(MoonlightError::EventSendError(error)),
        }
    }

    /// This function queues a relative mouse move event to be sent to the remote server.
    pub fn send_mouse_move(&self, delta_x: i16, delta_y: i16) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendMouseMoveEvent(delta_x, delta_y)) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues a mouse position update event to be sent to the remote server.
    /// This functionality is only reliably supported on GFE 3.20 or later. Earlier versions
    /// may not position the mouse correctly.
    ///
    /// Absolute mouse motion doesn't work in many games, so this mode should not be the default
    /// for mice when streaming. It may be desirable as the default touchscreen behavior when
    /// LiSendTouchEvent() is not supported and the touchscreen is not the primary input method.
    /// In the latter case, a touchscreen-as-trackpad mode using LiSendMouseMoveEvent() is likely
    /// to be better for gaming use cases.
    ///
    /// The x and y values are transformed to host coordinates as if they are from a plane which
    /// is referenceWidth by referenceHeight in size. This allows you to provide coordinates that
    /// are relative to an arbitrary plane, such as a window, screen, or scaled video view.
    ///
    /// For example, if you wanted to directly pass window coordinates as x and y, you would set
    /// referenceWidth and referenceHeight to your window width and height.
    pub fn send_mouse_position(
        &self,
        absolute_x: i16,
        absolute_y: i16,
        reference_width: i16,
        reference_height: i16,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendMousePositionEvent(
                absolute_x,
                absolute_y,
                reference_width,
                reference_height,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues a mouse position update event to be sent to the remote server, so
    /// all of the limitations of LiSendMousePositionEvent() mentioned above apply here too!
    ///
    /// This function behaves like a combination of LiSendMouseMoveEvent() and LiSendMousePositionEvent()
    /// in that it sends a relative motion event, however it sends this data as an absolute position
    /// based on the computed position of a virtual client cursor which is "moved" any time that
    /// LiSendMousePositionEvent() or LiSendMouseMoveAsMousePositionEvent() is called. As a result
    /// of this internal virtual cursor state, callers must ensure LiSendMousePositionEvent() and
    /// LiSendMouseMoveAsMousePositionEvent() are not called concurrently!
    ///
    /// The big advantage of this function is that it allows callers to avoid mouse acceleration that
    /// would otherwise affect motion when using LiSendMouseMoveEvent(). The downside is that it has the
    /// same game compatibility issues as LiSendMousePositionEvent().
    ///
    /// This function can be useful when mouse capture is the only feasible way to receive mouse input,
    /// like on Android or iOS, and the OS cannot provide raw unaccelerated mouse motion when capturing.
    /// Using this function avoids double-acceleration in cases when the client motion is also accelerated.
    pub fn send_mouse_move_as_position(
        &self,
        delta_x: i16,
        delta_y: i16,
        reference_width: i16,
        reference_height: i16,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendMouseMoveAsMousePositionEvent(
                delta_x,
                delta_y,
                reference_width,
                reference_height,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function allows multi-touch input to be sent directly to Sunshine hosts. The x and y values
    /// are normalized device coordinates stretching top-left corner (0.0, 0.0) to bottom-right corner
    /// (1.0, 1.0) of the video area.
    ///
    /// Pointer ID is an opaque ID that must uniquely identify each active touch on screen. It must
    /// remain constant through any down/up/move/cancel events involved in a single touch interaction.
    ///
    /// Rotation is in degrees from vertical in Y dimension (parallel to screen, 0..360). If rotation is
    /// unknown, pass LI_ROT_UNKNOWN.
    ///
    /// Pressure is a 0.0 to 1.0 range value from min to max pressure. Sending a down/move event with
    /// a pressure of 0.0 indicates the actual pressure is unknown.
    ///
    /// For hover events, the pressure value is treated as a 1.0 to 0.0 range of distance from the touch
    /// surface where 1.0 is the farthest measurable distance and 0.0 is actually touching the display
    /// (which is invalid for a hover event). Reporting distance 0.0 for a hover event indicates the
    /// actual distance is unknown.
    ///
    /// Contact area is modelled as an ellipse with major and minor axis values in normalized device
    /// coordinates. If contact area is unknown, report 0.0 for both contact area axis parameters.
    /// For circular contact areas or if a minor axis value is not available, pass the same value
    /// for major and minor axes. For APIs or devices, that don't report contact area as an ellipse,
    /// approximations can be used such as: https://docs.kernel.org/input/multi-touch-protocol.html#event-computation
    ///
    /// For hover events, the "contact area" is the size of the hovering finger/tool. If unavailable,
    /// pass 0.0 for both contact area parameters.
    ///
    /// Touches can be cancelled using LI_TOUCH_EVENT_CANCEL or LI_TOUCH_EVENT_CANCEL_ALL. When using
    /// LI_TOUCH_EVENT_CANCEL, only the pointerId parameter is valid. All other parameters are ignored.
    /// To cancel all active touches (on focus loss, for example), use LI_TOUCH_EVENT_CANCEL_ALL.
    ///
    /// If unsupported by the host, this will return LI_ERR_UNSUPPORTED and the caller should consider
    /// falling back to other functions to send this input (such as LiSendMousePositionEvent()).
    ///
    /// To determine if LiSendTouchEvent() is supported without calling it, call LiGetHostFeatureFlags()
    /// and check for the LI_FF_PEN_TOUCH_EVENTS flag.
    pub fn send_touch(
        &self,
        pointer_id: u32,
        x: f32,
        y: f32,
        pressure_or_distance: f32,
        contact_area_major: f32,
        contact_area_minor: f32,
        rotation: Option<u16>,
        event_type: TouchEventType,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendTouchEvent(
                event_type as u32 as u8,
                pointer_id,
                x,
                y,
                pressure_or_distance,
                contact_area_major,
                contact_area_minor,
                rotation.unwrap_or(LI_ROT_UNKNOWN as u16),
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues a mouse button event to be sent to the remote server.
    pub fn send_mouse_button(
        &self,
        action: MouseButtonAction,
        button: MouseButton,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) =
                Self::send_event_error(LiSendMouseButtonEvent(action as c_char, button as c_int))
            {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues a keyboard event to be sent to the remote server.
    /// Key codes are Win32 Virtual Key (VK) codes and interpreted as keys on
    /// a US English layout.
    pub fn send_keyboard_event(
        &self,
        code: i16,
        action: KeyAction,
        modifiers: KeyModifiers,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendKeyboardEvent(
                code as c_short,
                action as c_char,
                modifiers.bits() as c_char,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// Similar to LiSendKeyboardEvent() but allows the client to inform the host that
    /// the keycode was not mapped to a standard US English scancode and should be
    /// interpreted as-is. This is a Sunshine protocol extension.
    pub fn send_keyboard_event_non_standard(
        &self,
        key_code: i16,
        key_action: KeyAction,
        modifiers: KeyModifiers,
        flags: KeyFlags,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendKeyboardEvent2(
                key_code as c_short,
                key_action as c_char,
                modifiers.bits() as c_char,
                flags.bits() as c_char,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues an UTF-8 encoded text to be sent to the remote server.
    pub fn send_text(&self, text: &str) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendUtf8TextEvent(
                text.as_ptr() as *const c_char,
                text.len() as c_uint,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues a vertical scroll event to the remote server.
    /// The number of "clicks" is multiplied by WHEEL_DELTA (120) before
    /// being sent to the PC.
    pub fn send_scroll(&self, scroll_clicks: i8) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendScrollEvent(scroll_clicks as c_schar)) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues a vertical scroll event to the remote server.
    /// Unlike LiSendScrollEvent(), this function can send wheel events
    /// smaller than 120 units for devices that support "high resolution"
    /// scrolling (Apple Trackpads, Microsoft Precision Touchpads, etc.).
    pub fn send_high_res_scroll(&self, scroll_amount: i16) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) =
                Self::send_event_error(LiSendHighResScrollEvent(scroll_amount as c_short))
            {
                return Err(err);
            }
        }
        Ok(())
    }

    /// These functions send horizontal scroll events to the host which are
    /// analogous to LiSendScrollEvent() and LiSendHighResScrollEvent().
    /// This is a Sunshine protocol extension.
    pub fn send_horizontal_scroll(&self, scroll_clicks: i8) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendHScrollEvent(scroll_clicks as c_schar))
            {
                return Err(err);
            }
        }
        Ok(())
    }

    /// These functions send horizontal scroll events to the host which are
    /// analogous to LiSendScrollEvent() and LiSendHighResScrollEvent().
    /// This is a Sunshine protocol extension.
    pub fn send_high_res_horizontal_scroll(
        &self,
        scroll_amount: i16,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) =
                Self::send_event_error(LiSendHighResHScrollEvent(scroll_amount as c_short))
            {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues a controller event to be sent to the remote server. It will
    /// be seen by the computer as the first controller.
    pub fn send_controller(
        &self,
        buttons: ControllerButtons,
        left_trigger: u8,
        right_trigger: u8,
        left_stick_x: i16,
        left_stick_y: i16,
        right_stick_x: i16,
        right_stick_y: i16,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendControllerEvent(
                buttons.bits() as c_int,
                left_trigger as c_uchar,
                right_trigger as c_uchar,
                left_stick_x as c_short,
                left_stick_y as c_short,
                right_stick_x as c_short,
                right_stick_y as c_short,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function queues a controller event to be sent to the remote server. The controllerNumber
    /// parameter is a zero-based index of which controller this event corresponds to. The largest legal
    /// controller number is 3 for GFE hosts and 15 for Sunshine hosts. On generation 3 servers (GFE 2.1.x),
    /// these will be sent as controller 0 regardless of the controllerNumber parameter.
    ///
    /// The activeGamepadMask parameter is a bitfield with bits set for each controller present.
    /// On GFE, activeGamepadMask is limited to a maximum of 4 bits (0xF).
    /// On Sunshine, it is limited to 16 bits (0xFFFF).
    ///
    /// To indicate arrival of a gamepad, you may send an empty event with the controller number
    /// set to the new controller and the bit of the new controller set in the active gamepad mask.
    /// However, you should prefer LiSendControllerArrivalEvent() instead of this function for
    /// that purpose, because it allows the host to make a better choice of emulated controller.
    ///
    /// To indicate removal of a gamepad, send an empty event with the controller number set to the
    /// removed controller and the bit of the removed controller cleared in the active gamepad mask.
    pub fn send_multi_controller(
        &self,
        controller_number: u8,
        active_gamepads: ActiveGamepads,
        buttons: ControllerButtons,
        left_trigger: u8,
        right_trigger: u8,
        left_stick_x: i16,
        left_stick_y: i16,
        right_stick_x: i16,
        right_stick_y: i16,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendMultiControllerEvent(
                controller_number as c_short,
                active_gamepads.bits() as c_short,
                buttons.bits() as c_int,
                left_trigger as c_uchar,
                right_trigger as c_uchar,
                left_stick_x as c_short,
                left_stick_y as c_short,
                right_stick_x as c_short,
                right_stick_y as c_short,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function provides a method of informing the host of the available buttons and capabilities
    /// on a new controller. This is the recommended approach for indicating the arrival of a new controller.
    ///
    /// This can allow the host to make better decisions about what type of controller to emulate and what
    /// capabilities to advertise to the OS on the virtual controller.
    ///
    /// If controller arrival events are unsupported by the host, this will fall back to indicating
    /// arrival via LiSendMultiControllerEvent().
    pub fn send_controller_arrival(
        &self,
        controller_number: u8,
        active_gamepads: ActiveGamepads,
        ty: ControllerType,
        supported_button_flags: ControllerButtons,
        capabilities: ControllerCapabilities,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendControllerArrivalEvent(
                controller_number,
                active_gamepads.bits(),
                ty as u8,
                supported_button_flags.bits(),
                capabilities.bits(),
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function is similar to LiSendTouchEvent(), but the touch events are associated with a
    /// touchpad device present on a game controller instead of a touchscreen.
    ///
    /// If unsupported by the host, this will return LI_ERR_UNSUPPORTED and the caller should consider
    /// using this touch input to simulate trackpad input.
    ///
    /// To determine if LiSendControllerTouchEvent() is supported without calling it, call LiGetHostFeatureFlags()
    /// and check for the LI_FF_CONTROLLER_TOUCH_EVENTS flag.
    pub fn send_controller_touch_event(
        &self,
        controller_number: u8,
        event_type: TouchEventType,
        pointer_id: u32,
        x: f32,
        y: f32,
        pressure: f32,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendControllerTouchEvent(
                controller_number,
                event_type as u8,
                pointer_id,
                x,
                y,
                pressure,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// This function allows clients to send controller-associated motion events to a supported host.
    ///
    /// For power and performance reasons, motion sensors should not be enabled unless the host has
    /// explicitly asked for motion event reports via ConnListenerSetMotionEventState().
    ///
    /// LI_MOTION_TYPE_ACCEL should report data in m/s^2 (inclusive of gravitational acceleration).
    /// LI_MOTION_TYPE_GYRO should report data in deg/s.
    ///
    /// The x/y/z axis assignments follow SDL's convention documented here:
    /// https://github.com/libsdl-org/SDL/blob/96720f335002bef62115e39327940df454d78f6c/include/SDL3/SDL_sensor.h#L80-L124
    pub fn send_controller_motion_event(
        &self,
        controller_number: u8,
        motion_type: MotionType,
        x: f32,
        y: f32,
        z: f32,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendControllerMotionEvent(
                controller_number,
                motion_type.bits(),
                x,
                y,
                z,
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    /// Sends the battery state of a controller to the remote host.
    pub fn send_controller_battery_event(
        &self,
        controller_number: u8,
        battery_state: BatteryState,
        battery_percentage: Option<u8>,
    ) -> Result<(), MoonlightError> {
        unsafe {
            if let Some(err) = Self::send_event_error(LiSendControllerBatteryEvent(
                controller_number,
                battery_state.bits(),
                battery_percentage.unwrap_or(LI_BATTERY_PERCENTAGE_UNKNOWN as u8),
            )) {
                return Err(err);
            }
        }
        Ok(())
    }

    pub fn stop(self) {
        drop(self);
    }
}

impl Drop for MoonlightStream {
    fn drop(&mut self) {
        unsafe {
            // # Safety
            // LiStopConnection is not thread safe so we need a mutex
            let mut connection_guard = self
                .handle
                .connection_exists
                .lock()
                .expect("connection lock poisoned");

            LiStopConnection();

            // Clear Connection Callbacks
            connection::clear_global();
            video::clear_global();
            audio::clear_global();

            *connection_guard = false;

            drop(connection_guard);
        }
    }
}
