use crate::{custom_terminal::CustomTerminalManager, os::OsSession};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn custom_connect_terminal(
	os_session: OsSession,
	app_handle: AppHandle,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<String, String> {
	let terminal_manager = manager;
	terminal_manager
		.connect_terminal(os_session, app_handle)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_kill_terminal(
	id: String,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<(), String> {
	let terminal_manager = manager;
	terminal_manager
		.kill_terminal(&id)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_send_input_lines(
	id: String,
	lines: Vec<String>,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<(), String> {
	let terminal_manager = manager;
	terminal_manager
		.send_input_lines(&id, lines)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_send_raw_input(
	id: String,
	data: String,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<(), String> {
	let terminal_manager = manager;
	terminal_manager
		.send_raw_input(&id, &data)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_send_ctrl_c(
	id: String,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<(), String> {
	let terminal_manager = manager;
	terminal_manager.send_ctrl_c(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_send_ctrl_d(
	id: String,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<(), String> {
	let terminal_manager = manager;
	terminal_manager.send_ctrl_d(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_send_scroll_up(
	id: String,
	amount: usize,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<(), String> {
	let terminal_manager = manager;
	terminal_manager
		.increment_scrollback(&id, amount)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_send_scroll_down(
	id: String,
	amount: usize,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<(), String> {
	let terminal_manager = manager;
	terminal_manager
		.decrement_scrollback(&id, amount)
		.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_resize_terminal(
	id: String,
	lines: u16,
	cols: u16,
	manager: State<'_, Arc<CustomTerminalManager>>,
) -> Result<(), String> {
	let terminal_manager = manager;
	terminal_manager
		.resize_terminal(&id, lines, cols)
		.map_err(|e| e.to_string())
}
