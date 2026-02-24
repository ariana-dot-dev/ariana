use std::path::PathBuf;

/// Get the path to the Ariana SSH private key
pub fn get_ssh_key_path() -> Result<String, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    let key_path = home_dir.join(".ssh").join("ariana_id_ed25519");

    if !key_path.exists() {
        return Err("SSH key not found. Please ensure ariana_id_ed25519 exists in ~/.ssh/".to_string());
    }

    Ok(key_path.to_string_lossy().to_string())
}

/// Get the SSH directory path
pub fn get_ssh_directory() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    Ok(home_dir.join(".ssh"))
}

/// Find SSH executable on the system
pub fn find_ssh_executable() -> Result<String, String> {
    if cfg!(target_os = "windows") {
        find_windows_ssh()
    } else {
        Ok("ssh".to_string())
    }
}

/// Find SSH executable on Windows in common locations
fn find_windows_ssh() -> Result<String, String> {
    let possible_paths = vec![
        "C:\\Windows\\System32\\OpenSSH\\ssh.exe",
        "C:\\Program Files\\Git\\usr\\bin\\ssh.exe",
    ];

    for path in possible_paths {
        if PathBuf::from(path).exists() {
            return Ok(path.to_string());
        }
    }

    // Fallback: hope it's in PATH
    Ok("ssh".to_string())
}

/// Common SSH options for non-interactive connections
pub fn get_common_ssh_options() -> Vec<&'static str> {
    vec![
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
    ]
}
