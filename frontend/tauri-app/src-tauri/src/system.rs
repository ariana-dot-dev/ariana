use std::process::Command;
use std::path::Path;
use crate::os::OsSessionKind;

/// System integration operations
pub struct SystemManager;

impl SystemManager {
    pub fn execute_command(command: &str, args: &[&str]) -> Result<String, String> {
        #[cfg(target_os = "windows")]
        let output = {
            use std::os::windows::process::CommandExt;
            Command::new(command)
                .args(args)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .map_err(|e| format!("Failed to execute command: {}", e))?
        };
        
        #[cfg(not(target_os = "windows"))]
        let output = Command::new(command)
            .args(args)
            .output()
            .map_err(|e| format!("Failed to execute command: {}", e))?;
        
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    pub fn execute_command_in_dir(command: &str, args: &[&str], directory: &str) -> Result<String, String> {
        #[cfg(target_os = "windows")]
        let output = {
            use std::os::windows::process::CommandExt;
            Command::new(command)
                .args(args)
                .current_dir(directory)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .map_err(|e| format!("Failed to execute command: {}", e))?
        };
        
        #[cfg(not(target_os = "windows"))]
        let output = Command::new(command)
            .args(args)
            .current_dir(directory)
            .output()
            .map_err(|e| format!("Failed to execute command: {}", e))?;
        
        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    pub fn delete_path_simple(path: &str) -> Result<(), String> {
        use std::fs;
        
        let path_obj = Path::new(path);
        
        if !path_obj.exists() {
            return Err(format!("Path does not exist: {}", path));
        }
        
        if path_obj.is_dir() {
            fs::remove_dir_all(path)
                .map_err(|e| format!("Failed to delete directory '{}': {}", path, e))
        } else {
            fs::remove_file(path)
                .map_err(|e| format!("Failed to delete file '{}': {}", path, e))
        }
    }

    #[cfg(target_os = "windows")]
    pub fn check_wsl_path_exists(path: &str) -> bool {
        // Try to get first available WSL distribution
        if let Ok(available) = OsSessionKind::list_available() {
            for session in available {
                if let OsSessionKind::Wsl(dist_name) = session {
                    // Use WSL test command to check if directory exists
                    use std::os::windows::process::CommandExt;
                    let output = Command::new("wsl")
                        .arg("-d")
                        .arg(&dist_name)
                        .arg("test")
                        .arg("-d")
                        .arg(path)
                        .creation_flags(0x08000000) // CREATE_NO_WINDOW
                        .output();
                    
                    if let Ok(result) = output {
                        return result.status.success();
                    }
                    break; // Use first available distribution
                }
            }
        }
        false
    }

    #[cfg(not(target_os = "windows"))]
    pub fn check_wsl_path_exists(_path: &str) -> bool {
        // On non-Windows, WSL paths don't make sense, so return false
        false
    }
}