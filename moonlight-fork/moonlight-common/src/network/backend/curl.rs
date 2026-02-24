use std::{
    mem::swap,
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

use curl::easy::{Easy2, Handler, InfoType, SslOpt, WriteError};
use log::{LevelFilter, debug};
use pem::Pem;
use thiserror::Error;
use tokio::task::{JoinError, spawn_blocking};
use url::Url;

use crate::network::{
    backend::{DEFAULT_LONG_TIMEOUT, DEFAULT_TIMEOUT},
    request_client::{QueryParamsRef, RequestClient, RequestError},
};

#[derive(Debug, Error)]
pub enum CurlError {
    #[error("url parse: {0}")]
    Url(#[from] url::ParseError),
    #[error("failed to make request: {0}")]
    Curl(#[from] curl::Error),
    #[error("failed to join request thread: {0}")]
    Tokio(#[from] JoinError),
    #[error("cannot make https requests without certificates")]
    NoCertificates,
}

impl RequestError for CurlError {
    fn is_connect(&self) -> bool {
        matches!(self, Self::Curl(err) if err.is_couldnt_connect())
    }
    fn is_encryption(&self) -> bool {
        matches!(self, Self::Curl(err) if err.is_peer_failed_verification())
    }
}

pub struct CurlClient {
    timeout: Duration,
    certificates: Option<Certificates>,
}

struct Certificates {
    client_private_key: Vec<u8>,
    client_certificate: Vec<u8>,
    server_certificate: Vec<u8>,
}

#[derive(Debug)]
struct CurlHandler {
    debug_number: usize,
    response: Vec<u8>,
}
impl CurlHandler {
    fn new() -> Self {
        static DEBUG_NUMBER: AtomicUsize = AtomicUsize::new(0);

        Self {
            debug_number: DEBUG_NUMBER.fetch_add(1, Ordering::Acquire),
            response: Default::default(),
        }
    }
}
impl Handler for CurlHandler {
    fn write(&mut self, data: &[u8]) -> Result<usize, WriteError> {
        self.response.extend_from_slice(data);
        Ok(data.len())
    }

    fn debug(&mut self, kind: InfoType, data: &[u8]) {
        let prefix = match kind {
            InfoType::Text => "*",
            InfoType::HeaderIn => "<",
            InfoType::HeaderOut => ">",
            InfoType::DataIn | InfoType::SslDataIn => "{",
            InfoType::DataOut | InfoType::SslDataOut => "}",
            _ => "-",
        };
        debug!(target: "curl_client", "{} {prefix} {}", self.debug_number, String::from_utf8_lossy(data).trim());
    }
}

fn build_url(
    use_https: bool,
    hostport: &str,
    path: &str,
    query_params: &QueryParamsRef<'_>,
) -> Result<Url, CurlError> {
    let protocol = if use_https { "https" } else { "http" };

    let authority = format!("{protocol}://{hostport}/{path}");
    let url = Url::parse_with_params(&authority, query_params)?;

    Ok(url)
}

fn log_error<T>(error: Result<T, CurlError>) -> Result<T, CurlError> {
    if let Err(err) = error.as_ref() {
        debug!(target: "curl_client", "failed request: {err}");
    }
    error
}

async fn make_curl_request(
    certificates: Option<&Certificates>,
    hostport: &str,
    path: &str,
    query_params: &QueryParamsRef<'_>,
    timeout: Duration,
) -> Result<Vec<u8>, CurlError> {
    let mut curl = Easy2::new(CurlHandler::new());

    curl.verbose(log::max_level() >= LevelFilter::Debug)?;

    let url = build_url(certificates.is_some(), hostport, path, query_params)?;
    debug!(target: "client_curl", "Sending {} request to \"{url}\"", if certificates.is_some() {"https"} else {"http"});

    curl.url(url.as_str())?;
    curl.timeout(timeout)?;

    if let Some(certificates) = certificates {
        curl.ssl_cert_type("DER")?;
        curl.ssl_cert_blob(&certificates.client_certificate)?;

        curl.ssl_key_type("DER")?;
        curl.ssl_key_blob(&certificates.client_private_key)?;

        // curl.ssl_cainfo_blob(&certificates.server_certificate)?;

        // TODO: make this secure
        curl.ssl_verify_peer(false)?;
        curl.ssl_verify_host(false)?;

        curl.ssl_options(SslOpt::new().no_revoke(true))?;
    }

    let (result, mut curl) = spawn_blocking(move || {
        let result = curl.perform();
        (result, curl)
    })
    .await?;

    result?;

    let mut response = Vec::new();
    swap(&mut curl.get_mut().response, &mut response);

    Ok(response)
}

impl RequestClient for CurlClient {
    type Error = CurlError;

    type Bytes = Vec<u8>;
    type Text = String;

    fn with_defaults() -> Result<Self, Self::Error> {
        Ok(CurlClient {
            certificates: None,
            timeout: DEFAULT_TIMEOUT,
        })
    }
    fn with_defaults_long_timeout() -> Result<Self, Self::Error> {
        Ok(CurlClient {
            certificates: None,
            timeout: DEFAULT_LONG_TIMEOUT,
        })
    }
    fn with_certificates(
        client_private_key: &Pem,
        client_certificate: &Pem,
        server_certificate: &Pem,
    ) -> Result<Self, Self::Error> {
        Ok(CurlClient {
            certificates: Some(Certificates {
                client_private_key: client_private_key.contents().to_vec(),
                client_certificate: client_certificate.contents().to_vec(),
                server_certificate: server_certificate.contents().to_vec(),
            }),
            timeout: DEFAULT_TIMEOUT,
        })
    }

    async fn send_http_request_text_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef<'_>,
    ) -> Result<Self::Text, Self::Error> {
        let response =
            log_error(make_curl_request(None, hostport, path, query_params, self.timeout).await)?;

        // TODO: convert to utf8 lossy owned when stable
        Ok(String::from_utf8_lossy(&response).into_owned())
    }
    async fn send_https_request_text_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef<'_>,
    ) -> Result<Self::Text, Self::Error> {
        if self.certificates.is_none() {
            return Err(CurlError::NoCertificates);
        }

        let response = log_error(
            make_curl_request(
                self.certificates.as_ref(),
                hostport,
                path,
                query_params,
                self.timeout,
            )
            .await,
        )?;

        Ok(String::from_utf8_lossy(&response).into_owned())
    }
    async fn send_https_request_data_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef<'_>,
    ) -> Result<Self::Bytes, Self::Error> {
        if self.certificates.is_none() {
            return Err(CurlError::NoCertificates);
        }

        let response = log_error(
            make_curl_request(
                self.certificates.as_ref(),
                hostport,
                path,
                query_params,
                self.timeout,
            )
            .await,
        )?;

        Ok(response)
    }
}
