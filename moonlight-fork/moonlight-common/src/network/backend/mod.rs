use std::time::Duration;

#[cfg(feature = "backend_curl")]
pub mod curl;
#[cfg(feature = "backend_hyper_openssl")]
pub mod hyper_openssl;
#[cfg(feature = "backend_reqwest")]
pub mod reqwest;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);
pub const DEFAULT_LONG_TIMEOUT: Duration = Duration::from_secs(90);
