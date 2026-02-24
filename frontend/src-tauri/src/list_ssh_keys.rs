use std::fs;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};
use crate::ssh_utils::get_ssh_directory;

#[derive(Serialize, Deserialize, Debug)]
pub struct SshKeyPair {
    pub name: String,
    pub public_key_path: String,
    pub private_key_path: String,
    pub key_type: String,
}

#[tauri::command]
pub fn list_available_ssh_keys() -> Result<Vec<SshKeyPair>, String> {
    let ssh_dir = get_ssh_directory()?;

    if !ssh_dir.exists() {
        return Ok(Vec::new());
    }

    let mut key_pairs: Vec<SshKeyPair> = Vec::new();

    // Common SSH key patterns to look for
    let key_patterns = vec![
        ("id_ed25519", "ed25519"),
        ("id_rsa", "rsa"),
        ("id_ecdsa", "ecdsa"),
        ("id_dsa", "dsa"),
    ];

    // Check for standard key types
    for (key_name, key_type) in key_patterns {
        let private_key_path = ssh_dir.join(key_name);
        let public_key_path = ssh_dir.join(format!("{}.pub", key_name));

        if private_key_path.exists() && public_key_path.exists() {
            key_pairs.push(SshKeyPair {
                name: key_name.to_string(),
                public_key_path: public_key_path.to_string_lossy().to_string(),
                private_key_path: private_key_path.to_string_lossy().to_string(),
                key_type: key_type.to_string(),
            });
        }
    }

    // Also scan for custom-named keys (any file with a corresponding .pub file)
    if let Ok(entries) = fs::read_dir(&ssh_dir) {
        for entry in entries.flatten() {
            let path = entry.path();

            // Skip if it's not a file
            if !path.is_file() {
                continue;
            }

            // Skip if it's a .pub file (we only process private keys)
            if let Some(extension) = path.extension() {
                if extension == "pub" {
                    continue;
                }
            }

            // Skip known_hosts, authorized_keys, config files
            if let Some(file_name) = path.file_name() {
                let file_name_str = file_name.to_string_lossy();
                if file_name_str == "known_hosts"
                    || file_name_str == "authorized_keys"
                    || file_name_str == "config"
                    || file_name_str.starts_with(".") {
                    continue;
                }
            }

            // Check if corresponding .pub file exists
            let mut pub_path = path.clone();
            let original_name = path.file_name()
                .ok_or("Failed to get file name")?
                .to_string_lossy()
                .to_string();

            pub_path.set_file_name(format!("{}.pub", original_name));

            if pub_path.exists() {
                // Skip if we already added this key from standard patterns
                if key_pairs.iter().any(|kp| kp.name == original_name) {
                    continue;
                }

                // Try to determine key type by reading the public key
                let key_type = determine_key_type(&pub_path).unwrap_or_else(|| "unknown".to_string());

                key_pairs.push(SshKeyPair {
                    name: original_name,
                    public_key_path: pub_path.to_string_lossy().to_string(),
                    private_key_path: path.to_string_lossy().to_string(),
                    key_type,
                });
            }
        }
    }

    Ok(key_pairs)
}

#[tauri::command]
pub fn read_ssh_key_pair(key_name: String) -> Result<(String, String), String> {
    let ssh_dir = get_ssh_directory()?;

    let private_key_path = ssh_dir.join(&key_name);
    let public_key_path = ssh_dir.join(format!("{}.pub", key_name));

    if !private_key_path.exists() {
        return Err(format!("Private key not found: {}", key_name));
    }

    if !public_key_path.exists() {
        return Err(format!("Public key not found: {}.pub", key_name));
    }

    let private_key = fs::read_to_string(&private_key_path)
        .map_err(|e| format!("Failed to read private key: {}", e))?;

    let public_key = fs::read_to_string(&public_key_path)
        .map_err(|e| format!("Failed to read public key: {}", e))?;

    Ok((public_key.trim().to_string(), private_key))
}

fn determine_key_type(pub_key_path: &PathBuf) -> Option<String> {
    if let Ok(content) = fs::read_to_string(pub_key_path) {
        let content = content.trim();

        if content.starts_with("ssh-ed25519") {
            return Some("ed25519".to_string());
        } else if content.starts_with("ssh-rsa") {
            return Some("rsa".to_string());
        } else if content.starts_with("ecdsa-sha2-") {
            return Some("ecdsa".to_string());
        } else if content.starts_with("ssh-dss") {
            return Some("dsa".to_string());
        }
    }

    None
}
