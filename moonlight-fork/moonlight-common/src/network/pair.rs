//! Moonlilght Pairing
//! - https://games-on-whales.github.io/wolf/stable/protocols/http-pairing.html

use roxmltree::Document;
use uuid::fmt::Hyphenated;

use crate::{
    SALT_LENGTH,
    network::{
        ApiError, ClientInfo, PairStatus,
        request_client::{LocalQueryParams, QueryBuilder, RequestClient, query_param},
        xml_child_paired, xml_child_text, xml_root_node,
    },
};

#[derive(Debug, Clone)]
pub struct ClientPairRequest1<'a> {
    pub device_name: &'a str,
    pub salt: [u8; SALT_LENGTH],
    pub client_cert_pem: &'a [u8],
}

#[derive(Debug, Clone)]
pub struct HostPairResponse1 {
    pub paired: PairStatus,
    pub cert: Option<String>,
}

pub async fn host_pair1<C: RequestClient>(
    client: &mut C,
    http_hostport: &str,
    info: ClientInfo<'_>,
    request: ClientPairRequest1<'_>,
) -> Result<HostPairResponse1, ApiError<C::Error>> {
    let mut query_params = LocalQueryParams::<{ 2 + 7 }>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    query_params.push(query_param("devicename", request.device_name));
    query_params.push(query_param("updateState", "1"));

    // https://github.com/moonlight-stream/moonlight-android/blob/master/app/src/main/java/com/limelight/nvstream/http/PairingManager.java#L207
    query_params.push(query_param("phrase", "getservercert"));

    let salt_str = hex::encode_upper(request.salt);
    query_params.push(query_param("salt", &salt_str));

    let client_cert_pem_str = hex::encode_upper(request.client_cert_pem);
    query_params.push(query_param("clientcert", &client_cert_pem_str));

    let response = client
        .send_http_request_text_response(http_hostport, "pair", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    let doc = Document::parse(response.as_ref())?;
    let root = xml_root_node(&doc)?;

    let paired = xml_child_paired::<C>(root, "paired")?;

    let cert = match xml_child_text::<C>(root, "plaincert") {
        Ok(value) => {
            let value = hex::decode(value)?;

            Some(String::from_utf8(value)?)
        }
        Err(ApiError::DetailNotFound("plaincert")) => None,
        Err(err) => return Err(err),
    };

    Ok(HostPairResponse1 { paired, cert })
}

#[derive(Debug, Clone)]
pub struct ClientPairRequest2<'a> {
    pub device_name: &'a str,
    pub encrypted_challenge: &'a [u8],
}

#[derive(Debug, Clone)]
pub struct HostPairResponse2 {
    pub paired: PairStatus,
    pub encrypted_response: Vec<u8>,
}

pub async fn host_pair2<C: RequestClient>(
    client: &mut C,
    http_hostport: &str,
    info: ClientInfo<'_>,
    request: ClientPairRequest2<'_>,
) -> Result<HostPairResponse2, ApiError<C::Error>> {
    let mut query_params = LocalQueryParams::<{ 2 + 3 }>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    query_params.push(query_param("devicename", request.device_name));
    query_params.push(query_param("updateState", "1"));

    let encrypted_challenge_str = hex::encode_upper(request.encrypted_challenge);
    query_params.push(query_param("clientchallenge", &encrypted_challenge_str));

    let response = client
        .send_http_request_text_response(http_hostport, "pair", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    let doc = Document::parse(response.as_ref())?;
    let root = xml_root_node(&doc)?;

    let paired = xml_child_paired::<C>(root, "paired")?;

    let challenge_response_str = xml_child_text::<C>(root, "challengeresponse")?;
    let challenge_response = hex::decode(challenge_response_str)?;

    Ok(HostPairResponse2 {
        paired,
        encrypted_response: challenge_response,
    })
}

pub struct ClientPairRequest3<'a> {
    pub device_name: &'a str,
    pub encrypted_challenge_response_hash: &'a [u8],
}
#[derive(Debug, Clone)]
pub struct HostPairResponse3 {
    pub paired: PairStatus,
    pub server_pairing_secret: Vec<u8>,
}

pub async fn host_pair3<C: RequestClient>(
    client: &mut C,
    http_hostport: &str,
    info: ClientInfo<'_>,
    request: ClientPairRequest3<'_>,
) -> Result<HostPairResponse3, ApiError<C::Error>> {
    let mut query_params = LocalQueryParams::<{ 2 + 3 }>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    query_params.push(query_param("devicename", request.device_name));
    query_params.push(query_param("updateState", "1"));

    let encrypted_challenge_str = hex::encode_upper(request.encrypted_challenge_response_hash);
    query_params.push(query_param("serverchallengeresp", &encrypted_challenge_str));

    let response = client
        .send_http_request_text_response(http_hostport, "pair", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    let doc = Document::parse(response.as_ref())?;
    let root = xml_root_node(&doc)?;

    let paired = xml_child_paired::<C>(root, "paired")?;

    let pairing_secret_str = xml_child_text::<C>(root, "pairingsecret")?;
    let pairing_secret = hex::decode(pairing_secret_str)?;

    Ok(HostPairResponse3 {
        paired,
        server_pairing_secret: pairing_secret,
    })
}

pub struct ClientPairRequest4<'a> {
    pub device_name: &'a str,
    pub client_pairing_secret: &'a [u8],
}
#[derive(Debug, Clone)]
pub struct HostPairResponse4 {
    pub paired: PairStatus,
}

pub async fn host_pair4<C: RequestClient>(
    client: &mut C,
    http_hostport: &str,
    info: ClientInfo<'_>,
    request: ClientPairRequest4<'_>,
) -> Result<HostPairResponse4, ApiError<C::Error>> {
    let mut query_params = LocalQueryParams::<{ 2 + 3 }>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    query_params.push(query_param("devicename", request.device_name));
    query_params.push(query_param("updateState", "1"));

    let client_pairing_secret_str = hex::encode_upper(request.client_pairing_secret);
    query_params.push(query_param(
        "clientpairingsecret",
        &client_pairing_secret_str,
    ));

    let response = client
        .send_http_request_text_response(http_hostport, "pair", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    let doc = Document::parse(response.as_ref())?;
    let root = xml_root_node(&doc)?;

    let paired = xml_child_paired::<C>(root, "paired")?;

    Ok(HostPairResponse4 { paired })
}

pub struct ClientPairRequest5<'a> {
    pub device_name: &'a str,
}
#[derive(Debug, Clone)]
pub struct ServerPairResponse5 {
    pub paired: PairStatus,
}

/// Note: This requires an https client
pub async fn host_pair5<C: RequestClient>(
    client: &mut C,
    https_hostport: &str,
    info: ClientInfo<'_>,
    request: ClientPairRequest5<'_>,
) -> Result<ServerPairResponse5, ApiError<C::Error>> {
    let mut query_params = LocalQueryParams::<{ 2 + 3 }>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    query_params.push(query_param("phrase", "pairchallenge"));
    query_params.push(query_param("devicename", request.device_name));
    query_params.push(query_param("updateState", "1"));

    let response = client
        .send_https_request_text_response(https_hostport, "pair", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    let doc = Document::parse(response.as_ref())?;
    let root = xml_root_node(&doc)?;

    let paired = xml_child_paired::<C>(root, "paired")?;

    Ok(ServerPairResponse5 { paired })
}

pub async fn host_unpair<C: RequestClient>(
    client: &mut C,
    http_hostport: &str,
    info: ClientInfo<'_>,
) -> Result<(), ApiError<C::Error>> {
    let mut query_params = LocalQueryParams::<2>::default();

    let mut uuid_bytes = [0; Hyphenated::LENGTH];
    info.add_query_params(&mut uuid_bytes, &mut query_params);

    client
        .send_http_request_text_response(http_hostport, "unpair", &query_params)
        .await
        .map_err(ApiError::RequestClient)?;

    Ok(())
}
