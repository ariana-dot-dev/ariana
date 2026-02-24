#[cfg(target_os = "macos")]
use std::path::Path;

use crate::command_utils::new_command;

pub async fn check_command_exists(command: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        println!("[IDE Detection] Running 'where {}' on Windows", command);

        match new_command("where")
            .arg(command)
            .output() {
            Ok(output) => {
                let success = output.status.success();
                if success {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    println!(
                        "[IDE Detection] 'where {}' succeeded, found at: {}",
                        command,
                        stdout.trim()
                    );
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    println!(
                        "[IDE Detection] 'where {}' failed: {}",
                        command,
                        stderr.trim()
                    );
                }
                success
            }
            Err(e) => {
                println!("[IDE Detection] Failed to run 'where {}': {}", command, e);
                false
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        println!("[IDE Detection] Running 'which {}' on Unix", command);
        match new_command("which").arg(command).output() {
            Ok(output) => {
                let success = output.status.success();
                if success {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    println!(
                        "[IDE Detection] 'which {}' succeeded, found at: {}",
                        command,
                        stdout.trim()
                    );
                } else {
                    println!("[IDE Detection] 'which {}' failed", command);
                }
                success
            }
            Err(e) => {
                println!("[IDE Detection] Failed to run 'which {}': {}", command, e);
                false
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub async fn check_app_exists_macos(app_name: &str) -> bool {
    let app_path = format!("/Applications/{}.app", app_name);
    Path::new(&app_path).exists() ||
    // Also check in user Applications folder
    {
        if let Some(home) = dirs::home_dir() {
            let user_app_path = home.join("Applications").join(format!("{}.app", app_name));
            user_app_path.exists()
        } else {
            false
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub async fn check_app_exists_macos(_app_name: &str) -> bool {
    false
}

#[cfg(target_os = "windows")]
pub async fn check_windows_app_installed(app_name: &str) -> bool {
    // This is redundant with check_command_exists, but keeping for clarity
    check_command_exists(app_name).await
}

#[cfg(not(target_os = "windows"))]
pub async fn check_windows_app_installed(_app_name: &str) -> bool {
    false
}