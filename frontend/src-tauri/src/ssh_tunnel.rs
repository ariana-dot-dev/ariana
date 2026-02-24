use std::collections::HashMap;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use tauri::State;
use crate::ssh_utils::{get_ssh_key_path, find_ssh_executable, get_common_ssh_options};
use crate::command_utils::new_command;

// Track active SSH tunnels: (agent_id, remote_port) -> Child process
pub struct TunnelManager {
    tunnels: Mutex<HashMap<(String, u16), Child>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            tunnels: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub fn establish_ssh_tunnel(
    agent_id: String,
    machine_ip: String,
    remote_port: u16,
    local_port: Option<u16>,
    ssh_user: Option<String>,
    tunnel_manager: State<'_, Arc<TunnelManager>>,
) -> Result<u16, String> {
    let actual_local_port = local_port.unwrap_or(remote_port);
    let key = (agent_id.clone(), remote_port);

    // Check if tunnel already exists
    let mut tunnels = tunnel_manager.tunnels.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    if tunnels.contains_key(&key) {
        return Ok(actual_local_port); // Already established
    }

    // Get SSH key path and executable from centralized utilities
    let ssh_key_path = get_ssh_key_path()?;
    let ssh_cmd = find_ssh_executable()?;
    let common_opts = get_common_ssh_options();

    // Use provided SSH user or default to 'ariana' for backward compatibility
    let user = ssh_user.unwrap_or_else(|| "ariana".to_string());

    // Build arguments (store formatted strings to extend lifetime)
    let port_forward = format!("{}:localhost:{}", actual_local_port, remote_port);
    let ssh_target = format!("{}@{}", user, machine_ip);

    let mut args = vec![
        "-i", &ssh_key_path,
        "-L", &port_forward,
        "-N", // No remote command
    ];
    args.extend(common_opts);
    args.push("-o");
    args.push("ExitOnForwardFailure=yes");
    args.push(&ssh_target);

    // Spawn SSH tunnel process
    let child = new_command(&ssh_cmd)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn SSH tunnel: {}", e))?;

    // Store the child process
    tunnels.insert(key.clone(), child);

    println!("[TunnelManager] Established tunnel: agent={}, {}:{} -> localhost:{}",
        agent_id, machine_ip, remote_port, actual_local_port);

    Ok(actual_local_port)
}

#[tauri::command]
pub fn close_all_tunnels_for_agent(
    agent_id: String,
    tunnel_manager: State<'_, Arc<TunnelManager>>,
) -> Result<(), String> {
    let mut tunnels = tunnel_manager.tunnels.lock()
        .map_err(|e| format!("Failed to acquire lock: {}", e))?;

    // Collect keys to remove (can't mutate while iterating)
    let keys_to_remove: Vec<_> = tunnels.keys()
        .filter(|(aid, _)| aid == &agent_id)
        .cloned()
        .collect();

    for key in keys_to_remove {
        if let Some(mut child) = tunnels.remove(&key) {
            let _ = child.kill();
            println!("[TunnelManager] Closed tunnel: agent={}, port={}", key.0, key.1);
        }
    }

    Ok(())
}
