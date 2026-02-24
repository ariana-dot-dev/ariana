use std::{
    borrow::Cow, fmt, fmt::Write as _, num::ParseIntError, str::FromStr, string::FromUtf8Error,
};

use log::warn;
use roxmltree::{Document, Error, Node};
use thiserror::Error;
use uuid::{Uuid, fmt::Hyphenated};

use crate::{
    PairStatus, ParseServerStateError, ParseServerVersionError, ServerState, ServerVersion,
    mac::{MacAddress, ParseMacAddressError},
    network::request_client::{LocalQueryParams, QueryBuilder, RequestClient, query_param},
};

#[derive(Debug, Error)]
pub enum ApiError<RequestError> {
    #[error("{0}")]
    RequestClient(RequestError),
    #[error("the response is invalid xml")]
    ParseXmlError(#[from] Error),
    #[error("the returned xml doc has a non 200 status code")]
    InvalidXmlStatusCode { message: Option<String> },
    #[error("the returned xml doc doesn't have the root node")]
    XmlRootNotFound,
    #[error("the text contents of an xml node aren't present: {0}")]
    XmlTextNotFound(&'static str),
    #[error("detail was not found: {0}")]
    DetailNotFound(&'static str),
    #[error("{0}")]
    ParseServerStateError(#[from] ParseServerStateError),
    #[error("{0}")]
    ParseServerVersionError(#[from] ParseServerVersionError),
    #[error("parsing server codec mode support")]
    ParseServerCodecModeSupport,
    #[error("failed to parse the mac address")]
    ParseMacError(#[from] ParseMacAddressError),
    #[error("{0}")]
    ParseIntError(#[from] ParseIntError),
    #[error("{0}")]
    ParseUuidError(#[from] uuid::Error),
    #[error("{0}")]
    ParseHexError(#[from] hex::FromHexError),
    #[error("{0}")]
    Utf8Error(#[from] FromUtf8Error),
}

#[cfg(feature = "stream")]
pub mod launch;
pub mod pair;
pub mod request_client;

pub mod backend;

pub const DEFAULT_UNIQUE_ID: &str = "0123456789ABCDEF";

#[derive(Debug, Clone, Copy)]
pub struct ClientInfo<'a> {
    /// It's recommended to use the same (default) UID for all Moonlight clients so we can quit games started by other Moonlight clients.
    pub unique_id: &'a str,
    pub uuid: Uuid,
}

impl Default for ClientInfo<'static> {
    fn default() -> Self {
        Self {
            unique_id: DEFAULT_UNIQUE_ID,
            uuid: Uuid::new_v4(),
        }
    }
}

impl<'a> ClientInfo<'a> {
    // Requires 2 query params
    fn add_query_params(
        &self,
        uuid_bytes: &'a mut [u8; Hyphenated::LENGTH],
        query_params: &mut impl QueryBuilder<'a>,
    ) {
        query_params.push((Cow::Borrowed("uniqueid"), Cow::Borrowed(self.unique_id)));

        self.uuid.as_hyphenated().encode_lower(uuid_bytes);
        let uuid_str = str::from_utf8(uuid_bytes).expect("uuid string");

        query_params.push((Cow::Borrowed("uuid"), Cow::Borrowed(uuid_str)));
    }
}

fn xml_child_text<'doc, 'node, C: RequestClient>(
    list_node: Node<'node, 'doc>,
    name: &'static str,
) -> Result<&'node str, ApiError<C::Error>>
where
    'node: 'doc,
{
    let node = list_node
        .children()
        .find(|node| node.tag_name().name() == name)
        .ok_or(ApiError::<C::Error>::DetailNotFound(name))?;
    let content = node
        .text()
        .ok_or(ApiError::<C::Error>::XmlTextNotFound(name))?;

    Ok(content)
}

fn xml_root_node<'doc, C>(doc: &'doc Document) -> Result<Node<'doc, 'doc>, ApiError<C>> {
    let root = doc
        .root()
        .children()
        .find(|node| node.tag_name().name() == "root")
        .ok_or(ApiError::XmlRootNotFound)?;

    let status_code = root
        .attribute("status_code")
        .ok_or(ApiError::DetailNotFound("status_code"))?
        .parse::<u32>()?;

    if status_code / 100 == 4 {
        return Err(ApiError::InvalidXmlStatusCode {
            message: root.attribute("status_message").map(str::to_string),
        });
    }

    Ok(root)
}

#[derive(Debug, Clone)]
pub struct HostInfo {
    pub host_name: String,
    pub app_version: ServerVersion,
    pub gfe_version: String,
    pub unique_id: Uuid,
    pub https_port: u16,
    pub external_port: u16,
    pub max_luma_pixels_hevc: u32,
    pub mac: Option<MacAddress>,
    pub local_ip: String,
    pub server_codec_mode_support: u32,
    pub pair_status: PairStatus,
    pub current_game: u32,
    pub state_string: String,
    pub state: ServerState,
}

pub async fn host_info<C: RequestClient>(
    client: &mut C,
    use_https: bool,
    hostport: &str,
    info: Option<ClientInfo<'_>>,
) -> Result<HostInfo, ApiError<C::Error>> {
    let mut query_params = LocalQueryParams::<2>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    if let Some(info) = info {
        info.add_query_params(&mut uuid_bytes, &mut query_params);
    }

    let response = if use_https {
        client
            .send_https_request_text_response(hostport, "serverinfo", &query_params)
            .await
            .map_err(ApiError::RequestClient)?
    } else {
        client
            .send_http_request_text_response(hostport, "serverinfo", &query_params)
            .await
            .map_err(ApiError::RequestClient)?
    };

    let doc = Document::parse(response.as_ref())?;
    let root = xml_root_node(&doc)?;

    let state_string = xml_child_text::<C>(root, "state")?.to_string();

    let mac = match xml_child_text::<C>(root, "mac") {
        Ok(mac) => match mac.parse()? {
            mac if mac == MacAddress::from_bytes([0u8; 6]) => None,
            mac => Some(mac),
        },
        Err(_) => {
            warn!("failed to get mac from host response");
            None
        }
    };

    Ok(HostInfo {
        host_name: xml_child_text::<C>(root, "hostname")?.to_string(),
        app_version: xml_child_text::<C>(root, "appversion")?.parse()?,
        gfe_version: xml_child_text::<C>(root, "GfeVersion")?.to_string(),
        unique_id: xml_child_text::<C>(root, "uniqueid")?.parse()?,
        https_port: xml_child_text::<C>(root, "HttpsPort")?.parse()?,
        external_port: xml_child_text::<C>(root, "ExternalPort")?.parse()?,
        max_luma_pixels_hevc: xml_child_text::<C>(root, "MaxLumaPixelsHEVC")?.parse()?,
        mac,
        local_ip: xml_child_text::<C>(root, "LocalIP")?.to_string(),
        server_codec_mode_support: xml_child_text::<C>(root, "ServerCodecModeSupport")?.parse()?,
        pair_status: if xml_child_text::<C>(root, "PairStatus")?.parse::<u32>()? == 0 {
            PairStatus::NotPaired
        } else {
            PairStatus::Paired
        },
        current_game: xml_child_text::<C>(root, "currentgame")?.parse()?,
        state: ServerState::from_str(&state_string)?,
        state_string,
    })
}

// Pairing: https://github.com/moonlight-stream/moonlight-android/blob/master/app/src/main/java/com/limelight/nvstream/http/PairingManager.java#L185

fn xml_child_paired<'doc, 'node, C: RequestClient>(
    list_node: Node<'node, 'doc>,
    name: &'static str,
) -> Result<PairStatus, ApiError<C::Error>>
where
    'node: 'doc,
{
    let content = xml_child_text::<C>(list_node, name)?.parse::<i32>()?;

    Ok(if content == 1 {
        PairStatus::Paired
    } else {
        PairStatus::NotPaired
    })
}

#[derive(Debug, Clone)]
pub struct App {
    pub id: u32,
    pub title: String,
    pub is_hdr_supported: bool,
}

#[derive(Debug, Clone)]
pub struct ServerAppListResponse {
    pub apps: Vec<App>,
}

pub async fn host_app_list<C: RequestClient>(
    client: &mut C,
    https_hostport: &str,
    info: ClientInfo<'_>,
) -> Result<ServerAppListResponse, ApiError<C::Error>> {
    let mut query_params = LocalQueryParams::<2>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    let response = client
        .send_https_request_text_response(https_hostport, "applist", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    let doc = Document::parse(response.as_ref())?;
    let root = xml_root_node(&doc)?;

    let apps = root
        .children()
        .filter(|node| node.tag_name().name() == "App")
        .map(|app_node| {
            let title = xml_child_text::<C>(app_node, "AppTitle")?.to_string();

            let id = xml_child_text::<C>(app_node, "ID")?.parse()?;

            let is_hdr_supported = xml_child_text::<C>(app_node, "IsHdrSupported")
                .unwrap_or("0")
                .parse::<u32>()?
                == 1;

            Ok(App {
                id,
                title,
                is_hdr_supported,
            })
        })
        .collect::<Result<Vec<_>, ApiError<_>>>()?;

    Ok(ServerAppListResponse { apps })
}

#[derive(Debug, Clone)]
pub struct ClientAppBoxArtRequest {
    pub app_id: u32,
}

pub async fn host_app_box_art<C: RequestClient>(
    client: &mut C,
    https_address: &str,
    info: ClientInfo<'_>,
    request: ClientAppBoxArtRequest,
) -> Result<C::Bytes, ApiError<C::Error>> {
    // Assets: https://github.com/moonlight-stream/moonlight-android/blob/master/app/src/main/java/com/limelight/nvstream/http/NvHTTP.java#L721
    let mut query_params = LocalQueryParams::<{ 2 + 3 }>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    let mut appid_buffer = [0u8; _];
    let appid = u32_to_str(request.app_id, &mut appid_buffer);
    query_params.push(query_param("appid", appid));

    query_params.push(query_param("AssetType", "2"));
    query_params.push(query_param("AssetIdx", "0"));

    let response = client
        .send_https_request_data_response(https_address, "appasset", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    Ok(response)
}

pub async fn host_cancel<C: RequestClient>(
    client: &mut C,
    https_hostport: &str,
    info: ClientInfo<'_>,
) -> Result<bool, ApiError<C::Error>> {
    let mut query_params: LocalQueryParams<'_, 2> = LocalQueryParams::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    let response = client
        .send_https_request_text_response(https_hostport, "cancel", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    let doc = Document::parse(response.as_ref())?;
    let root = doc
        .root()
        .children()
        .find(|node| node.tag_name().name() == "root")
        .ok_or(ApiError::XmlRootNotFound)?;

    let cancel = xml_child_text::<C>(root, "cancel")?.trim();

    Ok(cancel != "0")
}

struct CounterWriter<'a> {
    buf: &'a mut [u8],
    pos: usize, // tracks how many bytes have been written
}

impl<'a> fmt::Write for CounterWriter<'a> {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        let bytes = s.as_bytes();
        if self.pos + bytes.len() > self.buf.len() {
            return Err(fmt::Error); // buffer overflow
        }
        self.buf[self.pos..self.pos + bytes.len()].copy_from_slice(bytes);
        self.pos += bytes.len();
        Ok(())
    }
}

fn u32_to_str(num: u32, buffer: &mut [u8; 11]) -> &str {
    fmt_write_to_buffer(buffer, |writer| write!(writer, "{num}").expect("write u32"))
}
fn fmt_write_to_buffer(buffer: &mut [u8], fmt: impl FnOnce(&mut CounterWriter)) -> &str {
    let mut writer = CounterWriter {
        buf: buffer,
        pos: 0,
    };

    fmt(&mut writer);

    let pos = writer.pos;

    str::from_utf8(&buffer[0..pos]).expect("valid utf8 bytes")
}
