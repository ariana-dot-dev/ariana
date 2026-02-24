use serde::{Deserialize, Serialize};

use crate::checks::{check_command_exists, check_app_exists_macos, check_windows_app_installed};
use crate::ssh_config::SSHConfigManager;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableIDE {
    pub id: String,
    pub name: String,
    pub command: String,
    pub is_available: bool,
}

#[tauri::command]
pub async fn get_available_ides() -> Result<Vec<AvailableIDE>, String> {
    let mut ides = Vec::new();
    ides.push(check_ide_availability("vscode", "VSCode", "code").await);
    ides.push(check_ide_availability("cursor", "Cursor", "cursor").await);
    ides.push(check_ide_availability("zed", "Zed", "zed").await);
    ides.push(check_ide_availability("windsurf", "Windsurf", "windsurf").await);
    ides.push(check_ide_availability("neovim", "Neovim", "nvim").await);

    // JetBrains IDEs
    ides.push(check_ide_availability("idea", "IntelliJ", "idea").await);
    ides.push(check_ide_availability("webstorm", "WebStorm", "webstorm").await);
    ides.push(check_ide_availability("pycharm", "PyCharm", "pycharm").await);
    ides.push(check_ide_availability("phpstorm", "PhpStorm", "phpstorm").await);
    ides.push(check_ide_availability("rubymine", "RubyMine", "rubymine").await);
    ides.push(check_ide_availability("goland", "GoLand", "goland").await);
    ides.push(check_ide_availability("clion", "CLion", "clion").await);
    ides.push(check_ide_availability("rider", "Rider", "rider").await);
    ides.push(check_ide_availability("datagrip", "DataGrip", "datagrip").await);
    ides.push(check_ide_availability("studio", "Android Studio", "studio").await);

    Ok(ides)
}

async fn check_ide_availability(id: &str, name: &str, command: &str) -> AvailableIDE {
    let cmd_exists = check_command_exists(command).await;
    let app_exists_mac = check_app_exists_macos(name).await;
    let app_exists_win = check_windows_app_installed(command).await;

    let is_available = match id {
        "vscode" => cmd_exists || app_exists_mac || app_exists_win,
        "cursor" => cmd_exists || app_exists_mac || app_exists_win,
        "zed" => cmd_exists || app_exists_mac || app_exists_win,
        "windsurf" => cmd_exists || app_exists_mac || app_exists_win,
        "neovim" => cmd_exists || check_command_exists("neovim").await,
        // JetBrains IDEs - check alternative command names too
        "idea" => cmd_exists || app_exists_mac || app_exists_win,
        "webstorm" => cmd_exists || check_command_exists("wstorm").await || app_exists_mac || app_exists_win,
        "pycharm" => cmd_exists || check_command_exists("charm").await || app_exists_mac || app_exists_win,
        "phpstorm" => cmd_exists || check_command_exists("pstorm").await || app_exists_mac || app_exists_win,
        "rubymine" => cmd_exists || check_command_exists("mine").await || app_exists_mac || app_exists_win,
        "goland" => cmd_exists || app_exists_mac || app_exists_win,
        "clion" => cmd_exists || app_exists_mac || app_exists_win,
        "rider" => cmd_exists || app_exists_mac || app_exists_win,
        "datagrip" => cmd_exists || app_exists_mac || app_exists_win,
        "studio" => cmd_exists || app_exists_mac || app_exists_win,
        _ => false,
    };

    AvailableIDE {
        id: id.to_string(),
        name: name.to_string(),
        command: command.to_string(),
        is_available,
    }
}

#[tauri::command]
pub fn get_ide_url(path: String, ide_id: String) -> Result<String, String> {
    let url_path = path.replace("\\", "/");

    // JetBrains IDEs use a different URL scheme format
    let url = match ide_id.as_str() {
        "idea" | "webstorm" | "pycharm" | "phpstorm" | "rubymine" | "goland" | "clion" | "rider" | "datagrip" | "studio" => {
            // JetBrains uses: jetbrains://{product}/open?file={path}&line=1
            format!("jetbrains://{}/open?file={}", ide_id, url_path)
        }
        _ => {
            // Other IDEs use: {ide}://file/{path}
            format!("{}://file/{}", ide_id, url_path)
        }
    };

    Ok(url)
}

#[tauri::command]
pub fn get_ide_ssh_url(
    agent_id: String,
    agent_name: String,
    machine_ip: String,
    ssh_user: String,
    ide_id: String,
    remote_path: Option<String>,
) -> Result<String, String> {
    // Create or update SSH config entry
    let ssh_config = SSHConfigManager::new()?;
    let host_alias = ssh_config.upsert_agent_entry(
        &agent_id,
        &agent_name,
        &machine_ip,
        &ssh_user,
    )?;

    // Default remote path to ~/project if not specified
    let path = remote_path.unwrap_or_else(|| format!("/home/{}/project", ssh_user));

    // Generate the appropriate SSH deeplink based on IDE
    let url = match ide_id.as_str() {
        "vscode" => {
            format!("vscode://vscode-remote/ssh-remote+{}{}", host_alias, path)
        }
        "cursor" => {
            format!("cursor://vscode-remote/ssh-remote+{}{}", host_alias, path)
        }
        "windsurf" => {
            format!("windsurf://vscode-remote/ssh-remote+{}{}", host_alias, path)
        }
        "zed" => {
            // Zed uses: zed://ssh/user@host/path
            format!("zed://ssh/{}@{}{}", ssh_user, machine_ip, path)
        }
        // JetBrains IDEs - require manual Gateway setup
        "idea" | "webstorm" | "pycharm" | "phpstorm" | "rubymine" | "goland" | "clion" | "rider" | "datagrip" | "studio" => {
            return Err(format!(
                "JetBrains IDEs require manual setup via Gateway:\n\n1. Open JetBrains Gateway\n2. Select 'SSH Connection'\n3. Enter connection details:\n   - Host: {}\n   - User: {}\n   - Port: 22\n   - Authentication: Key pair\n   - Private key: ~/.ssh/ariana_id_ed25519\n4. Select project path: {}\n5. Click 'Check Connection and Continue'",
                machine_ip, ssh_user, path
            ));
        }
        "neovim" => {
            // Neovim doesn't support deeplinks - provide SSH command instead
            return Err(format!(
                "Neovim doesn't support deeplinks. Use this SSH command instead:\nssh -i ~/.ssh/ariana_id_ed25519 {}@{} \"cd {} && nvim\"",
                ssh_user, machine_ip, path
            ));
        }
        _ => {
            return Err(format!("Unsupported IDE for SSH remote: {}", ide_id));
        }
    };

    Ok(url)
}

#[tauri::command]
pub fn cleanup_agent_ssh_config(agent_id: String) -> Result<(), String> {
    let ssh_config = SSHConfigManager::new()?;
    ssh_config.remove_agent_entry(&agent_id)?;
    Ok(())
}
