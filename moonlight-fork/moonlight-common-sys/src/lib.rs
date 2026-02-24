#![allow(non_upper_case_globals)]
#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

#[cfg(feature = "generate-bindings")]
pub mod limelight {
    include!(concat!(env!("OUT_DIR"), "/limelight.rs"));
}
#[cfg(not(feature = "generate-bindings"))]
pub mod limelight;

#[cfg(all(feature = "generate-bindings", feature = "crypto"))]
mod crypto {
    include!(concat!(env!("OUT_DIR"), "/crypto.rs"));
}
#[cfg(all(not(feature = "generate-bindings"), feature = "crypto"))]
pub mod crypto;
