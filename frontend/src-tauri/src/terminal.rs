use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::{anyhow, Result};
use portable_pty::{Child, CommandBuilder, PtyPair, PtySize};
use tauri::AppHandle;
use tauri::Emitter;
use uuid::Uuid;


pub struct TerminalConnection {
	pub id: String,
	pub pty_pair: PtyPair,
	pub child: Box<dyn Child + Send + Sync>,
	pub app_handle: AppHandle,
}

impl TerminalConnection {
	pub fn new(id: String, working_directory: &str, app_handle: AppHandle) -> Result<Self> {
		let pty_system = portable_pty::native_pty_system();

		let pty_pair = pty_system.openpty(PtySize {
			rows: 24,
			cols: 60,
			pixel_width: 0,
			pixel_height: 0,
		})?;

		let cmd = build_command(working_directory, true)?;
		let child = pty_pair.slave.spawn_command(cmd)?;

		Ok(Self {
			id,
			pty_pair,
			child,
			app_handle,
		})
	}

	pub fn is_alive(&mut self) -> bool {
		match self.child.try_wait() {
			Ok(Some(_)) => false, // Process has exited
			Ok(None) => true,     // Process is still running
			Err(_) => false,      // Error checking status, assume dead
		}
	}

	pub fn start_io_loop(&self) -> Result<()> {
		let mut reader = self.pty_pair.master.try_clone_reader()?;
		let app_handle = self.app_handle.clone();
		let connection_id = self.id.clone();

		// Spawn thread to read from PTY and send to frontend
		thread::spawn(move || {
			let mut buffer = [0u8; 1024];
			loop {
				match reader.read(&mut buffer) {
					Ok(0) => break, // EOF
					Ok(n) => {
						let data = String::from_utf8_lossy(&buffer[..n]).to_string();
						if let Err(e) = app_handle
							.emit(&format!("terminal-data-{}", connection_id), &data)
						{
							eprintln!("Failed to emit terminal data: {}", e);
							break;
						}
					}
					Err(e) => {
						eprintln!("Error reading from PTY: {}", e);
						break;
					}
				}
			}

			// Emit disconnect event
			let _ =
				app_handle.emit(&format!("terminal-disconnect-{}", connection_id), ());
		});

		Ok(())
	}

	pub fn resize(&mut self, cols: u16, rows: u16) -> Result<()> {
		self.pty_pair.master.resize(PtySize {
			rows,
			cols,
			pixel_width: 0,
			pixel_height: 0,
		})?;
		Ok(())
	}
}

pub struct TerminalManager {
	connections: Arc<Mutex<HashMap<String, TerminalConnection>>>,
	writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
}

const MAX_CONNECTIONS: usize = 100;

impl TerminalManager {
	pub fn new() -> Self {
		Self {
			connections: Arc::new(Mutex::new(HashMap::new())),
			writers: Arc::new(Mutex::new(HashMap::new())),
		}
	}

	pub fn create_connection(
		&self,
		working_directory: &str,
		app_handle: AppHandle,
	) -> Result<String> {
		// Check connection limit first
		{
			let connections = self.connections.lock().unwrap();
			if connections.len() >= MAX_CONNECTIONS {
				return Err(anyhow!("Maximum number of terminal connections ({}) reached. Please close some terminals before creating new ones.", MAX_CONNECTIONS));
			}
		}

		let connection_id = Uuid::new_v4().to_string();
		let connection =
			TerminalConnection::new(connection_id.clone(), working_directory, app_handle)?;

		// Get the writer before starting the IO loop
		let writer = connection.pty_pair.master.take_writer()?;

		connection.start_io_loop()?;

		let mut connections = self.connections.lock().unwrap();
		let mut writers = self.writers.lock().unwrap();

		connections.insert(connection_id.clone(), connection);
		writers.insert(connection_id.clone(), writer);

		Ok(connection_id)
	}

	pub fn send_data(&self, connection_id: &str, data: &str) -> Result<()> {
		println!("Backend sending data: {:?}", data);
		let mut writers = self.writers.lock().unwrap();
		if let Some(writer) = writers.get_mut(connection_id) {
			writer.write_all(data.as_bytes())?;
			writer.flush()?;
		} else {
			return Err(anyhow!("Connection not found: {}", connection_id));
		}
		Ok(())
	}

	pub fn resize_terminal(
		&self,
		connection_id: &str,
		cols: u16,
		rows: u16,
	) -> Result<()> {
		let mut connections = self.connections.lock().unwrap();
		if let Some(connection) = connections.get_mut(connection_id) {
			connection.resize(cols, rows)?;
		} else {
			return Err(anyhow!("Connection not found: {}", connection_id));
		}
		Ok(())
	}

	pub fn close_connection(&self, connection_id: &str) -> Result<()> {
		println!("Closing connection: {}", connection_id);
		let mut connections = self.connections.lock().unwrap();
		let mut writers = self.writers.lock().unwrap();

		// Remove and properly cleanup the writer first
		if let Some(mut writer) = writers.remove(connection_id) {
			let _ = writer.flush();
			drop(writer);
		}

		if let Some(mut connection) = connections.remove(connection_id) {
			// Forcefully kill the child process
			if let Err(e) = connection.child.kill() {
				eprintln!("Failed to kill child process: {}", e);
			}

			// Wait for the child to actually terminate
			let _ = connection.child.wait();

			// Explicitly drop the PTY pair to release file descriptors
			drop(connection.pty_pair);
		}

		Ok(())
	}

	pub fn cleanup_dead_connections(&self) -> Result<()> {
		let mut connections = self.connections.lock().unwrap();
		let mut writers = self.writers.lock().unwrap();
		let mut dead_connections = Vec::new();

		// Find dead connections
		for (id, connection) in connections.iter_mut() {
			if !connection.is_alive() {
				dead_connections.push(id.clone());
			}
		}

		// Remove dead connections
		for id in dead_connections {
			println!("Cleaning up dead terminal connection: {}", id);

			// Cleanup writer
			if let Some(mut writer) = writers.remove(&id) {
				let _ = writer.flush();
				drop(writer);
			}

			// Cleanup connection
			if let Some(connection) = connections.remove(&id) {
				drop(connection.pty_pair);
			}
		}

		Ok(())
	}
}


pub fn build_command(working_directory: &str, xterm: bool) -> Result<CommandBuilder> {
	let mut cmd = {
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