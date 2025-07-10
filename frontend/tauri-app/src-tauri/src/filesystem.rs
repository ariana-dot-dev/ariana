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
                    Self::copy_files_windows_from_wsl_paths(source, destination, exclude_git, wsl_session)
                } else {
                    Self::copy_files_optimized_wsl(source, destination, &wsl_session.distribution, exclude_git)
                }
            }
        }
    }

    /// Check if a directory contains any Cargo projects (anywhere in the tree)
    fn contains_cargo_projects(directory: &str, os_session: &OsSession) -> bool {
        let result = match os_session {
            OsSession::Local(_) => {
                // Use appropriate command based on OS
                #[cfg(target_os = "windows")]
                {
                    use crate::system::SystemManager;
                    let ps_command = format!(
                        "Get-ChildItem -Path '{}' -Recurse -Name 'Cargo.toml' -File -ErrorAction SilentlyContinue | Select-Object -First 1",
                        directory.replace("'", "''")
                    );
                    let find_result = SystemManager::execute_command("powershell", &["-Command", &ps_command]);
                    find_result.is_ok() && !find_result.unwrap_or_default().trim().is_empty()
                }
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                {
                    use crate::system::SystemManager;
                    let find_result = SystemManager::execute_command("find", &[directory, "-name", "Cargo.toml", "-type", "f"]);
                    find_result.is_ok() && !find_result.unwrap_or_default().trim().is_empty()
                }
            }
            OsSession::Wsl(wsl_session) => {
                // Use find command in WSL to search for Cargo.toml files
                let cmd_result = CommandExecutor::execute_with_os_session(
                    "find", 
                    &[directory, "-name", "Cargo.toml", "-type", "f"], 
                    None, 
                    &OsSession::Wsl(crate::os::WslSession {
                        distribution: wsl_session.distribution.to_string(),
                        working_directory: "/".to_string(),
                    })
                );
                cmd_result.is_ok() && !cmd_result.unwrap_or_default().trim().is_empty()
            }
        };
        
        println!("Cargo projects check: {} -> {}", directory, result);
        result
    }

    fn copy_files_optimized_local(source: &str, destination: &str, exclude_git: bool) -> Result<(), String> {
        let src_path = Path::new(source);
        if !src_path.exists() {
            return Err("Source path does not exist".to_string());
        }
        
        // Check if this is a Cargo project to determine smart exclusions
        let contains_cargo_projects = Self::contains_cargo_projects(source, &OsSession::Local(source.to_string()));
        
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
            
            let mut exclude_patterns = Vec::new();
            if exclude_git {
                exclude_patterns.push(".git");
            }
            if contains_cargo_projects {
                exclude_patterns.push("target");
            }
            
            if exclude_patterns.is_empty() {
                ps_command.push_str("Copy-Item -Path $src -Destination $dst -Recurse -Force");
            } else {
                ps_command.push_str(&format!(
                    "Copy-Item -Path $src -Destination $dst -Recurse -Force -Exclude @({})",
                    exclude_patterns.iter().map(|p| format!("'{}'", p)).collect::<Vec<_>>().join(",")
                ));
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
            if contains_cargo_projects {
                args.push("--exclude=target");
            }
            
            let source_with_slash = format!("{}/", source);
            args.push(&source_with_slash);
            args.push(destination);
            
            SystemManager::execute_command("rsync", &args).or_else(|_| {
                // Fallback to manual copy if rsync is not available
                // Standard cp doesn't support --exclude, so we need a different approach
                if exclude_git || contains_cargo_projects {
                    // Use tar with exclusions for better control
                    let mut tar_args = vec!["-cf", "-"];
                    if exclude_git {
                        tar_args.extend(vec!["--exclude", ".git"]);
                    }
                    if contains_cargo_projects {
                        tar_args.extend(vec!["--exclude", "target"]);
                    }
                    tar_args.push("-C");
                    tar_args.push(source);
                    tar_args.push(".");
                    
                    // Create destination directory
                    let _ = SystemManager::execute_command("mkdir", &["-p", destination]);
                    
                    // Use tar to copy with exclusions
                    let tar_cmd = format!("cd '{}' && tar -cf - . ", source);
                    let exclude_flags = if exclude_git || contains_cargo_projects {
                        let mut flags = Vec::new();
                        if exclude_git {
                            flags.push("--exclude=.git");
                        }
                        if contains_cargo_projects {
                            flags.push("--exclude=target");
                        }
                        flags.join(" ")
                    } else {
                        String::new()
                    };
                    
                    SystemManager::execute_command("sh", &["-c", &format!("cd '{}' && tar -cf - {} . | (cd '{}' && tar -xf -)", 
                        source, exclude_flags, destination)])
                } else {
                    // Simple cp without exclusions
                    SystemManager::execute_command("cp", &["-r", source, destination])
                }
            }).map(|_| ())?
        }
        
        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn copy_files_optimized_wsl(source: &str, destination: &str, distribution: &str, exclude_git: bool) -> Result<(), String> {
        let wsl_session = crate::os::WslSession {
            distribution: distribution.to_string(),
            working_directory: "/".to_string(),
        };
        
        // Check if this is a Cargo project to determine smart exclusions
        let contains_cargo_projects = Self::contains_cargo_projects(source, &OsSession::Wsl(wsl_session.clone()));
        
        let mut args = vec!["-av", "--info=progress2"];
        
        if exclude_git {
            args.push("--exclude=.git");
        }
        if contains_cargo_projects {
            args.push("--exclude=target");
        }
        
        let source_with_slash = format!("{}/", source);
        args.push(&source_with_slash);
        args.push(destination);
        
        CommandExecutor::execute_with_os_session(
            "rsync", 
            &args,
            None, 
            &OsSession::Wsl(wsl_session.clone())
        ).or_else(|_| {
            // Fallback to optimized cp
            let mut cp_args = vec!["-r"];
            if exclude_git {
                cp_args.push("--exclude=.git");
            }
            if contains_cargo_projects {
                cp_args.push("--exclude=target");
            }
            cp_args.push(source);
            cp_args.push(destination);
            
            CommandExecutor::execute_with_os_session(
                "cp", 
                &cp_args,
                None, 
                &OsSession::Wsl(wsl_session)
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
    fn copy_files_windows_from_wsl_paths(source: &str, destination: &str, exclude_git: bool, wsl_session: &crate::os::WslSession) -> Result<(), String> {
        use crate::system::SystemManager;
        
        // Convert WSL mount paths to Windows paths
        let windows_source = Self::convert_wsl_mount_to_windows_path(source);
        let windows_dest = Self::convert_wsl_mount_to_windows_path(destination);
        
        println!("Optimized copy: WSL paths detected, using Windows native copy");
        println!("  {} -> {}", windows_source, windows_dest);
        
        // Check if this contains Cargo projects to determine smart exclusions
        // Use the original WSL path with WSL osSession to respect user's choice
        let contains_cargo_projects = Self::contains_cargo_projects(source, &OsSession::Wsl(wsl_session.clone()));
        
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
        if contains_cargo_projects {
            robocopy_args.extend(vec!["/XD".to_string(), "target".to_string()]);
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
                    Self::copy_files_powershell_fallback(&windows_source, &windows_dest, exclude_git, contains_cargo_projects)
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    fn copy_files_powershell_fallback(source: &str, destination: &str, exclude_git: bool, contains_cargo_projects: bool) -> Result<(), String> {
        use crate::system::SystemManager;
        
        let mut ps_command = format!(
            "$src = '{}'; $dst = '{}'; ",
            source.replace("'", "''"),
            destination.replace("'", "''")
        );
        
        let mut exclude_patterns = Vec::new();
        if exclude_git {
            exclude_patterns.push(".git");
        }
        if contains_cargo_projects {
            exclude_patterns.push("target");
        }
        
        if exclude_patterns.is_empty() {
            ps_command.push_str("Copy-Item -Path $src -Destination $dst -Recurse -Force");
        } else {
            ps_command.push_str(&format!(
                "Copy-Item -Path $src -Destination $dst -Recurse -Force -Exclude @({})",
                exclude_patterns.iter().map(|p| format!("'{}'", p)).collect::<Vec<_>>().join(",")
            ));
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
    fn copy_files_windows_from_wsl_paths(_source: &str, _destination: &str, _exclude_git: bool, _wsl_session: &crate::os::WslSession) -> Result<(), String> {
        Err("Windows native copy is only available on Windows".to_string())
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
                        
                        // Use the original source path with WSL session for Cargo detection
                        let contains_cargo_projects = Self::contains_cargo_projects(source, os_session);
                        
                        Self::get_copy_stats_local_with_exclusions(&windows_source, &windows_dest, contains_cargo_projects)
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
        // Check if this contains Cargo projects to determine what to exclude
        let contains_cargo_projects = Self::contains_cargo_projects(source, &OsSession::Local(source.to_string()));
        Self::get_copy_stats_local_with_exclusions(source, destination, contains_cargo_projects)
    }
    
    fn get_copy_stats_local_with_exclusions(source: &str, destination: &str, exclude_target: bool) -> Result<serde_json::Value, String> {
        let src_path = Path::new(source);
        let dst_path = Path::new(destination);
        
        if !src_path.exists() {
            return Err("Source path does not exist".to_string());
        }
        
        let total_size = Self::get_directory_size_with_exclusions(src_path, exclude_target)?;
        let copied_size = if dst_path.exists() {
            Self::get_directory_size_with_exclusions(dst_path, exclude_target)?
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
        let wsl_session = crate::os::WslSession {
            distribution: distribution.to_string(),
            working_directory: "/".to_string(),
        };
        
        // Check if this contains Cargo projects to determine what to exclude
        let contains_cargo_projects = Self::contains_cargo_projects(source, &OsSession::Wsl(wsl_session.clone()));
        
        // Build exclusion pattern for du command
        let exclusions = if contains_cargo_projects {
            " --exclude='target'"
        } else {
            ""
        };
        
        let total_cmd = format!("du -sb{} '{}' 2>/dev/null | cut -f1", exclusions, source);
        let total_result = CommandExecutor::execute_with_os_session(
            "bash", 
            &["-c", &total_cmd],
            None, 
            &OsSession::Wsl(wsl_session.clone())
        )?;
        
        let copied_cmd = format!("du -sb{} '{}' 2>/dev/null | cut -f1 || echo 0", exclusions, destination);
        let copied_result = CommandExecutor::execute_with_os_session(
            "bash", 
            &["-c", &copied_cmd],
            None, 
            &OsSession::Wsl(wsl_session)
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
        Self::get_directory_size_with_exclusions(path, false)
    }
    
    fn get_directory_size_with_exclusions(path: &Path, exclude_target: bool) -> Result<u64, String> {
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
                let entry_name = entry.file_name().to_string_lossy().to_string();
                
                // Skip target directories if exclusion is enabled
                if exclude_target && entry_name == "target" && entry_path.is_dir() {
                    continue;
                }
                
                total_size += Self::get_directory_size_with_exclusions(&entry_path, exclude_target)?;
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

    pub fn open_in_explorer_with_os_session(path: &str, os_session: &OsSession) -> Result<(), String> {
        match os_session {
            OsSession::Local(_) => {
                // For local sessions, use the path directly
                Self::open_in_explorer(path)
            }
            OsSession::Wsl(wsl_session) => {
                // For WSL sessions, convert to Windows path format
                #[cfg(target_os = "windows")]
                {
                    use crate::system::SystemManager;
                    
                    // Convert WSL path to Windows explorer format
                    let windows_path = if path.starts_with("/mnt/") {
                        // Path like /mnt/c/Users/... -> C:\Users\...
                        Self::convert_wsl_mount_to_windows_path(path)
                    } else {
                        // Path like /home/user/... -> \\wsl$\Ubuntu\home\user\...
                        let wsl_path = format!("\\\\wsl$\\{}\\{}", 
                            wsl_session.distribution, 
                            path.trim_start_matches('/').replace('/', "\\"));
                        wsl_path
                    };
                    
                    let path_obj = std::path::Path::new(&windows_path);
                    
                    if path_obj.is_dir() {
                        SystemManager::execute_command("explorer", &[&windows_path]).map(|_| ())
                    } else {
                        SystemManager::execute_command("explorer", &["/select,", &windows_path]).map(|_| ())
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    Err("WSL path opening is only supported on Windows".to_string())
                }
            }
        }
    }
}