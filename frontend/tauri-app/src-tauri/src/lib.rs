// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
	all(not(debug_assertions), target_os = "windows"),
	windows_subsystem = "windows"
)]

use std::sync::Arc;
use std::path::Path;
use tauri::State;

mod terminal;
use terminal::TerminalManager;

mod custom_terminal;
mod custom_terminal_commands;

mod os;
mod commands;
mod git;
mod filesystem;
mod system;

use custom_terminal_commands::{
	custom_connect_terminal, custom_kill_terminal, custom_resize_terminal,
	custom_send_ctrl_c, custom_send_ctrl_d, custom_send_input_lines,
	custom_send_raw_input, custom_send_scroll_down, custom_send_scroll_up,
};

use crate::{
	custom_terminal::CustomTerminalManager,
	os::{FileNode, GitSearchManager, GitSearchResult, OsSession, OsSessionKind},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let terminals_manager = Arc::new(TerminalManager::new());
	let custom_terminals_manager = Arc::new(CustomTerminalManager::new());
	let git_search_manager = Arc::new(GitSearchManager::new());

	tauri::Builder::default()
		.plugin(tauri_plugin_os::init())
		.plugin(tauri_plugin_store::Builder::new().build())
		.plugin(tauri_plugin_fs::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_shell::init())
		.manage(terminals_manager)
		.manage(custom_terminals_manager)
		.manage(git_search_manager)
		.invoke_handler(tauri::generate_handler![
			// Original terminal commands
			create_terminal_connection,
			send_terminal_data,
			resize_terminal,
			close_terminal_connection,
			cleanup_dead_connections,
			// New custom terminal commands
			custom_connect_terminal,
			custom_kill_terminal,
			custom_send_input_lines,
			custom_send_raw_input,
			custom_send_ctrl_c,
			custom_send_ctrl_d,
			custom_send_scroll_up,
			custom_send_scroll_down,
			custom_resize_terminal,
			// File tree commands
			get_current_dir,
			get_file_tree,
			// Git search commands
			start_git_directories_search,
			get_found_git_directories_so_far,
			cancel_git_directories_search,
			list_available_os_session_kinds,
			// Canvas management commands
			copy_files_optimized,
			get_copy_stats,
			get_git_hash,
			create_git_branch,
			execute_command,
			execute_command_in_dir,
			execute_command_with_os_session,
			// System integration commands
			open_path_in_explorer,
			open_path_in_explorer_with_os_session,
			delete_path,
			delete_path_with_os_session,
			// Git repository commands
			check_git_repository,
			git_init_repository,
			create_directory_with_os_session,
			git_commit,
			git_revert_to_commit,
			git_check_merge_conflicts,
			git_get_conflict_files,
			git_merge_branch,
			git_get_current_branch,
			git_get_origin_url,
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

// ===== TERMINAL MANAGEMENT =====

#[tauri::command]
async fn create_terminal_connection(
	os_session: OsSession,
	terminal_manager: State<'_, Arc<TerminalManager>>,
	app_handle: tauri::AppHandle,
) -> Result<String, String> {
	terminal_manager
		.create_connection(os_session, app_handle)
		.map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_terminal_data(
	connection_id: String,
	data: String,
	terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
	terminal_manager
		.send_data(&connection_id, &data)
		.map_err(|e| e.to_string())
}

#[tauri::command]
async fn resize_terminal(
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
async fn close_terminal_connection(
	connection_id: String,
	terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
	terminal_manager
		.close_connection(&connection_id)
		.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cleanup_dead_connections(
	terminal_manager: State<'_, Arc<TerminalManager>>,
) -> Result<(), String> {
	terminal_manager
		.cleanup_dead_connections()
		.map_err(|e| e.to_string())
}

// ===== FILE SYSTEM OPERATIONS =====

#[tauri::command]
async fn get_current_dir(os_session: OsSession) -> Result<String, String> {
	Ok(os_session.get_working_directory().to_string())
}

#[tauri::command]
async fn get_file_tree(
	os_session: OsSession,
	path: String,
) -> Result<Vec<FileNode>, String> {
	os_session
		.read_directory(&path)
		.await
		.map_err(|e| e.to_string())
}

#[tauri::command]
async fn copy_files_optimized(
	source: String, 
	destination: String, 
	os_session: OsSession,
	exclude_git: Option<bool>
) -> Result<(), String> {
	let should_exclude = exclude_git.unwrap_or(false);
	filesystem::FileSystemManager::copy_files_optimized(&source, &destination, &os_session, should_exclude)
}

#[tauri::command]
async fn get_copy_stats(
	source: String, 
	destination: String, 
	os_session: OsSession
) -> Result<serde_json::Value, String> {
	filesystem::FileSystemManager::get_copy_stats(&source, &destination, &os_session)
}

#[tauri::command]
async fn get_git_hash(
	directory: String, 
	os_session: OsSession
) -> Result<String, String> {
	git::GitManager::get_current_hash(&directory, &os_session)
}

#[tauri::command]
async fn open_path_in_explorer(path: String) -> Result<(), String> {
	filesystem::FileSystemManager::open_in_explorer(&path)
}

#[tauri::command]
async fn open_path_in_explorer_with_os_session(path: String, os_session: OsSession) -> Result<(), String> {
	filesystem::FileSystemManager::open_in_explorer_with_os_session(&path, &os_session)
}

#[tauri::command]
async fn delete_path(path: String) -> Result<(), String> {
	system::SystemManager::delete_path_simple(&path)
}

#[tauri::command]
async fn delete_path_with_os_session(path: String, os_session: OsSession) -> Result<(), String> {
	filesystem::FileSystemManager::delete_path(&path, &os_session)
}

#[tauri::command]
async fn create_directory_with_os_session(path: String, os_session: OsSession) -> Result<(), String> {
	filesystem::FileSystemManager::create_directory(&path, &os_session)
}

// ===== SYSTEM COMMANDS =====

#[tauri::command]
async fn execute_command(command: String, args: Vec<String>) -> Result<String, String> {
	let args_str: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
	system::SystemManager::execute_command(&command, &args_str)
}

#[tauri::command]
async fn execute_command_in_dir(command: String, args: Vec<String>, directory: String) -> Result<String, String> {
	let args_str: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
	system::SystemManager::execute_command_in_dir(&command, &args_str, &directory)
}

#[tauri::command]
async fn execute_command_with_os_session(
	command: String, 
	args: Vec<String>, 
	directory: String, 
	os_session: OsSession
) -> Result<String, String> {
	let args_str: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
	commands::CommandExecutor::execute_with_os_session(&command, &args_str, Some(&directory), &os_session)
}

// ===== GIT OPERATIONS =====

#[tauri::command]
async fn check_git_repository(directory: String, os_session: OsSession) -> Result<bool, String> {
	git::GitManager::check_repository(&directory, &os_session)
}

#[tauri::command]
async fn git_init_repository(directory: String, os_session: OsSession) -> Result<(), String> {
	git::GitManager::init_repository(&directory, &os_session)
}

#[tauri::command]
async fn git_commit(directory: String, message: String, os_session: OsSession) -> Result<String, String> {
	git::GitManager::commit(&directory, &message, &os_session)
}

#[tauri::command]
async fn git_revert_to_commit(directory: String, commit_hash: String, os_session: OsSession) -> Result<(), String> {
	git::GitManager::revert_to_commit(&directory, &commit_hash, &os_session)
}

#[tauri::command]
async fn create_git_branch(directory: String, branch_name: String, os_session: OsSession) -> Result<(), String> {
	git::GitManager::create_branch(&directory, &branch_name, &os_session)
}

#[tauri::command]
async fn git_get_current_branch(directory: String, os_session: OsSession) -> Result<String, String> {
	git::GitManager::get_current_branch(&directory, &os_session)
}

#[tauri::command]
async fn git_get_origin_url(directory: String, os_session: OsSession) -> Result<String, String> {
	git::GitManager::get_origin_url(&directory, &os_session)
}

#[tauri::command]
async fn git_check_merge_conflicts(
	directory: String,
	source_branch: String,
	target_branch: String,
	os_session: OsSession
) -> Result<bool, String> {
	git::GitManager::check_merge_conflicts(&directory, &source_branch, &target_branch, &os_session)
}

#[tauri::command]
async fn git_get_conflict_files(directory: String, os_session: OsSession) -> Result<Vec<String>, String> {
	git::GitManager::get_conflict_files(&directory, &os_session)
}

#[tauri::command]
async fn git_merge_branch(
	directory: String,
	source_branch: String,
	target_branch: String,
	os_session: OsSession
) -> Result<String, String> {
	git::GitManager::merge_branch(&directory, &source_branch, &target_branch, &os_session)
}

// ===== GIT SEARCH =====

#[tauri::command]
async fn start_git_directories_search(
	os_session_kind: OsSessionKind,
	git_search_manager: State<'_, Arc<GitSearchManager>>,
) -> Result<String, String> {
	let search_id = git_search_manager.start_search(os_session_kind);
	Ok(search_id)
}

#[tauri::command]
async fn get_found_git_directories_so_far(
	search_id: String,
	git_search_manager: State<'_, Arc<GitSearchManager>>,
) -> Result<GitSearchResult, String> {
	let mut result = git_search_manager
		.get_results(&search_id)
		.ok_or_else(|| "Search ID not found".to_string())?;
	
	println!("Backend - Raw search results before filtering: {} directories", result.directories.len());
	
	// Filter out deleted directories using appropriate method for each path type
	let original_count = result.directories.len();
	let mut filtered_dirs = Vec::new();
	
	for path in &result.directories {
		let exists = if path.starts_with("/mnt/") || (path.starts_with("/home") && cfg!(target_os = "windows")) {
			// WSL path - check existence using WSL command
			system::SystemManager::check_wsl_path_exists(path)
		} else {
			// Local path - use standard filesystem check
			let path_obj = Path::new(path);
			path_obj.exists() && path_obj.is_dir()
		};
		
		if exists {
			filtered_dirs.push(path.clone());
		} else {
			println!("Backend - Filtering out non-existent directory: {}", path);
		}
	}
	
	result.directories = filtered_dirs;
	println!("Backend - After existence filtering: {} directories (removed {})", result.directories.len(), original_count - result.directories.len());
	
	Ok(result)
}

#[tauri::command]
async fn list_available_os_session_kinds() -> Result<Vec<OsSessionKind>, String> {
	OsSessionKind::list_available().map_err(|e| e.to_string())
}

#[tauri::command]
async fn cancel_git_directories_search(
	search_id: String,
	git_search_manager: State<'_, Arc<GitSearchManager>>,
) -> Result<(), String> {
	git_search_manager.cancel_search(&search_id);
	Ok(())
}