use std::{
    io::{self, ErrorKind},
    str::Utf8Error,
    time::Duration,
};

use bytes::{Bytes, BytesMut};
use http_body_util::{BodyExt, Empty};
use hyper::{Request, client::conn::http1, header, http};
use hyper_openssl::SslStream;
use hyper_util::rt::TokioIo;
use log::debug;
use openssl::{
    pkey::PKey,
    ssl::{Ssl, SslContext, SslMethod, SslVerifyMode},
    x509::X509,
};
use pem::Pem;
use thiserror::Error;
use tokio::{net::TcpStream, spawn, task::JoinError, time::timeout};
use url::Url;

use crate::network::{
    backend::{DEFAULT_LONG_TIMEOUT, DEFAULT_TIMEOUT},
    request_client::{QueryParamsRef, RequestClient, RequestError},
};

#[derive(Debug, Error)]
pub enum HyperOpenSSLError {
    #[error("url parse: {0}")]
    Url(#[from] url::ParseError),
    #[error("io: {0}")]
    Io(#[from] io::Error),
    #[error("hyper: {0}")]
    Hyper(#[from] hyper::Error),
    #[error("utf8: {0}")]
    JoinConnection(#[from] JoinError),
    #[error("openssl: {0}")]
    OpenSSL(#[from] openssl::error::ErrorStack),
    #[error("openssl: {0}")]
    OpenSSL2(#[from] openssl::ssl::Error),
    #[error("http: {0}")]
    Http(#[from] http::Error),
    #[error("utf8: {0}")]
    Utf8(#[from] Utf8Error),
    #[error("tried to make https requests without having certificates")]
    NoCertificates,
    #[error("timeout")]
    Timeout,
}

impl RequestError for HyperOpenSSLError {
    fn is_connect(&self) -> bool {
        match self {
            Self::Timeout => true,
            Self::Io(err) if err.kind() == ErrorKind::ConnectionRefused => true,
            _ => false,
        }
    }
    fn is_encryption(&self) -> bool {
        matches!(self, Self::NoCertificates)
    }
}

fn build_url(
    use_https: bool,
    hostport: &str,
    path: &str,
    query_params: &QueryParamsRef<'_>,
) -> Result<Url, HyperOpenSSLError> {
    let protocol = if use_https { "https" } else { "http" };

    let authority = format!("{protocol}://{hostport}/{path}");
    let url = Url::parse_with_params(&authority, query_params)?;

    Ok(url)
}

pub struct HyperOpenSSLClient {
    ssl_ctx: Option<SslContext>,
    timeout: Duration,
}

impl RequestClient for HyperOpenSSLClient {
    type Error = HyperOpenSSLError;

    type Bytes = bytes::Bytes;
    type Text = String;

    fn with_defaults() -> Result<Self, Self::Error> {
        Ok(Self {
            ssl_ctx: None,
            timeout: DEFAULT_TIMEOUT,
        })
    }
    fn with_defaults_long_timeout() -> Result<Self, Self::Error> {
        Ok(Self {
            ssl_ctx: None,
            timeout: DEFAULT_LONG_TIMEOUT,
        })
    }
    fn with_certificates(
        client_private_key: &Pem,
        client_certificate: &Pem,
        server_certificate: &Pem,
    ) -> Result<Self, Self::Error> {
        let client_certificate = X509::from_der(client_certificate.contents())?;
        let client_private_key = PKey::private_key_from_der(client_private_key.contents())?;

        let mut ssl = SslContext::builder(SslMethod::tls_client())?;
        ssl.set_certificate(&client_certificate)?;
        ssl.set_private_key(&client_private_key)?;

        let expected_server_certificate = server_certificate.contents().to_owned();
        ssl.set_verify_callback(SslVerifyMode::PEER, move |_preverify_ok, ctx| {
            if let Some(cert) = ctx.current_cert() {
                let Ok(certificate_der) = cert.to_der() else {
                    return false;
                };
                certificate_der == expected_server_certificate
            } else {
                false
            }
        });

        Ok(Self {
            ssl_ctx: Some(ssl.build()),
            timeout: DEFAULT_TIMEOUT,
        })
    }

    async fn send_http_request_text_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef<'_>,
    ) -> Result<Self::Text, Self::Error> {
        let url = build_url(false, hostport, path, query_params)?;
        debug!(target: "client_hyper_openssl", "Sending http request to \"{url}\"");

        let address = url.socket_addrs(|| None)?;
        let stream = timeout(self.timeout, TcpStream::connect(&*address))
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;

        let io = TokioIo::new(stream);

        let (mut sender, conn) = timeout(self.timeout, http1::handshake(io))
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;
        let conn = spawn(conn);

        let path = url.path();
        let query = url.query();

        let path_and_query = if let Some(query) = query {
            format!("{}?{}", path, query)
        } else {
            path.to_string()
        };

        let request = Request::builder()
            .uri(path_and_query)
            .header(header::HOST, url.authority())
            .header("User-Agent", "Moonlight-Web/2")
            .body(Empty::<Bytes>::new())?;

        let mut response = timeout(self.timeout, sender.send_request(request))
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;

        let mut response_str = String::new();

        while let Some(next) = timeout(self.timeout, response.frame())
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)?
        {
            let frame = next?;
            if let Some(chunk) = frame.data_ref() {
                response_str.push_str(str::from_utf8(chunk)?);
            }
        }

        conn.await??;

        debug!(target: "client_hyper_openssl", "Received http response \"{response_str}\"");

        Ok(response_str)
    }

    async fn send_https_request_text_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef<'_>,
    ) -> Result<Self::Text, Self::Error> {
        let Some(ssl_ctx) = self.ssl_ctx.as_ref() else {
            return Err(HyperOpenSSLError::NoCertificates);
        };

        let url = build_url(false, hostport, path, query_params)?;
        debug!(target: "client_hyper_openssl", "Sending https request to \"{url}\"");

        let address = url.socket_addrs(|| None)?;
        let stream = timeout(self.timeout, TcpStream::connect(&*address))
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;

        let io = TokioIo::new(stream);

        let mut ssl = Ssl::new(ssl_ctx)?;
        ssl.set_connect_state();

        let mut ssl_stream = Box::pin(SslStream::new(ssl, io)?);
        timeout(self.timeout, ssl_stream.as_mut().do_handshake())
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;

        let (mut sender, conn) = timeout(self.timeout, http1::handshake(ssl_stream))
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;
        let conn = spawn(conn);

        let path = url.path();
        let query = url.query();

        let path_and_query = if let Some(query) = query {
            format!("{}?{}", path, query)
        } else {
            path.to_string()
        };

        let request = Request::builder()
            .uri(path_and_query)
            .header(header::HOST, url.authority())
            .header("User-Agent", "Moonlight-Web/2")
            .body(Empty::<Bytes>::new())?;

        let mut response = sender.send_request(request).await?;

        let mut response_str = String::new();

        while let Some(next) = timeout(self.timeout, response.frame())
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)?
        {
            let frame = next?;
            if let Some(chunk) = frame.data_ref() {
                response_str.push_str(str::from_utf8(chunk)?);
            }
        }

        conn.await??;

        debug!(target: "client_hyper_openssl", "Received https response \"{response_str}\"");

        Ok(response_str)
    }
    async fn send_https_request_data_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef<'_>,
    ) -> Result<Self::Bytes, Self::Error> {
        let Some(ssl_ctx) = self.ssl_ctx.as_ref() else {
            return Err(HyperOpenSSLError::NoCertificates);
        };

        let url = build_url(false, hostport, path, query_params)?;
        debug!(target: "client_hyper_openssl", "Sending https request to \"{url}\"");

        let address = url.socket_addrs(|| None)?;
        let stream = timeout(self.timeout, TcpStream::connect(&*address))
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;

        let io = TokioIo::new(stream);

        let mut ssl = Ssl::new(ssl_ctx)?;
        ssl.set_connect_state();

        let mut ssl_stream = Box::pin(SslStream::new(ssl, io)?);
        timeout(self.timeout, ssl_stream.as_mut().do_handshake())
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;

        let (mut sender, conn) = timeout(self.timeout, http1::handshake(ssl_stream))
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)??;
        let conn = spawn(conn);

        let path = url.path();
        let query = url.query();

        let path_and_query = if let Some(query) = query {
            format!("{}?{}", path, query)
        } else {
            path.to_string()
        };

        let request = Request::builder()
            .uri(path_and_query)
            .header(header::HOST, url.authority())
            .header("User-Agent", "Moonlight-Web/2")
            .body(Empty::<Bytes>::new())?;

        let mut response = sender.send_request(request).await?;

        let mut response_bytes = BytesMut::new();

        while let Some(next) = timeout(self.timeout, response.frame())
            .await
            .map_err(|_| HyperOpenSSLError::Timeout)?
        {
            let frame = next?;
            if let Some(chunk) = frame.data_ref() {
                response_bytes.extend_from_slice(chunk);
            }
        }

        conn.await??;

        debug!(target: "client_hyper_openssl", "Received https response in bytes");

        Ok(response_bytes.freeze())
    }
}
