use std::fmt::Write as _;

use roxmltree::Document;
use uuid::fmt::Hyphenated;

use crate::network::{fmt_write_to_buffer, u32_to_str};
use crate::{
    network::{
        ApiError, ClientInfo,
        request_client::{DynamicQueryParams, QueryBuilder, RequestClient, query_param},
        xml_child_text, xml_root_node,
    },
    stream::MoonlightInstance,
};

#[derive(Debug, Clone)]
pub struct ClientStreamRequest {
    pub app_id: u32,
    pub mode_width: u32,
    pub mode_height: u32,
    pub mode_fps: u32,
    pub sops: bool,
    pub hdr: bool,
    pub local_audio_play_mode: bool,
    pub gamepads_attached_mask: i32,
    pub gamepads_persist_after_disconnect: bool,
    pub ri_key: [u8; 16usize],
    pub ri_key_id: u32,
}

#[derive(Debug, Clone)]
pub struct HostLaunchResponse {
    pub game_session: u32,
    pub rtsp_session_url: String,
}

pub async fn host_launch<C: RequestClient>(
    instance: &MoonlightInstance,
    client: &mut C,
    https_address: &str,
    info: ClientInfo<'_>,
    request: ClientStreamRequest,
) -> Result<HostLaunchResponse, ApiError<C::Error>> {
    let response =
        inner_launch_host(instance, client, https_address, "launch", info, request).await?;

    let doc = Document::parse(response.as_ref())?;
    let root = xml_root_node(&doc)?;

    Ok(HostLaunchResponse {
        game_session: xml_child_text::<C>(root, "gamesession")?.parse()?,
        rtsp_session_url: xml_child_text::<C>(root, "sessionUrl0")?.to_string(),
    })
}

#[derive(Debug, Clone)]
pub struct HostResumeResponse {
    pub resume: u32,
    pub rtsp_session_url: String,
}

pub async fn host_resume<C: RequestClient>(
    instance: &MoonlightInstance,
    client: &mut C,
    https_hostport: &str,
    info: ClientInfo<'_>,
    request: ClientStreamRequest,
) -> Result<HostResumeResponse, ApiError<C::Error>> {
    let response =
        inner_launch_host(instance, client, https_hostport, "resume", info, request).await?;

    let doc = Document::parse(response.as_ref())?;
    let root = doc
        .root()
        .children()
        .find(|node| node.tag_name().name() == "root")
        .ok_or(ApiError::XmlRootNotFound)?;

    Ok(HostResumeResponse {
        resume: xml_child_text::<C>(root, "resume")?.parse()?,
        rtsp_session_url: xml_child_text::<C>(root, "sessionUrl0")?.to_string(),
    })
}

async fn inner_launch_host<C: RequestClient>(
    instance: &MoonlightInstance,
    client: &mut C,
    https_hostport: &str,
    verb: &str,
    info: ClientInfo<'_>,
    request: ClientStreamRequest,
) -> Result<C::Text, ApiError<C::Error>> {
    let mut query_params = DynamicQueryParams::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    let launch_params = form_urlencoded::parse(instance.launch_url_query_parameters().as_bytes());
    for (name, value) in launch_params {
        query_params.push((name, value));
    }

    let mut appid_buffer = [0u8; _];
    let appid = u32_to_str(request.app_id, &mut appid_buffer);
    query_params.push(query_param("appid", appid));

    let mut mode_buffer = [0u8; (11 * 3) + 2];
    let mode = fmt_write_to_buffer(&mut mode_buffer, |writer| {
        write!(
            writer,
            "{}x{}x{}",
            request.mode_width, request.mode_height, request.mode_fps
        )
        .expect("write mode")
    });
    query_params.push(query_param("mode", mode));

    query_params.push(query_param("additionalStates", "1"));
    query_params.push(query_param("sops", if request.sops { "1" } else { "0" }));

    if request.hdr {
        query_params.push(query_param("hdrMode", "1"));
        query_params.push(query_param("clientHdrCapVersion", "0"));
        query_params.push(query_param("clientHdrCapSupportedFlagsInUint32", "0"));
        query_params.push(query_param(
            "clientHdrCapMetaDataId",
            "NV_STATIC_METADATA_TYPE_1",
        ));
        query_params.push(query_param(
            "clientHdrCapDisplayData",
            "0x0x0x0x0x0x0x0x0x0x0",
        ));
    }

    let mut ri_key_str_bytes = [0u8; 16 * 2];
    hex::encode_to_slice(request.ri_key, &mut ri_key_str_bytes).expect("encode ri key");
    query_params.push(query_param(
        "rikey",
        str::from_utf8(&ri_key_str_bytes).expect("valid ri key str"),
    ));

    let mut ri_key_id_str_bytes = [0; 11];
    let ri_key_id_str = u32_to_str(request.ri_key_id, &mut ri_key_id_str_bytes);
    query_params.push(query_param("rikeyid", ri_key_id_str));

    query_params.push(query_param(
        "localAudioPlayMode",
        if request.local_audio_play_mode {
            "1"
        } else {
            "0"
        },
    ));
    // query_params.push(query_param("surroundAudioInfo", "todo"));

    let mut gamepad_attached_mask_buffer = [0u8; 11];
    let gamepad_attached_mask_value = i32_to_str(
        request.gamepads_attached_mask,
        &mut gamepad_attached_mask_buffer,
    );
    query_params.push(query_param(
        "remoteControllersBitmap",
        gamepad_attached_mask_value,
    ));
    query_params.push(query_param("gcmap", gamepad_attached_mask_value));

    query_params.push(query_param(
        "gcpersist",
        if request.gamepads_persist_after_disconnect {
            "1"
        } else {
            "0"
        },
    ));

    let response = client
        .send_https_request_text_response(https_hostport, verb, &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    Ok(response)
}

fn i32_to_str(num: i32, buffer: &mut [u8; 11]) -> &str {
    fmt_write_to_buffer(buffer, |writer| write!(writer, "{num}").expect("write i32"))
}
