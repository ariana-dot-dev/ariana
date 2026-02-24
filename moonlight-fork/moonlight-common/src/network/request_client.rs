use std::{borrow::Cow, ops::Deref};

use pem::Pem;

pub(crate) fn empty_query_param<'a>() -> (Cow<'a, str>, Cow<'a, str>) {
    query_param("", "")
}
pub(crate) fn query_param<'a>(key: &'a str, value: &'a str) -> (Cow<'a, str>, Cow<'a, str>) {
    (Cow::Borrowed(key), Cow::Borrowed(value))
}
#[allow(unused)]
pub(crate) fn query_param_owned<'a>(key: &'a str, value: String) -> (Cow<'a, str>, Cow<'a, str>) {
    (Cow::Borrowed(key), Cow::Owned(value))
}

pub type QueryParam<'a> = (Cow<'a, str>, Cow<'a, str>);
pub type QueryParamsRef<'a> = [QueryParam<'a>];

pub trait QueryBuilder<'a> {
    fn push(&mut self, param: QueryParam<'a>);
}

pub struct LocalQueryParams<'a, const T: usize> {
    len: usize,
    params: [QueryParam<'a>; T],
}

impl<'a, const T: usize> Default for LocalQueryParams<'a, T> {
    fn default() -> Self {
        Self {
            len: 0,
            params: std::array::from_fn(|_| empty_query_param()),
        }
    }
}

impl<'a, const T: usize> QueryBuilder<'a> for LocalQueryParams<'a, T> {
    fn push(&mut self, param: QueryParam<'a>) {
        self.params[self.len] = param;
        self.len += 1;
    }
}

impl<'a, const T: usize> Deref for LocalQueryParams<'a, T> {
    type Target = QueryParamsRef<'a>;
    fn deref(&self) -> &Self::Target {
        &self.params[0..self.len]
    }
}

#[derive(Default)]
pub struct DynamicQueryParams<'a> {
    params: Vec<QueryParam<'a>>,
}

impl<'a> QueryBuilder<'a> for DynamicQueryParams<'a> {
    fn push(&mut self, param: QueryParam<'a>) {
        self.params.push(param);
    }
}

impl<'a> Deref for DynamicQueryParams<'a> {
    type Target = QueryParamsRef<'a>;
    fn deref(&self) -> &Self::Target {
        &self.params
    }
}

pub trait RequestError {
    /// The machine cannot be reached: timeout, connection refused
    fn is_connect(&self) -> bool;
    /// The sunshine encryption is invalid (e.g. the host removed our client -> we're unpaired)
    fn is_encryption(&self) -> bool;
}

pub trait RequestClient: Sized {
    type Error: RequestError;

    type Text: AsRef<str>;
    type Bytes: AsRef<[u8]>;

    fn with_defaults() -> Result<Self, Self::Error>;
    fn with_defaults_long_timeout() -> Result<Self, Self::Error>;

    fn with_certificates(
        client_private_key: &Pem,
        client_certificate: &Pem,
        server_certificate: &Pem,
    ) -> Result<Self, Self::Error>;

    fn send_http_request_text_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef,
    ) -> impl std::future::Future<Output = Result<Self::Text, Self::Error>> + Send;

    fn send_https_request_text_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef,
    ) -> impl std::future::Future<Output = Result<Self::Text, Self::Error>> + Send;

    fn send_https_request_data_response(
        &mut self,
        hostport: &str,
        path: &str,
        query_params: &QueryParamsRef,
    ) -> impl std::future::Future<Output = Result<Self::Bytes, Self::Error>> + Send;
}
