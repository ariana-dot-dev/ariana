use std::sync::Arc;

use tauri::State;
use crate::terminal::TerminalManager;

#[tauri::command]
pub async fn create_terminal_connection(
	terminal_manager: State<'_, Arc<TerminalManager>>,
	app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let working_directory = {
        #[cfg(target_os = "windows")]
        {
            "C:\\Users\\"
        }
        #[cfg(not(target_os = "windows"))]
        {
            "/home/"
        }
    };

	terminal_manager
		.create_connection(&working_directory, app_handle)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_terminal_data(
	connection_id: String,
	data: String,
	terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
	terminal_manager
		.send_data(&connection_id, &data)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn resize_terminal(
	connection_id: String,
	cols: u16,
	rows: u16,
	terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
	terminal_manager
		.resize_terminal(&connection_id, cols, rows)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn close_terminal_connection(
	connection_id: String,
	terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
	terminal_manager
		.close_connection(&connection_id)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_dead_connections(
	terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
	terminal_manager
		.cleanup_dead_connections()
		.map_err(|e| e.to_string())
}