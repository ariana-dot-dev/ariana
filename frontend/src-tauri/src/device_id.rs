use std::fs;
use tauri::Manager;

/// Get machine ID (hardware-based identifier)
#[tauri::command]
pub fn get_machine_id() -> Result<String, String> {
    machine_uid::get().map_err(|e| format!("Failed to get machine ID: {}", e))
}

/// Get or create device UUID stored in app data directory
#[tauri::command]
pub fn get_device_uuid(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure app data directory exists
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    let device_id_path = app_data_dir.join(".device_uuid");

    // Try to read existing UUID
    if let Ok(existing_uuid) = fs::read_to_string(&device_id_path) {
        let trimmed = existing_uuid.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    // Generate new UUID
    let new_uuid = uuid::Uuid::new_v4().to_string();

    // Save to file
    fs::write(&device_id_path, &new_uuid)
        .map_err(|e| format!("Failed to write device UUID: {}", e))?;

    Ok(new_uuid)
}
