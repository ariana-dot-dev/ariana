use std::fs;
use std::path::PathBuf;
use crate::ssh_utils::get_ssh_directory;

/// Manages SSH config file entries for Ariana agents
pub struct SSHConfigManager {
    config_path: PathBuf,
}

impl SSHConfigManager {
    pub fn new() -> Result<Self, String> {
        let ssh_dir = get_ssh_directory()?;
        let config_path = ssh_dir.join("config");

        Ok(Self { config_path })
    }

    /// Ensures the SSH config file exists and creates it if it doesn't
    fn ensure_config_exists(&self) -> Result<(), String> {
        if !self.config_path.exists() {
            fs::write(&self.config_path, "# SSH Config\n")
                .map_err(|e| format!("Failed to create SSH config file: {}", e))?;

            // Set proper permissions on Unix systems
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let metadata = fs::metadata(&self.config_path)
                    .map_err(|e| format!("Failed to get SSH config metadata: {}", e))?;
                let mut permissions = metadata.permissions();
                permissions.set_mode(0o600);
                fs::set_permissions(&self.config_path, permissions)
                    .map_err(|e| format!("Failed to set SSH config permissions: {}", e))?;
            }
        }
        Ok(())
    }

    /// Adds or updates an SSH config entry for an Ariana agent
    pub fn upsert_agent_entry(
        &self,
        agent_id: &str,
        agent_name: &str,
        machine_ip: &str,
        ssh_user: &str,
    ) -> Result<String, String> {
        self.ensure_config_exists()?;

        let host_alias = format!("ariana-agent-{}", agent_id);
        let ssh_key_path = get_ssh_directory()?.join("ariana_id_ed25519");

        // Read existing config
        let config_content = fs::read_to_string(&self.config_path)
            .map_err(|e| format!("Failed to read SSH config: {}", e))?;

        // Check if this agent already has an entry
        let marker_start = format!("# Ariana Agent: {} (ID: {})", agent_name, agent_id);
        let marker_end = format!("# End Ariana Agent: {}", agent_id);

        let new_entry = format!(
            r#"
# Ariana Agent: {} (ID: {})
Host {}
  HostName {}
  User {}
  IdentityFile {}
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
# End Ariana Agent: {}
"#,
            agent_name,
            agent_id,
            host_alias,
            machine_ip,
            ssh_user,
            ssh_key_path.to_string_lossy(),
            agent_id
        );

        let new_config = if config_content.contains(&marker_start) {
            // Update existing entry
            let mut result = String::new();
            let mut inside_agent_block = false;

            for line in config_content.lines() {
                if line.starts_with(&marker_start) {
                    inside_agent_block = true;
                    result.push_str(&new_entry);
                } else if inside_agent_block && line.starts_with(&marker_end) {
                    inside_agent_block = false;
                    // Skip the old end marker as it's included in new_entry
                } else if !inside_agent_block {
                    result.push_str(line);
                    result.push('\n');
                }
            }

            result
        } else {
            // Append new entry
            let mut result = config_content;
            if !result.ends_with('\n') {
                result.push('\n');
            }
            result.push_str(&new_entry);
            result
        };

        // Write updated config
        fs::write(&self.config_path, new_config)
            .map_err(|e| format!("Failed to write SSH config: {}", e))?;

        Ok(host_alias)
    }

    /// Removes an SSH config entry for an Ariana agent
    pub fn remove_agent_entry(&self, agent_id: &str) -> Result<(), String> {
        if !self.config_path.exists() {
            return Ok(());
        }

        let config_content = fs::read_to_string(&self.config_path)
            .map_err(|e| format!("Failed to read SSH config: {}", e))?;

        let marker_id = format!("(ID: {})", agent_id);
        let marker_end = format!("# End Ariana Agent: {}", agent_id);

        let mut result = String::new();
        let mut inside_agent_block = false;

        for line in config_content.lines() {
            if line.contains(&marker_id) && line.starts_with("# Ariana Agent:") {
                inside_agent_block = true;
            } else if inside_agent_block && line.starts_with(&marker_end) {
                inside_agent_block = false;
                continue;
            } else if !inside_agent_block {
                result.push_str(line);
                result.push('\n');
            }
        }

        fs::write(&self.config_path, result)
            .map_err(|e| format!("Failed to write SSH config: {}", e))?;

        Ok(())
    }
}
