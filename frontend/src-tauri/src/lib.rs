use std::fs;
use std::path::Path;
use std::env;

use std::sync::Arc;
use tauri::Emitter;

mod terminal;
use terminal::TerminalManager;

mod terminal_commands;
use terminal_commands::{
    create_terminal_connection,
    send_terminal_data,
    resize_terminal,
    close_terminal_connection,
    cleanup_dead_connections
};

mod checks;

mod command_utils;

mod project_upload;
use project_upload::{create_zip_from_directory, read_file_bytes, create_git_bundle_and_patch, create_incremental_git_bundle_and_patch, create_patch_based_upload_data, delete_temp_file, get_file_info, read_file_chunk_base64};

mod sync;
use sync::{
    create_new_sync,
    prepare_sync_directory,
    write_sync_file,
    delete_sync_file,
    create_sync_dir,
    delete_sync_dir,
};

mod claude_credentials;
use claude_credentials::read_claude_cli_credentials;

mod git;
use git::get_github_remote_url;

mod os;

mod explorer;

mod ides;
use ides::get_available_ides;

mod ssh_utils;

mod ssh_config;

mod ssh_keys;
use ssh_keys::get_or_create_ssh_key;

mod list_ssh_keys;
use list_ssh_keys::{list_available_ssh_keys, read_ssh_key_pair};

mod ssh_tunnel;
use ssh_tunnel::{
    TunnelManager,
    establish_ssh_tunnel,
    close_all_tunnels_for_agent,
};

mod device_id;
use device_id::{get_machine_id, get_device_uuid};

// Removed Claude CLI OAuth commands
use crate::explorer::open_path_in_explorer;
use crate::ides::{get_ide_url, get_ide_ssh_url, cleanup_agent_ssh_config};
use crate::os::get_os;

#[tauri::command]
async fn extract_zip_to_directory(zip_data: Vec<u8>, target_path: String) -> Result<(), String> {
    let target_dir = Path::new(&target_path);

    // Create target directory if it doesn't exist
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create target directory: {}", e))?;

    // Extract based on platform
    #[cfg(target_os = "windows")]
    {
        use std::io::{self, Cursor};
        use zip::ZipArchive;

        let cursor = Cursor::new(zip_data);
        let mut archive =
            ZipArchive::new(cursor).map_err(|e| format!("Failed to read zip archive: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("Failed to access file in archive: {}", e))?;

            let outpath = match file.enclosed_name() {
                Some(path) => target_dir.join(path),
                None => continue,
            };

            if file.name().ends_with('/') {
                fs::create_dir_all(&outpath)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        fs::create_dir_all(&p)
                            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;
                io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Failed to extract file: {}", e))?;
            }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        // Save zip to temporary file
        let temp_zip = format!("/tmp/sync_{}.zip", uuid::Uuid::new_v4());
        fs::write(&temp_zip, zip_data)
            .map_err(|e| format!("Failed to write temporary zip file: {}", e))?;

        // Use unzip command
        let output = command_utils::new_command("unzip")
            .arg("-o") // overwrite without prompting
            .arg("-q") // quiet
            .arg(&temp_zip)
            .arg("-d")
            .arg(&target_path)
            .output()
            .map_err(|e| format!("Failed to run unzip command: {}", e))?;

        // Clean up temp file
        let _ = fs::remove_file(&temp_zip);

        if !output.status.success() {
            return Err(format!(
                "Unzip failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
          println!("a new app instance was opened with {argv:?} and the deep link event was already triggered");
          // when defining deep link schemes at runtime, you must also check `argv` here
        }));
    }

    let terminal_manager = Arc::new(TerminalManager::new());

    // Setup tunnel manager
    let tunnel_manager = Arc::new(TunnelManager::new());

    builder.plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .manage(terminal_manager)
        .manage(tunnel_manager)
        .invoke_handler(tauri::generate_handler![
            create_terminal_connection,
			send_terminal_data,
			resize_terminal,
			close_terminal_connection,
			cleanup_dead_connections,
            get_os,
            open_path_in_explorer,
            extract_zip_to_directory,
            create_zip_from_directory,
            read_file_bytes,
            delete_temp_file,
            get_file_info,
            read_file_chunk_base64,
            create_git_bundle_and_patch,
            create_incremental_git_bundle_and_patch,
            create_patch_based_upload_data,
            create_new_sync,
            prepare_sync_directory,
            write_sync_file,
            delete_sync_file,
            create_sync_dir,
            delete_sync_dir,
            get_available_ides,
            get_ide_url,
            get_ide_ssh_url,
            cleanup_agent_ssh_config,
            get_or_create_ssh_key,
            list_available_ssh_keys,
            read_ssh_key_pair,
            get_github_remote_url,
            establish_ssh_tunnel,
            close_all_tunnels_for_agent,
            get_machine_id,
            get_device_uuid,
            read_claude_cli_credentials,
        ])
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            // Main code for handling CLI arguments
            // Capture CLI arguments and emit to frontend
            let cli_args: Vec<String> = std::env::args().skip(1).collect();

            // Process arguments or use CWD if none provided
            let processed_args = if !cli_args.is_empty() {
                // Process each argument
                cli_args.iter().map(|arg| {
                    if looks_like_path(arg) {
                        to_clean_absolute_path(arg)
                    } else {
                        // Not a path, keep as is
                        arg.clone()
                    }
                }).collect()
            } else {
                vec![]
            };

            if !processed_args.is_empty() {
                println!("Processed CLI args: {:?}", processed_args);
                let app_handle = app.handle().clone();
                
                // Emit after a short delay to ensure frontend is ready
                tauri::async_runtime::spawn(async move {
                    std::thread::sleep(std::time::Duration::from_millis(2500));
                    if let Err(e) = app_handle.emit("cli-args", &processed_args) {
                        eprintln!("Failed to emit cli-args: {}", e);
                    } else {
                        println!("CLI args emitted successfully");
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


// Helper function to convert to clean absolute path
fn to_clean_absolute_path(path: &str) -> String {
    let path = Path::new(path);
    
    // Try to get absolute path
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        // Get current directory and join with the relative path
        match env::current_dir() {
            Ok(cwd) => cwd.join(path),
            Err(_) => path.to_path_buf(),
        }
    };
    
    // On Windows, canonicalize can add \\?\ prefix, we need to remove it
    #[cfg(target_os = "windows")]
    {
        let path_str = absolute.to_string_lossy();
        // Remove \\?\ prefix if present
        if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            stripped.to_string()
        } else {
            path_str.to_string()
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        absolute.to_string_lossy().to_string()
    }
}

// Helper function to check if a string looks like a path
fn looks_like_path(s: &str) -> bool {
    // Check if it starts with path indicators
    s.starts_with("./") || 
    s.starts_with(".\\") ||
    s.starts_with("../") ||
    s.starts_with("..\\") ||
    s == "." ||
    s == ".." ||
    // Check if it's an absolute path
    (cfg!(target_os = "windows") && s.len() >= 3 && s.chars().nth(1) == Some(':')) ||
    (cfg!(not(target_os = "windows")) && s.starts_with('/')) ||
    // Check if it contains path separators
    s.contains('/') || 
    s.contains('\\') ||
    // Check if it exists as a file or directory
    Path::new(s).exists()
}