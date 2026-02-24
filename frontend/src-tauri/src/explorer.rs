use crate::command_utils::new_command;

#[tauri::command]
pub async fn open_path_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let windows_path = path.replace('/', "\\");
        let path_obj = std::path::Path::new(&windows_path);

        if path_obj.is_dir() {
            new_command("explorer")
                .arg(&windows_path)
                .spawn()
                .map_err(|e| format!("Failed to open explorer: {}", e))?;
        } else {
            new_command("explorer")
                .args(&["/select,", &windows_path])
                .spawn()
                .map_err(|e| format!("Failed to open explorer: {}", e))?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        new_command("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        new_command("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}
