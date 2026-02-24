use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use uuid::Uuid;


#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncInfo {
    pub sync_id: String,
    pub sync_path: String,
}

#[tauri::command]
pub fn create_new_sync(agent_id: String) -> Result<SyncInfo, String> {
    let sync_id = Uuid::new_v4().to_string();

    // Get appropriate temp directory based on OS
    let temp_dir = if cfg!(target_os = "windows") {
        std::env::temp_dir()
    } else if cfg!(target_os = "macos") {
        std::env::temp_dir()
    } else {
        // Linux and other Unix-like systems
        std::env::temp_dir()
    };

    // Create sync-specific path: {temp}/ide2-syncs/{agent_id}
    let sync_path = temp_dir.join("ide2-syncs").join(&agent_id);

    // Create the directory if it doesn't exist
    fs::create_dir_all(&sync_path)
        .map_err(|e| format!("Failed to create sync directory: {}", e))?;

    Ok(SyncInfo {
        sync_id,
        sync_path: sync_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn write_sync_file(
    base_path: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let full_path = Path::new(&base_path).join(&relative_path);

    // Create parent directories if needed
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directories: {}", e))?;
    }

    // Write the file as bytes (content is the decoded string from base64)
    fs::write(&full_path, content.as_bytes())
        .map_err(|e| format!("Failed to write file {}: {}", relative_path, e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_sync_file(base_path: String, relative_path: String) -> Result<(), String> {
    let full_path = Path::new(&base_path).join(&relative_path);

    // Check if file exists before deleting
    if full_path.exists() {
        if full_path.is_file() {
            fs::remove_file(&full_path)
                .map_err(|e| format!("Failed to delete file {}: {}", relative_path, e))?;
        } else if full_path.is_dir() {
            fs::remove_dir_all(&full_path)
                .map_err(|e| format!("Failed to delete directory {}: {}", relative_path, e))?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn create_sync_dir(base_path: String, relative_path: String) -> Result<(), String> {
    let full_path = Path::new(&base_path).join(&relative_path);

    // Create the directory (and any parent directories)
    fs::create_dir_all(&full_path)
        .map_err(|e| format!("Failed to create directory {}: {}", relative_path, e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_sync_dir(base_path: String, relative_path: String) -> Result<(), String> {
    let full_path = Path::new(&base_path).join(&relative_path);

    // Check if directory exists before deleting
    if full_path.exists() && full_path.is_dir() {
        fs::remove_dir_all(&full_path)
            .map_err(|e| format!("Failed to delete directory {}: {}", relative_path, e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn prepare_sync_directory(target_path: String) -> Result<String, String> {
    let path = Path::new(&target_path);

    // Create the directory if it doesn't exist
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create sync directory: {}", e))?;

    // Return the input path as-is (already absolute from frontend)
    Ok(target_path)
}