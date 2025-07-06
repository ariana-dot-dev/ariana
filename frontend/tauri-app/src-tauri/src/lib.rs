// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
	all(not(debug_assertions), target_os = "windows"),
	windows_subsystem = "windows"
)]

use std::sync::Arc;
use std::process::Command;
use std::path::Path;
use tauri::State;

mod terminal;
use terminal::TerminalManager;

mod custom_terminal;
mod custom_terminal_commands;

mod os;

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
			list_available_os_session_kinds,
			// Canvas management commands
			copy_directory,
			create_git_branch,
			execute_command,
			execute_command_in_dir,
			execute_command_with_os_session,
			copy_files_with_os_session,
			// System integration commands
			open_path_in_explorer,
			delete_path,
			delete_path_with_os_session,
			// Git repository commands
			check_git_repository,
			git_commit,
			git_revert_to_commit,
			git_check_merge_conflicts,
			git_get_conflict_files,
			git_merge_branch,
			git_get_current_branch,
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}

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
async fn start_git_directories_search(
	os_session_kind: OsSessionKind,
	git_search_manager: State<'_, Arc<GitSearchManager>>,
) -> Result<String, String> {
	let search_id = git_search_manager.start_search(os_session_kind);
	Ok(search_id)
}

#[tauri::command]
async fn check_git_repository(directory: String) -> Result<bool, String> {
	let path = Path::new(&directory);
	
	// Check if the directory exists
	if !path.exists() {
		return Ok(false);
	}
	
	// Check if .git directory exists
	let git_dir = path.join(".git");
	if git_dir.exists() {
		return Ok(true);
	}
	
	// Alternatively, try using git command to check if it's a repository
	let output = Command::new("git")
		.arg("rev-parse")
		.arg("--git-dir")
		.current_dir(&directory)
		.output();
		
	match output {
		Ok(result) => Ok(result.status.success()),
		Err(_) => Ok(false),
	}
}

#[tauri::command]
async fn execute_command(command: String, args: Vec<String>) -> Result<String, String> {
	let output = Command::new(&command)
		.args(&args)
		.output()
		.map_err(|e| format!("Failed to execute command: {}", e))?;
	
	if output.status.success() {
		Ok(String::from_utf8_lossy(&output.stdout).to_string())
	} else {
		Err(String::from_utf8_lossy(&output.stderr).to_string())
	}
}

#[tauri::command]
async fn execute_command_in_dir(command: String, args: Vec<String>, directory: String) -> Result<String, String> {
	let output = Command::new(&command)
		.args(&args)
		.current_dir(&directory)
		.output()
		.map_err(|e| format!("Failed to execute command: {}", e))?;
	
	if output.status.success() {
		Ok(String::from_utf8_lossy(&output.stdout).to_string())
	} else {
		Err(String::from_utf8_lossy(&output.stderr).to_string())
	}
}

#[tauri::command]
async fn execute_command_with_os_session(
	command: String, 
	args: Vec<String>, 
	directory: String, 
	os_session: OsSession
) -> Result<String, String> {
	match os_session {
		OsSession::Local(_) => {
			execute_command_in_dir(command, args, directory).await
		}
		OsSession::Wsl(wsl_session) => {
			execute_command_wsl(command, args, directory, &wsl_session.distribution)
		}
	}
}

fn execute_command_wsl(command: String, args: Vec<String>, directory: String, distribution: &str) -> Result<String, String> {
	#[cfg(target_os = "windows")]
	{
		let mut wsl_args = vec!["-d".to_string(), distribution.to_string(), "--cd".to_string(), directory];
		wsl_args.push(command);
		wsl_args.extend(args);
		
		let output = Command::new("wsl")
			.args(&wsl_args)
			.output()
			.map_err(|e| format!("Failed to execute WSL command: {}", e))?;
		
		if output.status.success() {
			Ok(String::from_utf8_lossy(&output.stdout).to_string())
		} else {
			Err(String::from_utf8_lossy(&output.stderr).to_string())
		}
	}
	#[cfg(not(target_os = "windows"))]
	{
		Err("WSL is only supported on Windows".to_string())
	}
}

#[tauri::command]
async fn copy_files_with_os_session(
	source: String, 
	destination: String, 
	os_session: OsSession,
	exclude_git: bool
) -> Result<(), String> {
	match os_session {
		OsSession::Local(_) => {
			copy_files_local(&source, &destination, exclude_git)
		}
		OsSession::Wsl(wsl_session) => {
			copy_files_wsl(&source, &destination, &wsl_session.distribution, exclude_git)
		}
	}
}

fn copy_files_local(source: &str, destination: &str, exclude_git: bool) -> Result<(), String> {
	use std::fs;
	use std::path::Path;
	
	let src_path = Path::new(source);
	if !src_path.exists() {
		return Err("Source path does not exist".to_string());
	}
	
	// Use different commands based on OS
	#[cfg(target_os = "windows")]
	{
		// Use robocopy on Windows for better handling
		// Robocopy syntax: robocopy source destination [files] [options]
		let mut args = vec![
			source.replace("/", "\\"),
			destination.replace("/", "\\"),
			"*".to_string(),  // Copy all files
			"/E".to_string(),  // Copy subdirectories, including empty ones
		];
		
		if exclude_git {
			args.push("/XD".to_string());
			args.push(".git".to_string());
		}
		
		// Create destination directory if it doesn't exist
		if let Some(parent) = Path::new(&destination).parent() {
			fs::create_dir_all(parent)
				.map_err(|e| format!("Failed to create destination directory: {}", e))?;
		}
		
		let output = Command::new("robocopy")
			.args(&args)
			.output()
			.map_err(|e| format!("Failed to execute robocopy: {}", e))?;
		
		// Robocopy exit codes: 0-7 are success, >7 are errors
		let exit_code = output.status.code().unwrap_or(1);
		if exit_code > 7 {
			let stderr = String::from_utf8_lossy(&output.stderr);
			let stdout = String::from_utf8_lossy(&output.stdout);
			return Err(format!("Robocopy failed with exit code {}: stderr: {} stdout: {}", exit_code, stderr, stdout));
		}
	}
	
	#[cfg(any(target_os = "linux", target_os = "macos"))]
	{
		let mut args = vec!["-r".to_string()];
		
		if exclude_git {
			args.push("--exclude=.git".to_string());
		}
		
		args.push(format!("{}/*", source));
		args.push(destination.to_string());
		
		let output = Command::new("cp")
			.args(&args)
			.output()
			.map_err(|e| format!("Failed to execute cp: {}", e))?;
		
		if !output.status.success() {
			return Err(format!("cp failed: {}", String::from_utf8_lossy(&output.stderr)));
		}
	}
	
	Ok(())
}

#[cfg(target_os = "windows")]
fn copy_files_wsl(source: &str, destination: &str, distribution: &str, exclude_git: bool) -> Result<(), String> {
	if exclude_git {
		// Use rsync to exclude .git directories (more reliable than find/cpio)
		let rsync_cmd = format!(
			"rsync -av --exclude='.git' '{}/' '{}'",
			source.replace("'", "'\"'\"'"),
			destination.replace("'", "'\"'\"'")
		);
		
		let output = Command::new("wsl")
			.arg("-d")
			.arg(distribution)
			.arg("bash")
			.arg("-c")
			.arg(&rsync_cmd)
			.output()
			.map_err(|e| format!("Failed to execute WSL rsync: {}", e))?;
		
		if !output.status.success() {
			// Fall back to cp with manual exclusion if rsync is not available
			let cp_cmd = format!(
				"mkdir -p '{}' && cd '{}' && find . -name '.git' -prune -o -type f -exec cp --parents {{}} '{}' \\;",
				destination.replace("'", "'\"'\"'"),
				source.replace("'", "'\"'\"'"),
				destination.replace("'", "'\"'\"'")
			);
			
			let output2 = Command::new("wsl")
				.arg("-d")
				.arg(distribution)
				.arg("bash")
				.arg("-c")
				.arg(&cp_cmd)
				.output()
				.map_err(|e| format!("Failed to execute WSL cp fallback: {}", e))?;
			
			if !output2.status.success() {
				return Err(format!("WSL copy failed: {}", String::from_utf8_lossy(&output2.stderr)));
			}
		}
	} else {
		// Simple recursive copy
		let cp_cmd = format!(
			"cp -r '{}/'* '{}'",
			source.replace("'", "'\"'\"'"),
			destination.replace("'", "'\"'\"'")
		);
		
		let output = Command::new("wsl")
			.arg("-d")
			.arg(distribution)
			.arg("bash")
			.arg("-c")
			.arg(&cp_cmd)
			.output()
			.map_err(|e| format!("Failed to execute WSL cp: {}", e))?;
		
		if !output.status.success() {
			return Err(format!("WSL cp failed: {}", String::from_utf8_lossy(&output.stderr)));
		}
	}
	
	Ok(())
}

#[cfg(not(target_os = "windows"))]
fn copy_files_wsl(_source: &str, _destination: &str, _distribution: &str, _exclude_git: bool) -> Result<(), String> {
	Err("WSL is only supported on Windows".to_string())
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
			check_wsl_path_exists(path)
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

#[cfg(target_os = "windows")]
fn check_wsl_path_exists(path: &str) -> bool {
	// Try to get first available WSL distribution
	if let Ok(available) = crate::os::OsSessionKind::list_available() {
		for session in available {
			if let crate::os::OsSessionKind::Wsl(dist_name) = session {
				// Use WSL test command to check if directory exists
				let output = Command::new("wsl")
					.arg("-d")
					.arg(&dist_name)
					.arg("test")
					.arg("-d")
					.arg(path)
					.output();
				
				if let Ok(result) = output {
					return result.status.success();
				}
				break; // Use first available distribution
			}
		}
	}
	false
}

#[cfg(not(target_os = "windows"))]
fn check_wsl_path_exists(_path: &str) -> bool {
	// On non-Windows, WSL paths don't make sense, so return false
	false
}

#[tauri::command]
async fn list_available_os_session_kinds() -> Result<Vec<OsSessionKind>, String> {
	OsSessionKind::list_available().map_err(|e| e.to_string())
}

#[tauri::command]
async fn copy_directory(source: String, destination: String, os_session: OsSession) -> Result<(), String> {
	match os_session {
		OsSession::Local(_) => {
			copy_directory_local(&source, &destination)
		}
		OsSession::Wsl(wsl_session) => {
			copy_directory_wsl(&source, &destination, &wsl_session.distribution)
		}
	}
}

fn copy_directory_local(source: &str, destination: &str) -> Result<(), String> {
	use std::fs;
	use std::path::Path;
	
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
		// Use PowerShell Copy-Item for reliable directory copying on Windows
		let ps_command = format!(
			"Copy-Item -Path '{}' -Destination '{}' -Recurse -Force",
			source.replace("'", "''"),
			destination.replace("'", "''")
		);
		
		let output = Command::new("powershell")
			.arg("-Command")
			.arg(&ps_command)
			.output()
			.map_err(|e| format!("Failed to execute PowerShell copy: {}", e))?;
		
		if !output.status.success() {
			let stderr = String::from_utf8_lossy(&output.stderr);
			let stdout = String::from_utf8_lossy(&output.stdout);
			return Err(format!("PowerShell copy failed: {} {}", stderr, stdout));
		}
	}
	
	#[cfg(any(target_os = "linux", target_os = "macos"))]
	{
		let output = Command::new("cp")
			.arg("-r")
			.arg(source)
			.arg(destination)
			.output()
			.map_err(|e| format!("Failed to execute cp: {}", e))?;
		
		if !output.status.success() {
			return Err(format!("cp failed: {}", String::from_utf8_lossy(&output.stderr)));
		}
	}
	
	Ok(())
}

#[cfg(target_os = "windows")]
fn copy_directory_wsl(source: &str, destination: &str, distribution: &str) -> Result<(), String> {
	let output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("cp")
		.arg("-r")
		.arg(source)
		.arg(destination)
		.output()
		.map_err(|e| format!("Failed to execute WSL cp: {}", e))?;
	
	if !output.status.success() {
		return Err(format!("WSL cp failed: {}", String::from_utf8_lossy(&output.stderr)));
	}
	
	Ok(())
}

#[cfg(not(target_os = "windows"))]
fn copy_directory_wsl(_source: &str, _destination: &str, _distribution: &str) -> Result<(), String> {
	Err("WSL is only available on Windows".to_string())
}

#[tauri::command]
async fn create_git_branch(directory: String, branch_name: String, os_session: OsSession) -> Result<(), String> {
	match os_session {
		OsSession::Local(_) => {
			create_git_branch_local(&directory, &branch_name)
		}
		OsSession::Wsl(wsl_session) => {
			create_git_branch_wsl(&directory, &branch_name, &wsl_session.distribution)
		}
	}
}

fn create_git_branch_local(directory: &str, branch_name: &str) -> Result<(), String> {
	let output = Command::new("git")
		.arg("checkout")
		.arg("-B")
		.arg(branch_name)
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to execute git command: {}", e))?;
	
	if !output.status.success() {
		return Err(format!("Git checkout failed: {}", String::from_utf8_lossy(&output.stderr)));
	}
	
	Ok(())
}

#[cfg(target_os = "windows")]
fn create_git_branch_wsl(directory: &str, branch_name: &str, distribution: &str) -> Result<(), String> {
	// Execute git command inside WSL using --cd to change directory
	let output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("checkout")
		.arg("-B")
		.arg(branch_name)
		.output()
		.map_err(|e| format!("Failed to execute WSL git command: {}", e))?;
	
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		let stdout = String::from_utf8_lossy(&output.stdout);
		return Err(format!("WSL git checkout failed: stderr: {} stdout: {}", stderr, stdout));
	}
	
	Ok(())
}

#[cfg(not(target_os = "windows"))]
fn create_git_branch_wsl(_directory: &str, _branch_name: &str, _distribution: &str) -> Result<(), String> {
	Err("WSL is only available on Windows".to_string())
}

#[tauri::command]
async fn git_commit(directory: String, message: String, os_session: OsSession) -> Result<String, String> {
	match os_session {
		OsSession::Local(_) => {
			git_commit_local(&directory, &message)
		}
		OsSession::Wsl(wsl_session) => {
			git_commit_wsl(&directory, &message, &wsl_session.distribution)
		}
	}
}

fn git_commit_local(directory: &str, message: &str) -> Result<String, String> {
	// First, add all changes
	let add_output = Command::new("git")
		.arg("add")
		.arg(".")
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to execute git add command: {}", e))?;
	
	if !add_output.status.success() {
		return Err(format!("Git add failed: {}", String::from_utf8_lossy(&add_output.stderr)));
	}
	
	// Then commit
	let commit_output = Command::new("git")
		.arg("commit")
		.arg("-m")
		.arg(message)
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to execute git commit command: {}", e))?;
	
	if !commit_output.status.success() {
		let stderr = String::from_utf8_lossy(&commit_output.stderr);
		let stdout = String::from_utf8_lossy(&commit_output.stdout);
		
		// Check for "nothing to commit" scenarios
		if stderr.contains("nothing to commit") || stdout.contains("nothing to commit") {
			return Err("NO_CHANGES_TO_COMMIT".to_string());
		}
		
		return Err(format!("Git commit failed: {}", stderr));
	}
	
	// Get the commit hash
	let hash_output = Command::new("git")
		.arg("rev-parse")
		.arg("HEAD")
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to get commit hash: {}", e))?;
	
	if !hash_output.status.success() {
		return Err(format!("Failed to get commit hash: {}", String::from_utf8_lossy(&hash_output.stderr)));
	}
	
	Ok(String::from_utf8_lossy(&hash_output.stdout).trim().to_string())
}

#[cfg(target_os = "windows")]
fn git_commit_wsl(directory: &str, message: &str, distribution: &str) -> Result<String, String> {
	// First, add all changes
	let add_output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("add")
		.arg(".")
		.output()
		.map_err(|e| format!("Failed to execute WSL git add command: {}", e))?;
	
	if !add_output.status.success() {
		return Err(format!("WSL git add failed: {}", String::from_utf8_lossy(&add_output.stderr)));
	}
	
	// Then commit
	let commit_output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("commit")
		.arg("-m")
		.arg(message)
		.output()
		.map_err(|e| format!("Failed to execute WSL git commit command: {}", e))?;
	
	if !commit_output.status.success() {
		let stderr = String::from_utf8_lossy(&commit_output.stderr);
		let stdout = String::from_utf8_lossy(&commit_output.stdout);
		
		// Check for "nothing to commit" scenarios
		if stderr.contains("nothing to commit") || stdout.contains("nothing to commit") {
			return Err("NO_CHANGES_TO_COMMIT".to_string());
		}
		
		return Err(format!("WSL git commit failed: {}", stderr));
	}
	
	// Get the commit hash
	let hash_output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("rev-parse")
		.arg("HEAD")
		.output()
		.map_err(|e| format!("Failed to get WSL commit hash: {}", e))?;
	
	if !hash_output.status.success() {
		return Err(format!("Failed to get WSL commit hash: {}", String::from_utf8_lossy(&hash_output.stderr)));
	}
	
	Ok(String::from_utf8_lossy(&hash_output.stdout).trim().to_string())
}

#[cfg(not(target_os = "windows"))]
fn git_commit_wsl(_directory: &str, _message: &str, _distribution: &str) -> Result<String, String> {
	Err("WSL is only supported on Windows".to_string())
}

#[tauri::command]
async fn git_revert_to_commit(directory: String, commit_hash: String, os_session: OsSession) -> Result<(), String> {
	match os_session {
		OsSession::Local(_) => {
			git_revert_to_commit_local(&directory, &commit_hash)
		}
		OsSession::Wsl(wsl_session) => {
			git_revert_to_commit_wsl(&directory, &commit_hash, &wsl_session.distribution)
		}
	}
}

fn git_revert_to_commit_local(directory: &str, commit_hash: &str) -> Result<(), String> {
	let output = Command::new("git")
		.arg("reset")
		.arg("--hard")
		.arg(commit_hash)
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to execute git reset command: {}", e))?;
	
	if !output.status.success() {
		return Err(format!("Git reset failed: {}", String::from_utf8_lossy(&output.stderr)));
	}
	
	Ok(())
}

#[cfg(target_os = "windows")]
fn git_revert_to_commit_wsl(directory: &str, commit_hash: &str, distribution: &str) -> Result<(), String> {
	let output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("reset")
		.arg("--hard")
		.arg(commit_hash)
		.output()
		.map_err(|e| format!("Failed to execute WSL git reset command: {}", e))?;
	
	if !output.status.success() {
		return Err(format!("WSL git reset failed: {}", String::from_utf8_lossy(&output.stderr)));
	}
	
	Ok(())
}

#[cfg(not(target_os = "windows"))]
fn git_revert_to_commit_wsl(_directory: &str, _commit_hash: &str, _distribution: &str) -> Result<(), String> {
	Err("WSL is only supported on Windows".to_string())
}

#[tauri::command]
async fn open_path_in_explorer(path: String) -> Result<(), String> {
	#[cfg(target_os = "windows")]
	{
		// On Windows, normalize the path and use explorer.exe to open it
		let windows_path = path.replace('/', "\\");
		println!("Opening path in explorer - Original: '{}', Windows path: '{}'", path, windows_path);
		
		// Use /select to open the parent directory and highlight the folder
		// But if it's a directory, just open it directly
		let path_obj = std::path::Path::new(&windows_path);
		println!("Path exists: {}, Is directory: {}", path_obj.exists(), path_obj.is_dir());
		
		let output = if path_obj.is_dir() {
			// Open the directory directly
			println!("Opening directory directly: '{}'", windows_path);
			Command::new("explorer")
				.arg(&windows_path)
				.output()
		} else {
			// If it's a file, open the parent and select it
			println!("Using /select for file: '{}'", windows_path);
			Command::new("explorer")
				.arg("/select,")
				.arg(&windows_path)
				.output()
		};
		
		let result = output.map_err(|e| format!("Failed to open explorer: {}", e))?;
		
		if !result.status.success() {
			return Err(format!("Explorer failed: {}", String::from_utf8_lossy(&result.stderr)));
		}
		
		println!("Explorer command succeeded");
	}
	
	#[cfg(target_os = "macos")]
	{
		// On macOS, use open command
		let output = Command::new("open")
			.arg(&path)
			.output()
			.map_err(|e| format!("Failed to open finder: {}", e))?;
		
		if !output.status.success() {
			return Err(format!("Open failed: {}", String::from_utf8_lossy(&output.stderr)));
		}
	}
	
	#[cfg(target_os = "linux")]
	{
		// On Linux, try various file managers
		let file_managers = ["xdg-open", "nautilus", "dolphin", "thunar", "pcmanfm"];
		let mut success = false;
		
		for manager in &file_managers {
			let result = Command::new(manager)
				.arg(&path)
				.output();
			
			if let Ok(output) = result {
				if output.status.success() {
					success = true;
					break;
				}
			}
		}
		
		if !success {
			return Err("Failed to open file manager on Linux".to_string());
		}
	}
	
	Ok(())
}

#[tauri::command]
async fn delete_path(path: String) -> Result<(), String> {
	use std::fs;
	
	let path_obj = Path::new(&path);
	
	if !path_obj.exists() {
		return Err(format!("Path does not exist: {}", path));
	}
	
	println!("Deleting path: {}", path);
	
	if path_obj.is_dir() {
		// Delete directory and all contents recursively
		fs::remove_dir_all(&path)
			.map_err(|e| format!("Failed to delete directory '{}': {}", path, e))?;
		println!("Successfully deleted directory: {}", path);
	} else {
		// Delete file
		fs::remove_file(&path)
			.map_err(|e| format!("Failed to delete file '{}': {}", path, e))?;
		println!("Successfully deleted file: {}", path);
	}
	
	Ok(())
}

#[tauri::command]
async fn delete_path_with_os_session(path: String, os_session: OsSession) -> Result<(), String> {
	match os_session {
		OsSession::Local(_) => {
			delete_path_local(&path)
		}
		OsSession::Wsl(wsl_session) => {
			delete_path_wsl(&path, &wsl_session.distribution)
		}
	}
}

fn delete_path_local(path: &str) -> Result<(), String> {
	use std::fs;
	
	let path_obj = Path::new(path);
	
	if !path_obj.exists() {
		return Err(format!("Path does not exist: {}", path));
	}
	
	println!("Deleting local path: {}", path);
	
	if path_obj.is_dir() {
		// Delete directory and all contents recursively
		fs::remove_dir_all(&path)
			.map_err(|e| format!("Failed to delete directory '{}': {}", path, e))?;
		println!("Successfully deleted directory: {}", path);
	} else {
		// Delete file
		fs::remove_file(&path)
			.map_err(|e| format!("Failed to delete file '{}': {}", path, e))?;
		println!("Successfully deleted file: {}", path);
	}
	
	Ok(())
}

#[cfg(target_os = "windows")]
fn delete_path_wsl(path: &str, distribution: &str) -> Result<(), String> {
	println!("Deleting WSL path: {} using distribution: {}", path, distribution);
	
	// Use WSL rm command to delete the path
	let output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("rm")
		.arg("-rf")
		.arg(path)
		.output()
		.map_err(|e| format!("Failed to execute WSL rm command: {}", e))?;
	
	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		let stdout = String::from_utf8_lossy(&output.stdout);
		return Err(format!("WSL rm failed: stderr: {} stdout: {}", stderr, stdout));
	}
	
	println!("Successfully deleted WSL path: {}", path);
	Ok(())
}

#[cfg(not(target_os = "windows"))]
fn delete_path_wsl(_path: &str, _distribution: &str) -> Result<(), String> {
	Err("WSL is only available on Windows".to_string())
}

#[tauri::command]
async fn git_check_merge_conflicts(
	directory: String,
	source_branch: String,
	target_branch: String,
	os_session: OsSession
) -> Result<bool, String> {
	match os_session {
		OsSession::Local(_) => {
			git_check_merge_conflicts_local(&directory, &source_branch, &target_branch)
		}
		OsSession::Wsl(wsl_session) => {
			git_check_merge_conflicts_wsl(&directory, &source_branch, &target_branch, &wsl_session.distribution)
		}
	}
}

fn git_check_merge_conflicts_local(directory: &str, source_branch: &str, target_branch: &str) -> Result<bool, String> {
	// Use git merge-tree to check for conflicts without actually merging
	let merge_base_output = Command::new("git")
		.arg("merge-base")
		.arg(target_branch)
		.arg(source_branch)
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to find merge base: {}", e))?;
	
	if !merge_base_output.status.success() {
		return Err(format!("Git merge-base failed: {}", String::from_utf8_lossy(&merge_base_output.stderr)));
	}
	
	let merge_base = String::from_utf8_lossy(&merge_base_output.stdout).trim().to_string();
	
	// Check for conflicts using merge-tree
	let output = Command::new("git")
		.arg("merge-tree")
		.arg(&merge_base)
		.arg(target_branch)
		.arg(source_branch)
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to execute git merge-tree: {}", e))?;
	
	// If merge-tree output contains conflict markers, there are conflicts
	let merge_result = String::from_utf8_lossy(&output.stdout);
	let has_conflicts = merge_result.contains("<<<<<<<") || merge_result.contains(">>>>>>>");
	
	Ok(has_conflicts)
}

#[cfg(target_os = "windows")]
fn git_check_merge_conflicts_wsl(directory: &str, source_branch: &str, target_branch: &str, distribution: &str) -> Result<bool, String> {
	// Use git merge-tree to check for conflicts without actually merging
	let merge_base_output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("merge-base")
		.arg(target_branch)
		.arg(source_branch)
		.output()
		.map_err(|e| format!("Failed to find WSL merge base: {}", e))?;
	
	if !merge_base_output.status.success() {
		return Err(format!("WSL git merge-base failed: {}", String::from_utf8_lossy(&merge_base_output.stderr)));
	}
	
	let merge_base = String::from_utf8_lossy(&merge_base_output.stdout).trim().to_string();
	
	// Check for conflicts using merge-tree
	let output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("merge-tree")
		.arg(&merge_base)
		.arg(target_branch)
		.arg(source_branch)
		.output()
		.map_err(|e| format!("Failed to execute WSL git merge-tree: {}", e))?;
	
	// If merge-tree output contains conflict markers, there are conflicts
	let merge_result = String::from_utf8_lossy(&output.stdout);
	let has_conflicts = merge_result.contains("<<<<<<<") || merge_result.contains(">>>>>>>");
	
	Ok(has_conflicts)
}

#[cfg(not(target_os = "windows"))]
fn git_check_merge_conflicts_wsl(_directory: &str, _source_branch: &str, _target_branch: &str, _distribution: &str) -> Result<bool, String> {
	Err("WSL is only supported on Windows".to_string())
}

#[tauri::command]
async fn git_get_conflict_files(directory: String, os_session: OsSession) -> Result<Vec<String>, String> {
	match os_session {
		OsSession::Local(_) => {
			git_get_conflict_files_local(&directory)
		}
		OsSession::Wsl(wsl_session) => {
			git_get_conflict_files_wsl(&directory, &wsl_session.distribution)
		}
	}
}

fn git_get_conflict_files_local(directory: &str) -> Result<Vec<String>, String> {
	let output = Command::new("git")
		.arg("diff")
		.arg("--name-only")
		.arg("--diff-filter=U")
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to execute git diff: {}", e))?;
	
	if !output.status.success() {
		return Err(format!("Git diff failed: {}", String::from_utf8_lossy(&output.stderr)));
	}
	
	let files = String::from_utf8_lossy(&output.stdout)
		.lines()
		.filter(|line| !line.trim().is_empty())
		.map(|line| line.trim().to_string())
		.collect();
	
	Ok(files)
}

#[cfg(target_os = "windows")]
fn git_get_conflict_files_wsl(directory: &str, distribution: &str) -> Result<Vec<String>, String> {
	let output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("diff")
		.arg("--name-only")
		.arg("--diff-filter=U")
		.output()
		.map_err(|e| format!("Failed to execute WSL git diff: {}", e))?;
	
	if !output.status.success() {
		return Err(format!("WSL git diff failed: {}", String::from_utf8_lossy(&output.stderr)));
	}
	
	let files = String::from_utf8_lossy(&output.stdout)
		.lines()
		.filter(|line| !line.trim().is_empty())
		.map(|line| line.trim().to_string())
		.collect();
	
	Ok(files)
}

#[cfg(not(target_os = "windows"))]
fn git_get_conflict_files_wsl(_directory: &str, _distribution: &str) -> Result<Vec<String>, String> {
	Err("WSL is only supported on Windows".to_string())
}

#[tauri::command]
async fn git_merge_branch(
	directory: String,
	source_branch: String,
	target_branch: String,
	os_session: OsSession
) -> Result<String, String> {
	match os_session {
		OsSession::Local(_) => {
			git_merge_branch_local(&directory, &source_branch, &target_branch)
		}
		OsSession::Wsl(wsl_session) => {
			git_merge_branch_wsl(&directory, &source_branch, &target_branch, &wsl_session.distribution)
		}
	}
}

fn git_merge_branch_local(directory: &str, source_branch: &str, target_branch: &str) -> Result<String, String> {
	// First checkout target branch
	let checkout_output = Command::new("git")
		.arg("checkout")
		.arg(target_branch)
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to checkout target branch: {}", e))?;
	
	if !checkout_output.status.success() {
		return Err(format!("Git checkout failed: {}", String::from_utf8_lossy(&checkout_output.stderr)));
	}
	
	// Then merge source branch
	let merge_output = Command::new("git")
		.arg("merge")
		.arg(source_branch)
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to merge branch: {}", e))?;
	
	let stdout = String::from_utf8_lossy(&merge_output.stdout);
	let stderr = String::from_utf8_lossy(&merge_output.stderr);
	
	if !merge_output.status.success() {
		// Check if it's a conflict (which is expected sometimes)
		if stderr.contains("CONFLICT") || stdout.contains("CONFLICT") {
			return Ok("MERGE_CONFLICTS".to_string());
		}
		return Err(format!("Git merge failed: {}", stderr));
	}
	
	Ok("MERGE_SUCCESS".to_string())
}

#[cfg(target_os = "windows")]
fn git_merge_branch_wsl(directory: &str, source_branch: &str, target_branch: &str, distribution: &str) -> Result<String, String> {
	// First checkout target branch
	let checkout_output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("checkout")
		.arg(target_branch)
		.output()
		.map_err(|e| format!("Failed to checkout WSL target branch: {}", e))?;
	
	if !checkout_output.status.success() {
		return Err(format!("WSL git checkout failed: {}", String::from_utf8_lossy(&checkout_output.stderr)));
	}
	
	// Then merge source branch
	let merge_output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("merge")
		.arg(source_branch)
		.output()
		.map_err(|e| format!("Failed to merge WSL branch: {}", e))?;
	
	let stdout = String::from_utf8_lossy(&merge_output.stdout);
	let stderr = String::from_utf8_lossy(&merge_output.stderr);
	
	if !merge_output.status.success() {
		// Check if it's a conflict (which is expected sometimes)
		if stderr.contains("CONFLICT") || stdout.contains("CONFLICT") {
			return Ok("MERGE_CONFLICTS".to_string());
		}
		return Err(format!("WSL git merge failed: {}", stderr));
	}
	
	Ok("MERGE_SUCCESS".to_string())
}

#[cfg(not(target_os = "windows"))]
fn git_merge_branch_wsl(_directory: &str, _source_branch: &str, _target_branch: &str, _distribution: &str) -> Result<String, String> {
	Err("WSL is only supported on Windows".to_string())
}

#[tauri::command]
async fn git_get_current_branch(directory: String, os_session: OsSession) -> Result<String, String> {
	match os_session {
		OsSession::Local(_) => {
			git_get_current_branch_local(&directory)
		}
		OsSession::Wsl(wsl_session) => {
			git_get_current_branch_wsl(&directory, &wsl_session.distribution)
		}
	}
}

fn git_get_current_branch_local(directory: &str) -> Result<String, String> {
	let output = Command::new("git")
		.arg("branch")
		.arg("--show-current")
		.current_dir(directory)
		.output()
		.map_err(|e| format!("Failed to execute git branch command: {}", e))?;
	
	if !output.status.success() {
		// Try alternative method for older git versions
		let output2 = Command::new("git")
			.arg("rev-parse")
			.arg("--abbrev-ref")
			.arg("HEAD")
			.current_dir(directory)
			.output()
			.map_err(|e| format!("Failed to execute git rev-parse command: {}", e))?;
		
		if !output2.status.success() {
			return Err(format!("Git branch detection failed: {}", String::from_utf8_lossy(&output2.stderr)));
		}
		
		Ok(String::from_utf8_lossy(&output2.stdout).trim().to_string())
	} else {
		Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
	}
}

#[cfg(target_os = "windows")]
fn git_get_current_branch_wsl(directory: &str, distribution: &str) -> Result<String, String> {
	let output = Command::new("wsl")
		.arg("-d")
		.arg(distribution)
		.arg("--cd")
		.arg(directory)
		.arg("git")
		.arg("branch")
		.arg("--show-current")
		.output()
		.map_err(|e| format!("Failed to execute WSL git branch command: {}", e))?;
	
	if !output.status.success() {
		// Try alternative method for older git versions
		let output2 = Command::new("wsl")
			.arg("-d")
			.arg(distribution)
			.arg("--cd")
			.arg(directory)
			.arg("git")
			.arg("rev-parse")
			.arg("--abbrev-ref")
			.arg("HEAD")
			.output()
			.map_err(|e| format!("Failed to execute WSL git rev-parse command: {}", e))?;
		
		if !output2.status.success() {
			return Err(format!("WSL git branch detection failed: {}", String::from_utf8_lossy(&output2.stderr)));
		}
		
		Ok(String::from_utf8_lossy(&output2.stdout).trim().to_string())
	} else {
		Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
	}
}

#[cfg(not(target_os = "windows"))]
fn git_get_current_branch_wsl(_directory: &str, _distribution: &str) -> Result<String, String> {
	Err("WSL is only supported on Windows".to_string())
}
