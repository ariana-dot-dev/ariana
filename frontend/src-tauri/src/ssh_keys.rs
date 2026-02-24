use std::fs;
use std::path::PathBuf;
use std::process::Command;
use crate::ssh_utils::get_ssh_directory;

#[tauri::command]
pub fn get_or_create_ssh_key() -> Result<String, String> {
    // Get the SSH directory path from centralized utility
    let ssh_dir = get_ssh_directory()?;

    // Ensure SSH directory exists
    if !ssh_dir.exists() {
        fs::create_dir_all(&ssh_dir)
            .map_err(|e| format!("Failed to create SSH directory: {}", e))?;

        // Set proper permissions on Unix systems
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = fs::metadata(&ssh_dir)
                .map_err(|e| format!("Failed to get SSH directory metadata: {}", e))?;
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&ssh_dir, permissions)
                .map_err(|e| format!("Failed to set SSH directory permissions: {}", e))?;
        }
    }

    // Define key paths
    let private_key_path = ssh_dir.join("ariana_id_ed25519");
    let public_key_path = ssh_dir.join("ariana_id_ed25519.pub");

    // Only generate new keys if they don't exist
    // Accept both OpenSSH and PEM formats - don't regenerate existing keys
    let need_new_key = !(private_key_path.exists() && public_key_path.exists());

    if need_new_key {
        // Generate new SSH key pair (will use default format from ssh-keygen)
        generate_ssh_key(&private_key_path)?;
    }

    // Read and return the public key
    let public_key = fs::read_to_string(&public_key_path)
        .map_err(|e| format!("Failed to read public key: {}", e))?;

    Ok(public_key.trim().to_string())
}

fn generate_ssh_key(private_key_path: &PathBuf) -> Result<(), String> {
    // Use centralized SSH executable finder (for ssh-keygen)
    let ssh_keygen_cmd = if cfg!(target_os = "windows") {
        // On Windows, try to find ssh-keygen in common locations
        if PathBuf::from("C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe").exists() {
            "C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe"
        } else if PathBuf::from("C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe").exists() {
            "C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe"
        } else {
            "ssh-keygen"
        }
    } else {
        "ssh-keygen"
    };

    // Generate the key with no passphrase (use default format from ssh-keygen)
    // Note: Modern ssh-keygen generates OpenSSH format by default for ed25519, which is fine
    let output = Command::new(ssh_keygen_cmd)
        .args(&[
            "-t", "ed25519",
            "-f", &private_key_path.to_string_lossy(),
            "-N", "", // No passphrase
            "-C", "ariana-ide", // Comment
        ])
        .output()
        .map_err(|e| format!("Failed to execute ssh-keygen: {}. Make sure OpenSSH is installed.", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ssh-keygen failed: {}", stderr));
    }

    // Set proper permissions on the private key (Unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = fs::metadata(&private_key_path)
            .map_err(|e| format!("Failed to get private key metadata: {}", e))?;
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&private_key_path, permissions)
            .map_err(|e| format!("Failed to set private key permissions: {}", e))?;
    }

    Ok(())
}