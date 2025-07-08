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

    pub fn copy_files_optimized(
        source: &str, 
        destination: &str, 
        os_session: &OsSession,
        exclude_git: bool
    ) -> Result<(), String> {
        match os_session {
            OsSession::Local(_) => {
                Self::copy_files_optimized_local(source, destination, exclude_git)
            }
            OsSession::Wsl(wsl_session) => {
                // Check if both paths are Windows mount points (/mnt/c/, /mnt/d/, etc.)
                // If so, use Windows native copy for maximum efficiency
                if Self::is_windows_mount_path(source) && Self::is_windows_mount_path(destination) {
                    Self::copy_files_windows_from_wsl_paths(source, destination, exclude_git)
                } else {
                    Self::copy_files_optimized_wsl(source, destination, &wsl_session.distribution, exclude_git)
                }
            }
        }
    }

    fn copy_files_optimized_local(source: &str, destination: &str, exclude_git: bool) -> Result<(), String> {
        let src_path = Path::new(source);
        if !src_path.exists() {
            return Err("Source path does not exist".to_string());
        }
        
        #[cfg(target_os = "windows")]
        {
            use crate::system::SystemManager;
            
            // Create destination directory if it doesn't exist
            if let Some(parent) = Path::new(&destination).parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create destination directory: {}", e))?;
            }
            
            // Use PowerShell for better performance and progress tracking
            let mut ps_command = format!(
                "$src = '{}'; $dst = '{}'; ",
                source.replace("'", "''"),
                destination.replace("'", "''")
            );
            
            if exclude_git {
                ps_command.push_str("Copy-Item -Path $src -Destination $dst -Recurse -Force -Exclude '.git'");
            } else {
                ps_command.push_str("Copy-Item -Path $src -Destination $dst -Recurse -Force");
            }
            
            SystemManager::execute_command("powershell", &["-Command", &ps_command]).map(|_| ())?
        }
        
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            use crate::system::SystemManager;
            
            // Use rsync for better performance
            let mut args = vec!["-a", "--info=progress2"];
            
            if exclude_git {
                args.push("--exclude=.git");
            }
            
            args.push(&format!("{}/", source));
            args.push(destination);
            
            SystemManager::execute_command("rsync", &args).or_else(|_| {
                // Fallback to cp if rsync is not available
                let mut cp_args = vec!["-r"];
                if exclude_git {
                    cp_args.push("--exclude=.git");
                }
                cp_args.push(source);
                cp_args.push(destination);
                SystemManager::execute_command("cp", &cp_args)
            }).map(|_| ())?
        }
        
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn copy_files_optimized_wsl(source: &str, destination: &str, distribution: &str, exclude_git: bool) -> Result<(), String> {
        let mut args = vec!["-av", "--info=progress2"];
        
        if exclude_git {
            args.push("--exclude=.git");
        }
        
        let source_with_slash = format!("{}/", source);
        args.push(&source_with_slash);
        args.push(destination);
        
        CommandExecutor::execute_with_os_session(
            "rsync", 
            &args,
            None, 
            &OsSession::Wsl(crate::os::WslSession {
                distribution: distribution.to_string(),
                working_directory: "/".to_string(),
            })
        ).or_else(|_| {
            // Fallback to optimized cp
            let mut cp_args = vec!["-r"];
            if exclude_git {
                cp_args.push("--exclude=.git");
            }
            cp_args.push(source);
            cp_args.push(destination);
            
            CommandExecutor::execute_with_os_session(
                "cp", 
                &cp_args,
                None, 
                &OsSession::Wsl(crate::os::WslSession {
                    distribution: distribution.to_string(),
                    working_directory: "/".to_string(),
                })
            )
        }).map(|_| ())
    }

    fn is_windows_mount_path(path: &str) -> bool {
        // Check if path starts with /mnt/[c-z]/ (Windows drive mount in WSL)
        if path.len() >= 6 && path.starts_with("/mnt/") {
            let drive_char = path.chars().nth(5);
            if let Some(c) = drive_char {
                return c.is_ascii_lowercase() && c >= 'c' && c <= 'z' && path.chars().nth(6) == Some('/');
            }
        }
        false
    }

    #[cfg(target_os = "windows")]
    fn copy_files_windows_from_wsl_paths(source: &str, destination: &str, exclude_git: bool) -> Result<(), String> {
        use crate::system::SystemManager;
        
        // Convert WSL mount paths to Windows paths
        let windows_source = Self::convert_wsl_mount_to_windows_path(source);
        let windows_dest = Self::convert_wsl_mount_to_windows_path(destination);
        
        println!("Optimized copy: WSL paths detected, using Windows native copy");
        println!("  {} -> {}", windows_source, windows_dest);
        
        // Create destination directory if it doesn't exist
        if let Some(parent) = std::path::Path::new(&windows_dest).parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create destination directory: {}", e))?;
        }
        
        // Use robocopy for maximum efficiency (multi-threaded, optimized for Windows)
        let mut robocopy_args = vec![
            windows_source.clone(),
            windows_dest.clone(),
            "*".to_string(),
            "/E".to_string(),      // Copy subdirectories including empty ones
            "/MT:16".to_string(),  // Multi-threaded with 16 threads for max speed
            "/R:2".to_string(),    // Retry twice on failure
            "/W:1".to_string(),    // Wait 1 second between retries
            "/NP".to_string(),     // No progress (we handle this separately)
            "/NDL".to_string(),    // No directory list
            "/NFL".to_string(),    // No file list
        ];
        
        if exclude_git {
            robocopy_args.extend(vec!["/XD".to_string(), ".git".to_string()]);
        }
        
        let args_str: Vec<&str> = robocopy_args.iter().map(|s| s.as_str()).collect();
        let result = SystemManager::execute_command("robocopy", &args_str);
        
        // Robocopy returns 0-7 for success, 8+ for errors
        match result {
            Ok(_) => Ok(()),
            Err(err) => {
                // Check if it's a robocopy success code (robocopy is weird with return codes)
                if err.contains("successful") || err.is_empty() {
                    Ok(())
                } else {
                    // Fallback to PowerShell copy
                    println!("Robocopy failed, falling back to PowerShell");
                    Self::copy_files_powershell_fallback(&windows_source, &windows_dest, exclude_git)
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    fn copy_files_powershell_fallback(source: &str, destination: &str, exclude_git: bool) -> Result<(), String> {
        use crate::system::SystemManager;
        
        let mut ps_command = format!(
            "$src = '{}'; $dst = '{}'; ",
            source.replace("'", "''"),
            destination.replace("'", "''")
        );
        
        if exclude_git {
            ps_command.push_str("Copy-Item -Path $src -Destination $dst -Recurse -Force -Exclude '.git'");
        } else {
            ps_command.push_str("Copy-Item -Path $src -Destination $dst -Recurse -Force");
        }
        
        SystemManager::execute_command("powershell", &["-Command", &ps_command])
            .map(|_| ())
            .map_err(|e| format!("PowerShell copy failed: {}", e))
    }

    #[cfg(target_os = "windows")]
    fn convert_wsl_mount_to_windows_path(wsl_path: &str) -> String {
        // Convert /mnt/c/path/to/file to C:\path\to\file
        if wsl_path.len() >= 6 && wsl_path.starts_with("/mnt/") {
            let drive_char = wsl_path.chars().nth(5).unwrap().to_ascii_uppercase();
            let rest_of_path = &wsl_path[6..]; // Skip "/mnt/c"
            let windows_path = rest_of_path.replace('/', "\\");
            format!("{}:{}", drive_char, windows_path)
        } else {
            wsl_path.to_string()
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn copy_files_windows_from_wsl_paths(_source: &str, _destination: &str, _exclude_git: bool) -> Result<(), String> {
        Err("Windows native copy is only available on Windows".to_string())
    }

    #[cfg(target_os = "windows")]
    fn convert_windows_path_to_wsl(windows_path: &str) -> String {
        if windows_path.len() >= 2 && windows_path.chars().nth(1) == Some(':') {
            let drive_char = windows_path.chars().nth(0).unwrap().to_ascii_lowercase();
            let rest_of_path = &windows_path[2..];
            let unix_path = rest_of_path.replace('\\', "/");
            format!("/mnt/{}{}", drive_char, unix_path)
        } else {
            windows_path.to_string()
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn copy_files_optimized_wsl(_source: &str, _destination: &str, _distribution: &str, _exclude_git: bool) -> Result<(), String> {
        Err("WSL is only supported on Windows".to_string())
    }


    pub fn get_copy_stats(source: &str, destination: &str, os_session: &OsSession) -> Result<serde_json::Value, String> {
        match os_session {
            OsSession::Local(_) => {
                Self::get_copy_stats_local(source, destination)
            }
            OsSession::Wsl(wsl_session) => {
                // If both paths are Windows mounts, use Windows native stats for accuracy
                if Self::is_windows_mount_path(source) && Self::is_windows_mount_path(destination) {
                    #[cfg(target_os = "windows")]
                    {
                        let windows_source = Self::convert_wsl_mount_to_windows_path(source);
                        let windows_dest = Self::convert_wsl_mount_to_windows_path(destination);
                        Self::get_copy_stats_local(&windows_source, &windows_dest)
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        Self::get_copy_stats_wsl(source, destination, &wsl_session.distribution)
                    }
                } else {
                    Self::get_copy_stats_wsl(source, destination, &wsl_session.distribution)
                }
            }
        }
    }

    fn get_copy_stats_local(source: &str, destination: &str) -> Result<serde_json::Value, String> {
        let src_path = Path::new(source);
        let dst_path = Path::new(destination);
        
        if !src_path.exists() {
            return Err("Source path does not exist".to_string());
        }
        
        let total_size = Self::get_directory_size(src_path)?;
        let copied_size = if dst_path.exists() {
            Self::get_directory_size(dst_path)?
        } else {
            0
        };
        
        Ok(serde_json::json!({
            "total": total_size,
            "copied": copied_size,
            "currentFile": ""
        }))
    }

    #[cfg(target_os = "windows")]
    fn get_copy_stats_wsl(source: &str, destination: &str, distribution: &str) -> Result<serde_json::Value, String> {
        let total_cmd = format!("du -sb '{}' 2>/dev/null | cut -f1", source);
        let total_result = CommandExecutor::execute_with_os_session(
            "bash", 
            &["-c", &total_cmd],
            None, 
            &OsSession::Wsl(crate::os::WslSession {
                distribution: distribution.to_string(),
                working_directory: "/".to_string(),
            })
        )?;
        
        let copied_cmd = format!("du -sb '{}' 2>/dev/null | cut -f1 || echo 0", destination);
        let copied_result = CommandExecutor::execute_with_os_session(
            "bash", 
            &["-c", &copied_cmd],
            None, 
            &OsSession::Wsl(crate::os::WslSession {
                distribution: distribution.to_string(),
                working_directory: "/".to_string(),
            })
        )?;
        
        let total_size: u64 = total_result.trim().parse().unwrap_or(0);
        let copied_size: u64 = copied_result.trim().parse().unwrap_or(0);
        
        Ok(serde_json::json!({
            "total": total_size,
            "copied": copied_size,
            "currentFile": ""
        }))
    }

    #[cfg(not(target_os = "windows"))]
    fn get_copy_stats_wsl(_source: &str, _destination: &str, _distribution: &str) -> Result<serde_json::Value, String> {
        Err("WSL is only supported on Windows".to_string())
    }

    fn get_directory_size(path: &Path) -> Result<u64, String> {
        let mut total_size = 0;
        
        if path.is_file() {
            let metadata = path.metadata()
                .map_err(|e| format!("Failed to get file metadata: {}", e))?;
            return Ok(metadata.len());
        }
        
        if path.is_dir() {
            let entries = fs::read_dir(path)
                .map_err(|e| format!("Failed to read directory: {}", e))?;
            
            for entry in entries {
                let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
                let entry_path = entry.path();
                total_size += Self::get_directory_size(&entry_path)?;
            }
        }
        
        Ok(total_size)
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