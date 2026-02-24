use std::{
    fmt::{self, Debug, Display, Formatter},
    str::FromStr,
};

use thiserror::Error;

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct MacAddress([u8; 6]);

impl MacAddress {
    pub const NULL: MacAddress = MacAddress([0u8; 6]);

    pub fn from_bytes(bytes: [u8; 6]) -> Self {
        Self(bytes)
    }

    pub fn to_bytes(self) -> [u8; 6] {
        self.0
    }

    pub const MAC_STRING_LENGTH: usize = 17;

    pub fn to_string_in_place<'a>(
        &self,
        str_bytes: &'a mut [u8; Self::MAC_STRING_LENGTH],
    ) -> &'a str {
        let mut place = 0;
        for byte in self.to_bytes() {
            if place != 0 {
                str_bytes[place] = b':';
                place += 1;
            }

            hex::encode_to_slice([byte], &mut str_bytes[place..(place + 2)])
                .expect("failed to encode hex");

            place += 2;
        }

        str::from_utf8(str_bytes).expect("mac address to string failed")
    }
}

impl Debug for MacAddress {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        write!(f, "MacAddress({self})")
    }
}

impl Display for MacAddress {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        let mut bytes = [0u8; MacAddress::MAC_STRING_LENGTH];

        write!(f, "{}", self.to_string_in_place(&mut bytes))
    }
}

#[cfg(feature = "network")]
#[derive(Debug, Error)]
pub enum ParseMacAddressError {
    #[error("the mac address is too short")]
    TooShort,
    #[error("hex: {0}")]
    Hex(#[from] hex::FromHexError),
}

impl FromStr for MacAddress {
    type Err = ParseMacAddressError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let split = s.splitn(6, ':');

        let mut mac = [0u8; 6];

        let mut i = 0;
        for part in split {
            hex::decode_to_slice(part.as_bytes(), &mut mac[i..(i + 1)])?;

            i += 1;
        }

        if i != 6 {
            return Err(ParseMacAddressError::TooShort);
        }

        Ok(Self::from_bytes(mac))
    }
}

#[cfg(feature = "serde")]
mod serde {
    use std::str::FromStr;

    use serde::de::Visitor;

    use crate::mac::MacAddress;

    impl serde::Serialize for MacAddress {
        fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
        where
            S: serde::Serializer,
        {
            let mut bytes = [0u8; MacAddress::MAC_STRING_LENGTH];

            let str = self.to_string_in_place(&mut bytes);
            serializer.serialize_str(str)
        }
    }

    struct MacAddressVisitor;

    impl<'a> Visitor<'a> for MacAddressVisitor {
        type Value = MacAddress;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            write!(formatter, "a mac address like string")
        }

        fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
        where
            E: serde::de::Error,
        {
            MacAddress::from_str(v).map_err(|err| E::custom(err))
        }
    }

    impl<'a> serde::Deserialize<'a> for MacAddress {
        fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
        where
            D: serde::Deserializer<'a>,
        {
            deserializer.deserialize_str(MacAddressVisitor)
        }
    }
}
