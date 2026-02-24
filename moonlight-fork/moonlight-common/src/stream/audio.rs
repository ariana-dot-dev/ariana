use std::{
    ffi::c_void,
    os::raw::{c_char, c_int},
    slice,
    sync::Mutex,
};

use moonlight_common_sys::limelight::{_AUDIO_RENDERER_CALLBACKS, POPUS_MULTISTREAM_CONFIGURATION};

use crate::stream::bindings::{AudioConfig, Capabilities, OpusMultistreamConfig};

pub trait AudioDecoder {
    /// This callback initializes the audio renderer. The audio configuration parameter
    /// provides the negotiated audio configuration. This may differ from the one
    /// specified in the stream configuration. Returns 0 on success, non-zero on failure.
    fn setup(
        &mut self,
        audio_config: AudioConfig,
        stream_config: OpusMultistreamConfig,
        ar_flags: i32,
    ) -> i32;

    /// This callback notifies the decoder that the stream is starting. No audio can be submitted before this callback returns.
    fn start(&mut self);

    /// This callback notifies the decoder that the stream is stopping. Audio samples may still be submitted but they may be safely discarded.
    fn stop(&mut self);

    /// This callback provides Opus audio data to be decoded and played. sampleLength is in bytes.
    fn decode_and_play_sample(&mut self, data: &[u8]);

    fn config(&self) -> AudioConfig;
    fn capabilities(&self) -> Capabilities {
        Capabilities::empty()
    }
}

static GLOBAL_AUDIO_DECODER: Mutex<Option<Box<dyn AudioDecoder + Send + 'static>>> =
    Mutex::new(None);

fn global_decoder<R>(f: impl FnOnce(&mut dyn AudioDecoder) -> R) -> R {
    let lock = GLOBAL_AUDIO_DECODER.lock();
    let mut lock = lock.expect("global audio decoder");

    let decoder = lock.as_mut().expect("global audio decoder");
    f(decoder.as_mut())
}

pub(crate) fn set_global(decoder: impl AudioDecoder + Send + 'static) {
    let mut global_audio_decoder = GLOBAL_AUDIO_DECODER
        .lock()
        .expect("global audio decoder lock");

    *global_audio_decoder = Some(Box::new(decoder));
}
pub(crate) fn clear_global() {
    let mut decoder = GLOBAL_AUDIO_DECODER.lock().expect("global video decoder");

    *decoder = None;
}

#[allow(non_snake_case)]
unsafe extern "C" fn setup(
    audioConfiguration: c_int,
    opusConfig: POPUS_MULTISTREAM_CONFIGURATION,
    _context: *mut c_void,
    arFlags: c_int,
) -> c_int {
    global_decoder(|decoder| {
        let audio_config =
            AudioConfig::from_raw(audioConfiguration as u32).expect("a valid audio configuration");

        let raw_opus_config = unsafe { *opusConfig };
        let opus_config = OpusMultistreamConfig {
            sample_rate: raw_opus_config.sampleRate as u32,
            channel_count: raw_opus_config.channelCount as u32,
            streams: raw_opus_config.streams as u32,
            coupled_streams: raw_opus_config.coupledStreams as u32,
            samples_per_frame: raw_opus_config.samplesPerFrame as u32,
            mapping: raw_opus_config.mapping,
        };

        decoder.setup(audio_config, opus_config, arFlags)
    })
}
unsafe extern "C" fn start() {
    global_decoder(|decoder| {
        decoder.start();
    })
}

unsafe extern "C" fn decode_and_play_sample(data: *mut c_char, len: c_int) {
    global_decoder(|decoder| unsafe {
        let data = slice::from_raw_parts(data as *mut u8, len as usize);

        decoder.decode_and_play_sample(data);
    })
}

unsafe extern "C" fn stop() {
    global_decoder(|decoder| {
        decoder.stop();
    })
}

unsafe extern "C" fn cleanup() {
    clear_global();
}

pub(crate) unsafe fn raw_callbacks() -> _AUDIO_RENDERER_CALLBACKS {
    let capabilities = global_decoder(|decoder| decoder.capabilities());

    _AUDIO_RENDERER_CALLBACKS {
        init: Some(setup),
        start: Some(start),
        stop: Some(stop),
        cleanup: Some(cleanup),
        decodeAndPlaySample: Some(decode_and_play_sample),
        capabilities: capabilities.bits() as i32,
    }
}
