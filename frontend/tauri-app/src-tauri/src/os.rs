use anyhow::{anyhow, Result};
use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use uuid::Uuid;
use walkdir::{DirEntry, WalkDir};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OsSessionKind {
	Local,
	Wsl(String), // WSL distribution name
}

impl OsSessionKind {
	pub fn list_available() -> Result<Vec<Self>> {
		let mut result = Vec::new();

		#[cfg(target_os = "windows")]
		{
			use std::process::Command;

			// Get WSL distributions
			use std::os::windows::process::CommandExt;
			let output = Command::new("wsl")
				.arg("--list")
				.arg("--quiet")
				.creation_flags(0x08000000) // CREATE_NO_WINDOW
				.output()?;

			if output.status.success() {
				let distributions = String::from_utf8_lossy(&output.stdout);
				for line in distributions.lines() {
					let cleaned = line
						.chars()
						.filter(|c| c.is_alphanumeric() || *c == ' ')
						.collect::<String>()
						.trim()
						.to_string();
					if !cleaned.is_empty() {
						result.push(Self::Wsl(cleaned));
					}
				}
			}
		}

		result.push(Self::Local); // Add local session
		Ok(result)
	}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OsSession {
	Local(String),
	Wsl(WslSession),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WslSession {
	pub distribution: String,
	pub working_directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
	pub name: String,
	pub path: String,
	pub is_directory: bool,
	pub children: Option<Vec<FileNode>>,
	pub extension: Option<String>,
}

fn is_hidden(entry: &DirEntry) -> bool {
	entry
		.file_name()
		.to_str()
		.map(|s| s.starts_with('.'))
		.unwrap_or(false)
}

fn is_hidden_name(name: &str) -> bool {
	name.starts_with('.')
}

impl OsSession {
	pub fn get_working_directory(&self) -> &str {
		match self {
			Self::Local(dir) => dir,
			Self::Wsl(session) => &session.working_directory,
		}
	}

	pub async fn read_directory(&self, path: &str) -> Result<Vec<FileNode>> {
		match self {
			Self::Local(_) => self.read_directory_local(path).await,
			Self::Wsl(session) => {
				self.read_directory_wsl(path, &session.distribution).await
			}
		}
	}

	async fn read_directory_local(&self, path: &str) -> Result<Vec<FileNode>> {
		let path = Path::new(path);
		let mut nodes = Vec::new();

		for entry in WalkDir::new(path)
			.min_depth(1)
			.max_depth(1)
			.into_iter()
			.filter_entry(|e| !is_hidden(e))
			.filter_map(|e| e.ok())
		{
			let metadata = entry.metadata()?;
			let file_name = entry.file_name().to_string_lossy().to_string();
			let file_path = entry.path();
			let path_str = file_path.to_string_lossy().to_string();

			let extension = if metadata.is_file() {
				file_path
					.extension()
					.and_then(|ext| ext.to_str())
					.map(|s| s.to_string())
			} else {
				None
			};

			let node = FileNode {
				name: file_name,
				path: path_str,
				is_directory: metadata.is_dir(),
				children: None,
				extension,
			};

			nodes.push(node);
		}

		nodes.sort_by(|a, b| match (a.is_directory, b.is_directory) {
			(true, false) => std::cmp::Ordering::Less,
			(false, true) => std::cmp::Ordering::Greater,
			_ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
		});

		Ok(nodes)
	}

	fn convert_path_to_wsl(path: &str) -> String {
		// If path already starts with / or ~, it's already a Unix-style path
		if path.starts_with('/') || path.starts_with('~') {
			return path.to_string();
		}

		// Check for Windows drive letters (C: through K:, both uppercase and lowercase)
		if path.len() >= 2 && path.chars().nth(1) == Some(':') {
			let drive_char = path.chars().nth(0).unwrap().to_ascii_lowercase();
			if matches!(drive_char, 'c'..='k') {
				let rest_of_path = &path[2..];
				let unix_path = rest_of_path.replace('\\', "/");
				return format!("/mnt/{}{}", drive_char, unix_path);
			}
		}

		// If it doesn't match any pattern, return as-is
		path.to_string()
	}

	#[cfg(target_os = "windows")]
	async fn read_directory_wsl(
		&self,
		path: &str,
		distribution: &str,
	) -> Result<Vec<FileNode>> {
		let wsl_path = Self::convert_path_to_wsl(path);

		// Use WSL to execute ls command and parse the output
		use std::os::windows::process::CommandExt;
		let output = Command::new("wsl")
			.arg("-d")
			.arg(distribution)
			.arg("ls")
			.arg("-la")
			.arg("--color=never")
			.arg(&wsl_path)
			.creation_flags(0x08000000) // CREATE_NO_WINDOW
			.output()?;

		if !output.status.success() {
			let error_msg = String::from_utf8_lossy(&output.stderr);
			return Err(anyhow!("WSL ls command failed: {}", error_msg));
		}

		let output_str = String::from_utf8_lossy(&output.stdout);
		let mut nodes = Vec::new();

		for line in output_str.lines().skip(1) {
			// Skip the "total" line
			if line.trim().is_empty() {
				continue;
			}

			let parts: Vec<&str> = line.split_whitespace().collect();
			if parts.len() < 9 {
				continue; // Skip malformed lines
			}

			let permissions = parts[0];
			let file_name = parts[8..].join(" "); // Handle filenames with spaces

			// Skip . and .. entries, and hidden files
			if file_name == "." || file_name == ".." || is_hidden_name(&file_name) {
				continue;
			}

			let is_directory = permissions.starts_with('d');
			let is_symlink = permissions.starts_with('l');

			// For symlinks, we might want to resolve them or handle them specially
			let actual_name = if is_symlink && file_name.contains(" -> ") {
				file_name
					.split(" -> ")
					.next()
					.unwrap_or(&file_name)
					.to_string()
			} else {
				file_name.clone()
			};

			// Construct full path (WSL style)
			let full_path = if wsl_path.ends_with('/') {
				format!("{}{}", wsl_path, actual_name)
			} else {
				format!("{}/{}", wsl_path, actual_name)
			};

			let extension = if !is_directory {
				Path::new(&actual_name)
					.extension()
					.and_then(|ext| ext.to_str())
					.map(|s| s.to_string())
			} else {
				None
			};

			let node = FileNode {
				name: actual_name,
				path: full_path,
				is_directory,
				children: None,
				extension,
			};

			nodes.push(node);
		}

		// Sort: directories first, then by name
		nodes.sort_by(|a, b| match (a.is_directory, b.is_directory) {
			(true, false) => std::cmp::Ordering::Less,
			(false, true) => std::cmp::Ordering::Greater,
			_ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
		});

		Ok(nodes)
	}

	#[cfg(not(target_os = "windows"))]
	async fn read_directory_wsl(
		&self,
		_path: &str,
		_distribution: &str,
	) -> Result<Vec<FileNode>> {
		Err(anyhow!("WSL is only available on Windows"))
	}

	pub fn build_command(&self, xterm: bool) -> Result<CommandBuilder> {
		let mut cmd = match self {
			Self::Wsl(WslSession {
				working_directory,
				distribution,
			}) => {
				#[cfg(target_os = "windows")]
				{
					let mut cmd = CommandBuilder::new("wsl");

					cmd.arg("-d");
					cmd.arg(distribution);
					cmd.arg("--cd");
					cmd.arg(working_directory);

					cmd
				}
				#[cfg(not(target_os = "windows"))]
				{
					return Err(anyhow::anyhow!("WSL is only available on Windows"));
				}
			}
			Self::Local(working_directory) => {
				#[cfg(any(target_os = "macos", target_os = "linux"))]
				{
					// Try to get default shell from environment
					let shell_path = std::env::var("SHELL").unwrap_or_else(|_| {
						// Fallback priority: zsh (macOS default) -> bash -> sh
						if std::path::Path::new("/bin/zsh").exists() {
							"/bin/zsh".to_string()
						} else if std::path::Path::new("/bin/bash").exists() {
							"/bin/bash".to_string()
						} else {
							"/bin/sh".to_string()
						}
					});

					let mut cmd = CommandBuilder::new(shell_path);
					cmd.arg("-l"); // Login shell

					cmd.cwd(working_directory);

					cmd
				}
				#[cfg(target_os = "windows")]
				{
					// Use git bash if available
					let git_bash_paths = [
						"C:\\Program Files\\Git\\bin\\bash.exe",
						"C:\\Program Files (x86)\\Git\\bin\\bash.exe",
						"C:\\Git\\bin\\bash.exe",
					];

					let git_bash_available = git_bash_paths
						.iter()
						.any(|path| std::path::Path::new(path).exists());

					if git_bash_available {
						// Use Git Bash
						let mut cmd =
							CommandBuilder::new("C:\\Program Files\\Git\\bin\\bash.exe");
						cmd.arg("--login"); // Force login shell
						cmd.arg("-i"); // Force interactive mode

						cmd.cwd(working_directory);

						cmd
					} else {
						// Fallback to PowerShell
						let mut cmd = CommandBuilder::new("powershell.exe");
						cmd.arg("-NoExit"); // Keep the window open
						cmd.cwd(working_directory);
						cmd
					}
				}
			}
		};

		// environment variables for image support
		if xterm {
			cmd.env("TERM", "xterm-256color");
			cmd.env("COLORTERM", "truecolor");
			cmd.env("TERM_PROGRAM", "iTerm.app"); // Identify as iTerm2 for IIP support
			cmd.env("TERM_PROGRAM_VERSION", "3.0.0");
		}

		Ok(cmd)
	}
}

// Git search functionality
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSearchResult {
	pub directories: Vec<String>,
	pub is_complete: bool,
}

pub struct GitSearchManager {
	searches: Arc<Mutex<HashMap<String, GitSearchResult>>>,
}

impl GitSearchManager {
	pub fn new() -> Self {
		Self {
			searches: Arc::new(Mutex::new(HashMap::new())),
		}
	}

	pub fn start_search(&self, os_session_kind: OsSessionKind) -> String {
		let search_id = Uuid::new_v4().to_string();

		// Initialize empty result
		{
			let mut searches = self.searches.lock().unwrap();
			searches.insert(
				search_id.clone(),
				GitSearchResult {
					directories: Vec::new(),
					is_complete: false,
				},
			);
		}

		// Start background search
		let searches_clone = Arc::clone(&self.searches);
		let search_id_clone = search_id.clone();

		thread::spawn(move || {
			let root_dirs = Self::get_root_directories(&os_session_kind);
			let mut found_dirs = Vec::new();

			for root_dir in root_dirs {
				// Check if search was cancelled before processing each root
				{
					let searches = searches_clone.lock().unwrap();
					if !searches.contains_key(&search_id_clone) {
						return; // Search was cancelled, exit thread
					}
				}
				
				Self::search_git_directories(
					&root_dir,
					&mut found_dirs,
					&searches_clone,
					&search_id_clone,
					&os_session_kind,
				);
			}

			// Mark search as complete only if it wasn't cancelled
			let mut searches = searches_clone.lock().unwrap();
			if let Some(result) = searches.get_mut(&search_id_clone) {
				result.is_complete = true;
			}
		});

		search_id
	}

	pub fn get_results(&self, search_id: &str) -> Option<GitSearchResult> {
		let searches = self.searches.lock().unwrap();
		searches.get(search_id).cloned()
	}

	pub fn cancel_search(&self, search_id: &str) {
		let mut searches = self.searches.lock().unwrap();
		searches.remove(search_id);
	}

	fn get_root_directories(os_session_kind: &OsSessionKind) -> Vec<String> {
		let roots = match os_session_kind {
			OsSessionKind::Local => {
				#[cfg(target_os = "windows")]
				{
					// On Windows, search specific user directories only
					let mut roots = Vec::new();
					if let Ok(user_profile) = std::env::var("USERPROFILE") {
						// Search only in specific folders to avoid system directories
						let user_dirs = ["Documents", "Desktop", "Downloads", "Projects", "Source", "Code"];
						for dir in user_dirs {
							let path = format!("{}\\{}", user_profile, dir);
							if Path::new(&path).exists() {
								roots.push(path);
							}
						}
					}
					roots
				}
				#[cfg(target_os = "linux")]
				{
					// Linux: search specific user directories only
					let mut roots = Vec::new();
					if let Ok(home_dir) = std::env::var("HOME") {
						// Search only in specific folders to avoid system directories
						let user_dirs = ["Documents", "Desktop", "Downloads", "Projects", "Source", "Code", "git", "repos"];
						for dir in user_dirs {
							let path = format!("{}/{}", home_dir, dir);
							if Path::new(&path).exists() {
								roots.push(path);
							}
						}
						// Also search home directory root for projects
						roots.push(home_dir);
					}
					roots
				}
				#[cfg(target_os = "macos")]
				{
					// macOS: search user-specific directories to avoid permission prompts
					let mut roots = Vec::new();
					if let Ok(home_dir) = std::env::var("HOME") {
						// Search only in specific folders
						let user_dirs = ["Documents", "Desktop", "Downloads", "Projects", "Source", "Code"];
						for dir in user_dirs {
							let path = format!("{}/{}", home_dir, dir);
							if Path::new(&path).exists() {
								roots.push(path);
							}
						}
						// Also search home directory root for projects
						roots.push(home_dir);
					}
					roots
				}
			}
			OsSessionKind::Wsl(distribution) => {
				// WSL: search actual user directories
				let mut roots = Vec::new();
				
				// First, add the root directories themselves
				roots.push("/home".to_string());
				roots.push("/root".to_string());
				
				// Find actual users in /home and search their subdirectories
				if let Ok(entries) = std::fs::read_dir("/home") {
					for entry in entries.flatten() {
						if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
							let user_home = entry.path().to_string_lossy().to_string();
							
							// Add the user home directory itself
							roots.push(user_home.clone());
							
							// Add common project subdirectories
							let user_dirs = ["Documents", "Desktop", "Downloads", "Projects", "Source", "Code", "git", "repos"];
							for dir in user_dirs {
								let path = format!("{}/{}", user_home, dir);
								roots.push(path);
							}
						}
					}
				}
				
				// Note: Removed Windows mount search to avoid duplicate results when both Local and WSL are available
				
				roots
			}
		};
		
		roots
	}

	fn search_git_directories(
		root_path: &str,
		found_dirs: &mut Vec<String>,
		searches: &Arc<Mutex<HashMap<String, GitSearchResult>>>,
		search_id: &str,
		os_session_kind: &OsSessionKind,
	) {
		// Check if this is a WSL path (starts with /mnt/ or /home)
		if root_path.starts_with("/mnt/") || (root_path.starts_with("/home") && cfg!(target_os = "windows")) {
			Self::search_git_directories_wsl(
				root_path,
				found_dirs,
				searches,
				search_id,
				os_session_kind,
			);
		} else {
			Self::search_git_directories_local(
				root_path, found_dirs, searches, search_id,
			);
		}
	}

	fn search_git_directories_local(
		root_path: &str,
		found_dirs: &mut Vec<String>,
		searches: &Arc<Mutex<HashMap<String, GitSearchResult>>>,
		search_id: &str,
	) {
		let walker = WalkDir::new(root_path)
			.follow_links(false)
			.max_depth(4) // Limit search depth to 4 levels
			.into_iter()
			.filter_entry(|e| {
				// Skip hidden directories except .git, and skip common non-project directories
				if let Some(name) = e.file_name().to_str() {
					if name.starts_with('.') && name != ".git" {
						return false;
					}
					// Skip common non-project directories that slow down search
					if matches!(name, "node_modules" | "target" | "dist" | "build" | "out" | "bin" | "obj" | ".next" | ".nuxt" | "__pycache__" | ".vscode" | ".idea" | "Trash" | "Library" | "Applications" | "System" | "Windows" | "Program Files" | "Program Files (x86)") {
						return false;
					}
				}
				true
			});

		for entry in walker {
			if let Ok(entry) = entry {
				if entry.file_type().is_dir() {
					if let Some(dir_name) = entry.file_name().to_str() {
						if dir_name == ".git" {
							// Found a git directory, add its parent
							if let Some(parent) = entry.path().parent() {
								let git_repo_path =
									parent.to_string_lossy().replace('\\', "/");
								found_dirs.push(git_repo_path.clone());

								// Update the search results (only if search wasn't cancelled)
								let mut searches_lock = searches.lock().unwrap();
								if let Some(result) = searches_lock.get_mut(search_id) {
									result.directories.push(git_repo_path);
								} else {
									// Search was cancelled, stop searching
									return;
								}
							}
						}
					}
				}
			}
		}
	}

	#[cfg(target_os = "windows")]
	fn search_git_directories_wsl(
		root_path: &str,
		found_dirs: &mut Vec<String>,
		searches: &Arc<Mutex<HashMap<String, GitSearchResult>>>,
		search_id: &str,
		os_session_kind: &OsSessionKind,
	) {
		// Extract WSL distribution from OsSessionKind
		let distribution = match os_session_kind {
			OsSessionKind::Wsl(dist_name) => dist_name.clone(),
			_ => {
				// Try to get first available WSL distribution
				if let Ok(available) = OsSessionKind::list_available() {
					for session in available {
						if let OsSessionKind::Wsl(dist_name) = session {
							return Self::search_git_directories_wsl(
								root_path,
								found_dirs,
								searches,
								search_id,
								&OsSessionKind::Wsl(dist_name),
							);
						}
					}
				}
				return; // No WSL distribution available
			}
		};

		// Use WSL find command to search for .git directories
		// Limit depth to 4 levels and exclude common non-project directories
		let find_command = format!(
			"find '{}' -maxdepth 4 -name '.git' -type d -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.next/*' -not -path '*/__pycache__/*' 2>/dev/null",
			root_path.replace("'", "'\"'\"'")
		);

		use std::os::windows::process::CommandExt;
		let output = Command::new("wsl")
			.arg("-d")
			.arg(&distribution)
			.arg("bash")
			.arg("-c")
			.arg(&find_command)
			.creation_flags(0x08000000) // CREATE_NO_WINDOW
			.output();

		match output {
			Ok(output) => {
				if output.status.success() {
					let output_str = String::from_utf8_lossy(&output.stdout);
					let lines: Vec<&str> = output_str.lines().collect();

					for line in lines {
						let git_path = line.trim();
						if !git_path.is_empty() && git_path.ends_with("/.git") {
							// Get the parent directory (remove /.git)
							let repo_path = &git_path[..git_path.len() - 5];
							let normalized_path = repo_path.replace('\\', "/");

							found_dirs.push(normalized_path.clone());

							// Update the search results (only if search wasn't cancelled)
							let mut searches_lock = searches.lock().unwrap();
							if let Some(result) = searches_lock.get_mut(search_id) {
								result.directories.push(normalized_path);
							} else {
								// Search was cancelled, stop processing
								return;
							}
						}
					}
				}
			}
			Err(_) => {
				// Silently handle command execution errors
			}
		}
	}

	#[cfg(not(target_os = "windows"))]
	fn search_git_directories_wsl(
		_root_path: &str,
		_found_dirs: &mut Vec<String>,
		_searches: &Arc<Mutex<HashMap<String, GitSearchResult>>>,
		_search_id: &str,
		_os_session_kind: &OsSessionKind,
	) {
		// WSL search is only available on Windows
	}
}
