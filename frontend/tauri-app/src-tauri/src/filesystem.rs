use crate::commands::CommandExecutor;
use crate::os::OsSession;
use std::fs;
use std::path::Path;

/// Filesystem operations with OS session awareness
pub struct FileSystemManager;

impl FileSystemManager {
    pub fn create_directory(path: &str, os_session: &OsSession) -> Result<(), String> {
        match os_session {
            OsSession::Local(_) => {
                fs::create_dir_all(path)
                    .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
            }
            OsSession::Wsl(wsl_session) => {
                Self::create_directory_wsl(path, &wsl_session.distribution)
            }
        }
    }

    #[cfg(target_os = "windows")]
    fn create_directory_wsl(path: &str, distribution: &str) -> Result<(), String> {
        CommandExecutor::execute_with_os_session(
            "mkdir", 
            &["-p", path], 
            None, 
            &OsSession::Wsl(crate::os::WslSession {
                distribution: distribution.to_string(),
                working_directory: "/".to_string(),
            })
        ).map(|_| ())
    }

    #[cfg(not(target_os = "windows"))]
    fn create_directory_wsl(_path: &str, _distribution: &str) -> Result<(), String> {
        Err("WSL is only supported on Windows".to_string())
    }

    pub fn delete_path(path: &str, os_session: &OsSession) -> Result<(), String> {
        match os_session {
            OsSession::Local(_) => {
                Self::delete_path_local(path)
            }
            OsSession::Wsl(wsl_session) => {
                Self::delete_path_wsl(path, &wsl_session.distribution)
            }
        }
    }

    fn delete_path_local(path: &str) -> Result<(), String> {
        crate::system::SystemManager::delete_path_simple(path)
    }

    #[cfg(target_os = "windows")]
    fn delete_path_wsl(path: &str, distribution: &str) -> Result<(), String> {
        CommandExecutor::execute_with_os_session(
            "rm", 
            &["-rf", path], 
            None, 
            &OsSession::Wsl(crate::os::WslSession {
                distribution: distribution.to_string(),
                working_directory: "/".to_string(),
            })
        ).map(|_| ())
    }

    #[cfg(not(target_os = "windows"))]
    fn delete_path_wsl(_path: &str, _distribution: &str) -> Result<(), String> {
        Err("WSL is only available on Windows".to_string())
    }

    pub fn copy_files_simple(source: &str, destination: &str, os_session: &OsSession) -> Result<(), String> {
        Self::copy_files_with_exclusion(source, destination, os_session, false)
    }

    fn copy_files_local_simple(source: &str, destination: &str) -> Result<(), String> {
        let src_path = Path::new(source);
        let dst_path = Path::new(destination);
        
        if !src_path.exists() {
            return Err("Source directory does not exist".to_string());
        }
        
        // Create destination directory if it doesn't exist
        if let Some(parent) = dst_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination parent directory: {}", e))?;
        }
        
        // Use system copy command for better performance
        #[cfg(target_os = "windows")]
        {
            use crate::system::SystemManager;
            let ps_command = format!(
                "Copy-Item -Path '{}' -Destination '{}' -Recurse -Force",
                source.replace("'", "''"),
                destination.replace("'", "''")
            );
            SystemManager::execute_command("powershell", &["-Command", &ps_command]).map(|_| ())?
        }
        
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            use crate::system::SystemManager;
            SystemManager::execute_command("cp", &["-r", source, destination]).map(|_| ())?
        }
        
        Ok(())
    }


    pub fn copy_files_with_exclusion(
        source: &str, 
        destination: &str, 
        os_session: &OsSession,
        exclude_git: bool
    ) -> Result<(), String> {
        if exclude_git {
            match os_session {
                OsSession::Local(_) => {
                    Self::copy_files_local(source, destination, exclude_git)
                }
                OsSession::Wsl(wsl_session) => {
                    Self::copy_files_wsl(source, destination, &wsl_session.distribution, exclude_git)
                }
            }
        } else {
            // Simple copy without exclusions - use the simpler method
            match os_session {
                OsSession::Local(_) => {
                    Self::copy_files_local_simple(source, destination)
                }
                OsSession::Wsl(wsl_session) => {
                    CommandExecutor::execute_with_os_session(
                        "cp", 
                        &["-r", source, destination], 
                        None, 
                        &OsSession::Wsl(crate::os::WslSession {
                            distribution: wsl_session.distribution.to_string(),
                            working_directory: "/".to_string(),
                        })
                    ).map(|_| ())
                }
            }
        }
    }

    fn copy_files_local(source: &str, destination: &str, exclude_git: bool) -> Result<(), String> {
        let src_path = Path::new(source);
        if !src_path.exists() {
            return Err("Source path does not exist".to_string());
        }
        
        // Use different commands based on OS
        #[cfg(target_os = "windows")]
        {
            use crate::system::SystemManager;
            
            // Create destination directory if it doesn't exist
            if let Some(parent) = Path::new(&destination).parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create destination directory: {}", e))?;
            }
            
            let mut args = vec![
                source.replace("/", "\\"),
                destination.replace("/", "\\"),
                "*".to_string(),
                "/E".to_string(),
            ];
            
            if exclude_git {
                args.extend(vec!["/XD".to_string(), ".git".to_string()]);
            }
            
            let args_str: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            SystemManager::execute_command("robocopy", &args_str).map(|_| ()).or_else(|_| Ok::<(), String>(()))?  // Robocopy returns non-zero on success
        }
        
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            use crate::system::SystemManager;
            
            let mut args = vec!["-r".to_string()];
            
            if exclude_git {
                args.push("--exclude=.git".to_string());
            }
            
            args.push(format!("{}/*", source));
            args.push(destination.to_string());
            
            let args_str: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
            SystemManager::execute_command("cp", &args_str).map(|_| ())?
        }
        
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn copy_files_wsl(source: &str, destination: &str, distribution: &str, exclude_git: bool) -> Result<(), String> {
        if exclude_git {
            CommandExecutor::execute_with_os_session(
                "rsync", 
                &["-av", "--exclude=.git", &format!("{}/*", source), destination], 
                None, 
                &OsSession::Wsl(crate::os::WslSession {
                    distribution: distribution.to_string(),
                    working_directory: "/".to_string(),
                })
            ).or_else(|_| {
                // Fallback to cp with find exclusion
                CommandExecutor::execute_with_os_session(
                    "bash", 
                    &["-c", &format!("mkdir -p '{}' && cd '{}' && find . -name '.git' -prune -o -type f -exec cp --parents {{}} '{}' \\;", destination, source, destination)], 
                    None, 
                    &OsSession::Wsl(crate::os::WslSession {
                        distribution: distribution.to_string(),
                        working_directory: "/".to_string(),
                    })
                )
            }).map(|_| ())
        } else {
            CommandExecutor::execute_with_os_session(
                "cp", 
                &["-r", &format!("{}/*", source), destination], 
                None, 
                &OsSession::Wsl(crate::os::WslSession {
                    distribution: distribution.to_string(),
                    working_directory: "/".to_string(),
                })
            ).map(|_| ())
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn copy_files_wsl(_source: &str, _destination: &str, _distribution: &str, _exclude_git: bool) -> Result<(), String> {
        Err("WSL is only supported on Windows".to_string())
    }

    pub fn open_in_explorer(path: &str) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use crate::system::SystemManager;
            let windows_path = path.replace('/', "\\");
            let path_obj = std::path::Path::new(&windows_path);
            
            if path_obj.is_dir() {
                SystemManager::execute_command("explorer", &[&windows_path]).map(|_| ())
            } else {
                SystemManager::execute_command("explorer", &["/select,", &windows_path]).map(|_| ())
            }?
        }
        
        #[cfg(target_os = "macos")]
        {
            use crate::system::SystemManager;
            SystemManager::execute_command("open", &[path]).map(|_| ())?
        }
        
        #[cfg(target_os = "linux")]
        {
            use crate::system::SystemManager;
            let file_managers = ["xdg-open", "nautilus", "dolphin", "thunar", "pcmanfm"];
            
            for manager in &file_managers {
                if SystemManager::execute_command(manager, &[path]).is_ok() {
                    return Ok(());
                }
            }
            
            return Err("Failed to open file manager on Linux".to_string());
        }
        
        Ok(())
    }
}