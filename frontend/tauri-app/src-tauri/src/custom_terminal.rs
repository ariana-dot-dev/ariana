//! src/custom_terminal.rs
//!
//! Public API identical to the previous version, but the internal
//! ANSI/VT processing now relies on the vt100 crate (much more
//! accurate and far smaller).

use std::{
	collections::HashMap,
	io::{Read, Write},
	sync::{mpsc, Arc, Mutex},
	thread,
};

use anyhow::{anyhow, Result};
use portable_pty::{native_pty_system, PtyPair, PtySize};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Emitter;
use unicode_width::UnicodeWidthStr;
use uuid::Uuid;
use vt100::{Cell, Color as VtColor, Parser};

use crate::os::OsSession;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Color {
	Default,
	Black,
	Red,
	Green,
	Yellow,
	Blue,
	Magenta,
	Cyan,
	White,
	BrightBlack,
	BrightRed,
	BrightGreen,
	BrightYellow,
	BrightBlue,
	BrightMagenta,
	BrightCyan,
	BrightWhite,
	Extended(u8),
	Rgb(u8, u8, u8),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LineItem {
	pub lexeme: String,
	pub width: u16,
	pub is_underline: bool,
	pub is_bold: bool,
	pub is_italic: bool,
	pub background_color: Option<Color>,
	pub foreground_color: Option<Color>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventMetadata {
	#[serde(rename = "sessionId")]
	pub session_id: Option<String>,
	#[serde(flatten)]
	pub extra: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TerminalEvent {
	#[serde(rename = "newLines")]
	NewLines {
		lines: Vec<Vec<LineItem>>,
		metadata: Option<EventMetadata>,
	},
	#[serde(rename = "patch")]
	Patch {
		line: usize,
		items: Vec<LineItem>,
		metadata: Option<EventMetadata>,
	},
	#[serde(rename = "cursorMove")]
	CursorMove {
		line: usize,
		col: usize,
		metadata: Option<EventMetadata>,
	},
	#[serde(rename = "scroll")]
	Scroll {
		direction: ScrollDirection,
		amount: usize,
		metadata: Option<EventMetadata>,
	},
	#[serde(rename = "screenUpdate")]
	ScreenUpdate {
		screen: Vec<Vec<LineItem>>,
		cursor_line: usize,
		cursor_col: usize,
		metadata: Option<EventMetadata>,
	},
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScrollDirection {
	Up,
	Down,
}

/// How many scroll-back lines to keep.
const HISTORY_LINES: usize = 100_000;

pub struct TerminalState {
	parser: Parser,
	rows: u16,
	cols: u16,
	max_rows_ever: u16,
	scrollback: usize,
	rows_state: Vec<(String, Vec<LineItem>)>,
}

impl TerminalState {
	pub fn new(rows: u16, cols: u16) -> Self {
		Self {
			parser: Parser::new(rows.into(), cols.into(), HISTORY_LINES),
			rows,
			cols,
			max_rows_ever: cols,
			scrollback: 0,
			rows_state: Vec::new(),
		}
	}

	pub fn resize(&mut self, rows: u16, cols: u16) {
		self.parser.set_size(rows.into(), cols.into());
		self.rows = rows;
		self.cols = cols;
		self.max_rows_ever = self.max_rows_ever.max(rows);
	}

	/// Feed raw bytes coming from the PTY, return events we must emit.
	pub fn process_input(&mut self, data: &[u8]) -> Vec<TerminalEvent> {
		if data.is_empty() {
			return vec![];
		}

		let valid_up_to = match std::str::from_utf8(data) {
			Ok(_) => data.len(),
			Err(e) => e.valid_up_to(),
		};
		let (valid, _) = data.split_at(valid_up_to);
		if !valid.is_empty() {
			self.parser.process(valid);
		}

		// TEMPORARY MAC FIX: Force full screen updates instead of incremental
		// This ensures screen content events are generated for pattern detection
		self.build_screen_events(true)
	}

	/// Used by the scroll wheel handlers.  We simply re-emit the current
	/// screen because vt100 automatically keeps HISTORY_LINES.
	pub fn screen_events(&mut self, full: bool) -> Vec<TerminalEvent> {
		self.build_screen_events(full)
	}

	fn build_screen_events(&mut self, full: bool) -> Vec<TerminalEvent> {
		let screen = self.parser.screen();

		// cursor
		let (cursor_line, cursor_col) = screen.cursor_position().into();
		let mut changed_lines = vec![];
		let mut added_lines = vec![];

		// rows & cols are known so we can iterate directly
		let mut current_screen = Vec::with_capacity(self.rows as usize);
		for r in 0..self.rows {
			let mut row_vec = Vec::with_capacity(self.cols as usize);
			let mut visual_col: u16 = 0;
			for c in 0..self.cols {
				let item = cell_to_item(screen.cell(r, c).cloned(), visual_col);
				visual_col += item.width;
				row_vec.push(item);
			}
			let mut cumulated_text = String::new();
			for item in &row_vec {
				cumulated_text.push_str(&item.lexeme);
			}
			current_screen.push((cumulated_text, row_vec));
		}

		if self.rows_state.len() == 0 {
			self.rows_state = current_screen.clone();
		} else {
			// -----------------------------------------------------------------
			// Estimate how many new lines have been appended by trying each
			// possible "shift" value and keeping the one with the best score.
			// Earlier (top) lines receive a larger weight because ncurses-like
			// programs usually paint the screen top-to-bottom.
			// -----------------------------------------------------------------
			let mut best_shift: isize = -1;
			let mut best_shift_score: isize = -1; // maximise

			let total_rows = self.rows as isize;

			for shift in 0..self.rows_state.len().min(self.max_rows_ever as usize) {
				let mut score: isize = 0;
				for (i, (content, _)) in current_screen.iter().enumerate() {
					// Weight: rows - index  (line 0 => high weight)
					let weight = (total_rows - i as isize).max(1);

					let row_in_rows_state = self.rows_state.len() + i - (shift + 1);
					let line_score = if row_in_rows_state < self.rows_state.len() {
						let (existing_content, _) = &self.rows_state[row_in_rows_state];
						let sim = similarities_count(existing_content, content) as isize;
						let diff_penalty = (self.cols as isize
							- content.len().max(existing_content.len()) as isize)
							.max(0);
						sim + diff_penalty
					} else {
						// Treat totally new row as perfect match (will favour smaller shifts)
						self.cols as isize
					};

					score += weight * line_score;
				}

				if score > best_shift_score {
					best_shift = shift as isize;
					best_shift_score = score;
				}
			}

			// println!(
			//     "Current rows: {:#?}",
			//     self.rows_state
			//         .iter()
			//         .map(|(content, _)| content)
			//         .collect::<Vec<_>>()
			// );
			// println!(
			//     "Current screen: {:#?}",
			//     current_screen
			//         .iter()
			//         .map(|(content, _)| content)
			//         .collect::<Vec<_>>()
			// );
			// println!("Best shift: {}", best_shift);
			// println!("Best shift score: {}", best_shift_score);

			for (i, row) in current_screen.iter().enumerate() {
				let row_in_rows_state =
					self.rows_state.len() as isize + i as isize - (best_shift + 1);
				if row_in_rows_state < self.rows_state.len() as isize
					&& row_in_rows_state >= 0
				{
					let old_line = self.rows_state[row_in_rows_state as usize].clone();
					let new_line = row.clone();
					if find_one_diff_items_deep(&old_line.1, &new_line.1) {
						changed_lines.push((row_in_rows_state as usize, new_line));
						self.rows_state[row_in_rows_state as usize] = row.clone();
					}
				} else if row_in_rows_state >= 0 {
					added_lines.push(row.clone());
					self.rows_state.push(row.clone());
				}
			}
		}

		// let result = current_screen.into_iter().map(|(_, row)| row).collect();

		// get last self.rows rows from self.rows_state
		let mut events = vec![];

		let cursor_line =
			(self.rows_state.len() - self.rows as usize) + cursor_line as usize;
		let cursor_col = cursor_col as usize;

		if full {
			events.push(TerminalEvent::ScreenUpdate {
				screen: self.rows_state.iter().map(|(_, row)| row.clone()).collect(),
				cursor_line,
				cursor_col,
				metadata: None,
			});
		} else {
			events.push(TerminalEvent::CursorMove {
				line: cursor_line,
				col: cursor_col,
				metadata: None,
			});
			for (line, items) in changed_lines {
				events.push(TerminalEvent::Patch {
					line,
					items: items.1,
					metadata: None,
				});
			}
			if added_lines.len() > 0 {
				events.push(TerminalEvent::NewLines {
					lines: added_lines.into_iter().map(|(_, row)| row).collect(),
					metadata: None,
				});
			}
		}

		events
	}
}

fn find_one_diff_items_deep(old_line: &Vec<LineItem>, new_line: &Vec<LineItem>) -> bool {
	old_line
		.iter()
		.zip(new_line.iter())
		.any(|(old_item, new_item)| !items_equal(old_item, new_item))
}

fn items_equal(old_item: &LineItem, new_item: &LineItem) -> bool {
	old_item.lexeme == new_item.lexeme
		&& old_item.is_bold == new_item.is_bold
		&& old_item.is_italic == new_item.is_italic
		&& old_item.is_underline == new_item.is_underline
		&& old_item.foreground_color == new_item.foreground_color
		&& old_item.background_color == new_item.background_color
}

fn similarities_count(s1: &str, s2: &str) -> usize {
	s1.chars()
		.zip(s2.chars())
		.map(|(c1, c2)| {
			if c1 == c2 {
				2
			} else if (c1.is_whitespace() && !c2.is_whitespace())
				|| (!c1.is_whitespace() && c2.is_whitespace())
			{
				1
			} else {
				0
			}
		})
		.sum()
}

const TAB_WIDTH: usize = 4; // was 8 in the legacy code – pick whichever

fn cell_to_item(opt: Option<Cell>, col: u16) -> LineItem {
	let (mut txt, bold, italic, underline, fg, bg) = if let Some(c) = opt {
		(
			c.contents().to_string(),
			c.bold(),
			c.italic(),
			c.underline(),
			vt_color_to_color(Some(c.fgcolor())),
			vt_color_to_color(Some(c.bgcolor())),
		)
	} else {
		(" ".to_owned(), false, false, false, None, None)
	};

	if txt == "\t" {
		let tab_width = TAB_WIDTH - (col as usize % TAB_WIDTH);
		txt = " ".repeat(tab_width);
	}

	LineItem {
		width: UnicodeWidthStr::width(txt.as_str()) as u16,
		lexeme: txt,
		is_bold: bold,
		is_italic: italic,
		is_underline: underline,
		foreground_color: fg,
		background_color: bg,
	}
}

fn vt_color_to_color(opt: Option<VtColor>) -> Option<Color> {
	match opt {
		Some(VtColor::Idx(i)) if i < 8 => Some(ansi_color_to_color(i as u16)),
		Some(VtColor::Idx(i)) if i < 16 => {
			Some(ansi_bright_color_to_color((i - 8) as u16))
		}
		Some(VtColor::Idx(i)) => Some(Color::Extended(i)),
		Some(VtColor::Rgb(r, g, b)) => Some(Color::Rgb(r, g, b)),
		Some(VtColor::Default) => None,
		None => None,
	}
}

pub struct CustomTerminalConnection {
	pub id: String,
	pub pty_pair: PtyPair,
	pub app_handle: AppHandle,
	pub terminal_state: Arc<Mutex<TerminalState>>,
}

impl CustomTerminalConnection {
	pub fn new(id: String, os_session: OsSession, app_handle: AppHandle) -> Result<Self> {
		// create PTY
		let pty_pair = native_pty_system().openpty(PtySize {
			rows: 24,
			cols: 64,
			pixel_width: 0,
			pixel_height: 0,
		})?;

		// spawn the requested command
		let cmd = os_session.build_command(false)?;
		let _ = pty_pair.slave.spawn_command(cmd)?;

		let state = Arc::new(Mutex::new(TerminalState::new(24, 64)));

		Ok(Self {
			id,
			pty_pair,
			app_handle,
			terminal_state: state,
		})
	}

	/// Start the PTY→parser→frontend pump in a separate thread.
	pub fn start_io_loop(&mut self) -> Result<()> {
		let mut reader = self.pty_pair.master.try_clone_reader()?;
		let app = self.app_handle.clone();
		let id = self.id.clone();
		let id_clone = id.clone();
		let state = Arc::clone(&self.terminal_state);

		let (event_tx, event_rx) = mpsc::channel::<Vec<TerminalEvent>>();

		thread::spawn(move || {
			// Forward events from the parser to the frontend until the PTY reader
			// thread finishes and the sender side of the channel is dropped.
			for events in event_rx {
				if app
					.emit(&format!("custom-terminal-event-{id_clone}"), &events)
					.is_err()
				{
					println!(
						"Terminal connection {id_clone} disconnected (emit failure)"
					);
					break;
				}
			}

			// Channel closed – reader thread stopped. Notify the frontend once.
			println!("Terminal connection {id_clone} disconnected");
			let _ = app.emit(&format!("custom-terminal-disconnect-{id_clone}"), ());
		});

		thread::spawn(move || {
			let mut buf = [0u8; 4096];
			loop {
				match reader.read(&mut buf) {
					Ok(0) => {
						break; // EOF
					}
					Ok(n) => {
						let events = {
							let mut s = state.lock().unwrap();
							s.process_input(&buf[..n])
						};
						
						if !events.is_empty() {
							if let Err(e) = event_tx.send(events) {
								eprintln!("Failed to send events to channel: {}", e);
								break;
							}
						}
					}
					Err(e) => {
						eprintln!("PTY read error: {e}");
						break;
					}
				}
			}
			// Dropping event_tx automatically closes the channel and
			// terminates the forwarding thread.
		});

		Ok(())
	}

	pub fn decrement_scrollback(&mut self, amount: usize) -> Result<()> {
		let mut state = self.terminal_state.lock().unwrap();
		if state.scrollback > 0 {
			let new_offset = state.scrollback.saturating_sub(amount);
			// state.parser.set_scrollback(new_offset);
			state.scrollback = new_offset.max(0);
			let events = state.screen_events(false);
			for event in events {
				let _ = self
					.app_handle
					.emit(&format!("custom-terminal-event-{}", self.id), &event);
			}
		}
		Ok(())
	}

	pub fn increment_scrollback(&mut self, amount: usize) -> Result<()> {
		let mut state = self.terminal_state.lock().unwrap();
		// vt100 panics if scrollback offset exceeds current rows_len, so clamp to rows.
		let max_offset = state.rows_state.len().saturating_sub(state.rows as usize);
		if state.scrollback < max_offset {
			let new_offset = state.scrollback.saturating_add(amount);
			// state.parser.set_scrollback(new_offset);
			state.scrollback = new_offset.min(max_offset);
			let events = state.screen_events(false);
			if !events.is_empty() {
				self.app_handle
					.emit(&format!("custom-terminal-event-{}", self.id), &events)
					.unwrap();
			}
		}
		Ok(())
	}

	pub fn resize(&mut self, rows: u16, cols: u16) -> Result<()> {
		self.pty_pair.master.resize(PtySize {
			rows,
			cols,
			pixel_width: 0,
			pixel_height: 0,
		})?;
		self.terminal_state.lock().unwrap().resize(rows, cols);
		Ok(())
	}
}

pub struct CustomTerminalManager {
	connections: Arc<Mutex<HashMap<String, CustomTerminalConnection>>>,
	writers: Arc<Mutex<HashMap<String, Box<dyn Write + Send>>>>,
}

impl CustomTerminalManager {
	pub fn new() -> Self {
		Self {
			connections: Arc::new(Mutex::new(HashMap::new())),
			writers: Arc::new(Mutex::new(HashMap::new())),
		}
	}

	pub fn connect_terminal(
		&self,
		os_session: OsSession,
		app_handle: AppHandle,
	) -> Result<String> {
		let id = Uuid::new_v4().to_string();
		let mut conn =
			CustomTerminalConnection::new(id.clone(), os_session, app_handle.clone())?;
		let writer = conn.pty_pair.master.take_writer()?;
		conn.start_io_loop()?;

		self.connections.lock().unwrap().insert(id.clone(), conn);
		self.writers.lock().unwrap().insert(id.clone(), writer);

		println!("Connected terminal: {}", id);
		let events = self
			.connections
			.lock()
			.unwrap()
			.get_mut(&id)
			.unwrap()
			.terminal_state
			.lock()
			.unwrap()
			.screen_events(true);
		for event in events {
			let _ = app_handle.emit(&format!("custom-terminal-event-{}", id), &event);
		}

		Ok(id)
	}

	pub fn send_raw_input(&self, id: &str, data: &str) -> Result<()> {
		if let Some(w) = self.writers.lock().unwrap().get_mut(id) {
			w.write_all(data.as_bytes())?;
			w.flush()?;
			Ok(())
		} else {
			Err(anyhow!("Terminal connection not found"))
		}
	}

	pub fn send_ctrl_c(&self, id: &str) -> Result<()> {
		self.send_raw_input(id, "\x03")
	}
	pub fn send_ctrl_d(&self, id: &str) -> Result<()> {
		self.send_raw_input(id, "\x04")
	}

	pub fn send_input_lines(&self, id: &str, lines: Vec<String>) -> Result<()> {
		self.send_raw_input(id, &(lines.join("\n") + "\n"))
	}

	pub fn decrement_scrollback(&self, id: &str, amount: usize) -> Result<()> {
		if let Some(conn) = self.connections.lock().unwrap().get_mut(id) {
			conn.decrement_scrollback(amount)
		} else {
			Err(anyhow!("Terminal connection not found"))
		}
	}

	pub fn increment_scrollback(&self, id: &str, amount: usize) -> Result<()> {
		if let Some(conn) = self.connections.lock().unwrap().get_mut(id) {
			conn.increment_scrollback(amount)
		} else {
			Err(anyhow!("Terminal connection not found"))
		}
	}

	pub fn resize_terminal(&self, id: &str, rows: u16, cols: u16) -> Result<()> {
		if let Some(conn) = self.connections.lock().unwrap().get_mut(id) {
			let result = conn.resize(rows, cols);
			if result.is_err() {
				Err(anyhow!("Terminal connection not found"))
			} else {
				Ok(())
			}
		} else {
			Err(anyhow!("Terminal connection not found"))
		}
	}

	pub fn kill_terminal(&self, id: &str) -> Result<()> {
		self.connections.lock().unwrap().remove(id);
		self.writers.lock().unwrap().remove(id);
		Ok(())
	}
}

fn ansi_color_to_color(code: u16) -> Color {
	match code {
		0 => Color::Black,
		1 => Color::Red,
		2 => Color::Green,
		3 => Color::Yellow,
		4 => Color::Blue,
		5 => Color::Magenta,
		6 => Color::Cyan,
		7 => Color::White,
		_ => Color::White,
	}
}
fn ansi_bright_color_to_color(code: u16) -> Color {
	match code {
		0 => Color::BrightBlack,
		1 => Color::BrightRed,
		2 => Color::BrightGreen,
		3 => Color::BrightYellow,
		4 => Color::BrightBlue,
		5 => Color::BrightMagenta,
		6 => Color::BrightCyan,
		7 => Color::BrightWhite,
		_ => Color::BrightWhite,
	}
}
