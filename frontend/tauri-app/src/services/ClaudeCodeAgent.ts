import {
	TerminalSpec,
	TerminalEvent,
	LineItem,
	CustomTerminalAPI,
} from "./CustomTerminalAPI";
import { EventEmitter } from "../utils/EventEmitter";
import { OsSession } from "../bindings/os";

export interface ClaudeCodeTaskResult {
	elapsed: number;
	tokens?: number;
	diff: {
		file_changes: Array<{
			absolute_path: string;
			name_and_extension: string;
			original_content: string;
			final_content: string;
			git_style_diff: string;
		}>;
	};
}

export interface TuiLine {
	content: string;
	timestamp: number;
}

export interface KeyboardKey {
	type: "char" | "ctrl" | "alt" | "special";
	value: string;
}

/**
 * Claude Code Agent that manages interaction with the Claude Code CLI tool
 * through the custom terminal system. This provides a bridge between the
 * text area UI and the headless CLI agents library.
 */
export class ClaudeCodeAgent extends CustomTerminalAPI {
	private eventEmitter: EventEmitter;
	private isRunning = false;
	private currentTask: string | null = null;
	private currentPrompt: string | null = null;
	private screenLines: LineItem[][] = [];
	private startTime: number = 0;
	private logPrefix: string;
	private hasSeenTryPrompt = false;
	private hasSeenTrustPrompt = false;
	private isProcessingEvents = false;
	private eventQueue: TerminalEvent[][] = [];
	private lastActivityTime: number = 0;
	private completionTimeoutId: NodeJS.Timeout | null = null;

	constructor() {
		super();
		this.eventEmitter = new EventEmitter();
		this.logPrefix = `[ClaudeCodeAgent-${Date.now().toString(36)}]`;
		console.log(this.logPrefix, "Created new ClaudeCodeAgent instance");
		console.log(
			this.logPrefix,
			"resizeTerminal method:",
			this.resizeTerminal.toString(),
		);
	}

	// EventEmitter methods delegation
	on(event: string, listener: (...args: any[]) => void): void {
		this.eventEmitter.on(event, listener);
	}

	off(event: string, listener: (...args: any[]) => void): void {
		this.eventEmitter.off(event, listener);
	}

	emit(event: string, ...args: any[]): void {
		this.eventEmitter.emit(event, ...args);
	}

	removeAllListeners(): void {
		this.eventEmitter.removeAllListeners();
	}

	/**
	 * Override resizeTerminal to enforce 24x80 size
	 */
	async resizeTerminal(id: string, lines: number, cols: number): Promise<void> {
		await super.resizeTerminal(id, 24, 80);
	}

	/**
	 * Start a new Claude Code task
	 */
	async startTask(
		osSession: OsSession,
		prompt: string,
		onTerminalReady?: (terminalId: string) => void,
	): Promise<void> {
		console.log(
			this.logPrefix,
			"Starting Claude Code task with prompt:",
			prompt,
		);

		if (this.isRunning) {
			const error = "Claude Code task is already running";
			console.error(this.logPrefix, "❌", error);
			throw new Error(error);
		}

		this.isRunning = true;
		this.currentTask = prompt;
		this.currentPrompt = prompt;
		this.startTime = Date.now();
		this.screenLines = [];
		this.hasSeenTryPrompt = false;

		try {
			console.log(this.logPrefix, "Connecting terminal...");
			await this.connectTerminal(osSession);
			console.log(
				this.logPrefix,
				"Terminal connected with ID:",
				this.terminalId,
			);

			// Set up event listeners
			console.log(this.logPrefix, "Setting up terminal listeners...");
			this.setupTerminalListeners();

			// Notify that terminal is ready
			console.log(this.logPrefix, "Notifying terminal ready callback...");
			onTerminalReady?.(this.terminalId!);

			// Wait a bit for terminal to be fully ready
			console.log(this.logPrefix, "Waiting 1000ms for terminal to be ready...");
			await this.delay(1000);

			// Check if Claude Code is installed and start the process
			console.log(this.logPrefix, "Initializing Claude Code...");
			await this.initializeClaudeCode();
		} catch (error) {
			console.error(this.logPrefix, "Error starting task:", error);
			this.isRunning = false;
			this.cleanup();
			this.emit(
				"taskError",
				error instanceof Error ? error.message : String(error),
			);
			throw error;
		}
	}

	/**
	 * Stop the current Claude Code task
	 */
	async stopTask(): Promise<void> {
		if (!this.isRunning || !this.terminalId) return;

		try {
			// Send Ctrl+C to interrupt
			await this.sendCtrlC(this.terminalId);

			// Wait a bit then clean up
			await this.delay(500);

			await this.killTerminal(this.terminalId);
		} catch (error) {
			console.error("Error stopping Claude Code task:", error);
		} finally {
			this.isRunning = false;
			this.currentTask = null;
			this.screenLines = [];
			this.emit("taskStopped");
		}
	}

	/**
	 * Send keyboard input to the terminal
	 */
	async sendKeys(keys: KeyboardKey[]): Promise<void> {
		if (!this.terminalId) return;

		for (const key of keys) {
			await this.sendSingleKey(key);
		}
	}

	/**
	 * Get the current screen lines (last N lines where N is terminal height)
	 */
	getCurrentTuiLines(terminalHeight: number = 24): TuiLine[] {
		if (!this.terminalId) return [];

		return this.screenLines.slice(-terminalHeight).map((line, index) => ({
			content: line.map((item) => item.lexeme).join(""),
			timestamp:
				Date.now() -
				(this.screenLines.slice(-terminalHeight).length - index) * 100,
		}));
	}

	/**
	 * Check if task is currently running
	 */
	isTaskRunning(): boolean {
		return this.isRunning;
	}

	/**
	 * Get current task information
	 */
	getCurrentTask(): { prompt: string; elapsed: number } | null {
		if (!this.currentTask) return null;

		return {
			prompt: this.currentTask,
			elapsed: Date.now() - this.startTime,
		};
	}

	/**
	 * Clean up resources
	 */
	async cleanup(): Promise<void> {
		if (this.terminalId) {
			try {
				await this.killTerminal(this.terminalId);
			} catch (error) {
				console.error("Error killing terminal:", error);
			}
		}

		super.cleanup();
		this.isRunning = false;
		this.currentTask = null;
		this.currentPrompt = null;
		this.screenLines = [];
		this.hasSeenTryPrompt = false;
		this.hasSeenTrustPrompt = false;
		this.isProcessingEvents = false;
		this.eventQueue = [];
		this.lastActivityTime = 0;
		if (this.completionTimeoutId) {
			clearTimeout(this.completionTimeoutId);
			this.completionTimeoutId = null;
		}
		this.removeAllListeners();
	}

	// Private methods

	private setupTerminalListeners(): void {
		if (!this.terminalId) {
			console.error(this.logPrefix, "No terminalId available for setting up listeners");
			return;
		}

		console.log(this.logPrefix, "Setting up terminal event listener for terminal:", this.terminalId);
		
		// Add a test to see if onTerminalEvent method exists and works
		console.log(this.logPrefix, "onTerminalEvent method type:", typeof this.onTerminalEvent);
		console.log(this.logPrefix, "this object keys:", Object.getOwnPropertyNames(this));
		
		try {
			this.onTerminalEvent(this.terminalId, (events: TerminalEvent[]) => {
				console.log(this.logPrefix, "🎉 Raw terminal event callback received:", events.length, "events");
				console.log(this.logPrefix, "🎉 Event types:", events.map(e => e.type));
				this.queueEventBatch(events);
			});
			console.log(this.logPrefix, "✅ Terminal event listener setup complete");
		} catch (error) {
			console.error(this.logPrefix, "❌ Error setting up terminal event listener:", error);
		}
	}

	private queueEventBatch(events: TerminalEvent[]): void {
		console.log(this.logPrefix, "Queueing event batch with", events.length, "events");
		this.eventQueue.push(events);
		this.processEventQueue();
	}

	private async processEventQueue(): Promise<void> {
		if (this.isProcessingEvents || this.eventQueue.length === 0) {
			return;
		}

		this.isProcessingEvents = true;

		try {
			while (this.eventQueue.length > 0) {
				const events = this.eventQueue.shift()!;
				await this.handleTerminalEvents(events);
			}
		} catch (error) {
			console.error(this.logPrefix, "Error processing event queue:", error);
		} finally {
			this.isProcessingEvents = false;
		}
	}

	private async handleTerminalEvents(events: TerminalEvent[]): Promise<void> {
		console.log(this.logPrefix, "Received", events.length, "terminal events");

		for (const event of events) {
			console.log(this.logPrefix, "Processing event:", event.type);

			switch (event.type) {
				case "screenUpdate":
					if (event.screen) {
						console.log(
							this.logPrefix,
							"Screen update - new screen has",
							event.screen.length,
							"lines",
						);
						this.screenLines = [...event.screen];

						// Log current screen content for debugging
						const screenText = event.screen.map((line) =>
							line.map((item) => item.lexeme).join(""),
						);
						console.log(this.logPrefix, "Current screen content:");
						screenText.forEach((line, i) => {
							if (line.trim()) {
								console.log(
									this.logPrefix,
									`  Line ${i}:`,
									JSON.stringify(line),
								);
							}
						});
					}
					break;

				case "newLines":
					if (event.lines) {
						console.log(this.logPrefix, "New lines added:", event.lines.length);
						this.screenLines.push(...event.lines);

						// Log new lines content
						event.lines.forEach((line, i) => {
							const lineText = line.map((item) => item.lexeme).join("");
							if (lineText.trim()) {
								console.log(
									this.logPrefix,
									`  New line ${i}:`,
									JSON.stringify(lineText),
								);
							}
						});
					}
					break;

				case "patch":
					if (event.line !== undefined && event.items) {
						console.log(
							this.logPrefix,
							"Patching line",
							event.line,
							"with",
							event.items.length,
							"items",
						);
						// Ensure we have enough lines
						while (this.screenLines.length <= event.line) {
							this.screenLines.push([]);
						}
						this.screenLines[event.line] = [...event.items];

						// Log patched line content
						const lineText = event.items.map((item) => item.lexeme).join("");
						console.log(
							this.logPrefix,
							`  Patched line ${event.line}:`,
							JSON.stringify(lineText),
						);
					}
					break;
			}
		}

		// Update last activity time
		this.lastActivityTime = Date.now();
		this.resetCompletionTimeout();

		// Get current TUI lines for CLI agents library
		const tuiLines = this.getCurrentTuiLines();
		// Emit screen update event
		this.emit("screenUpdate", tuiLines);

		// Process TUI interactions based on new lines
		await this.processTuiInteraction(tuiLines);
	}

	private async initializeClaudeCode(): Promise<void> {
		console.log(this.logPrefix, "initializeClaudeCode() method called");
		
		if (!this.terminalId) {
			console.error(
				this.logPrefix,
				"No terminal ID available for Claude Code initialization",
			);
			return;
		}

		console.log(this.logPrefix, "Terminal ID confirmed:", this.terminalId);

		try {
			console.log(this.logPrefix, "Checking if Claude Code is available...");
			// Check if claude is available
			await this.sendInputLines(this.terminalId, ["which claude"]);
			console.log(this.logPrefix, "Successfully sent 'which claude', waiting 1000ms...");
			await this.delay(1000);

			console.log(this.logPrefix, "Getting current working directory...");
			// Get the current working directory
			await this.sendInputLines(this.terminalId, ["pwd"]);
			console.log(this.logPrefix, "Successfully sent 'pwd', waiting 500ms...");
			await this.delay(500);

			// Start Claude Code without prompt initially
			const claudeCommand = "claude";
			console.log(
				this.logPrefix,
				"Starting Claude Code with command:",
				claudeCommand,
			);
			await this.sendInputLines(this.terminalId, [claudeCommand]);
			console.log(this.logPrefix, "Successfully sent claude command, waiting for terminal events...");
			
			console.log(this.logPrefix, "Emitting taskStarted event...");
			this.emit("taskStarted", {
				prompt: this.currentPrompt,
				terminalId: this.terminalId,
			});
			console.log(this.logPrefix, "taskStarted event emitted successfully");
			
			// Start a periodic check to see if we're getting ANY terminal events
			this.startPeriodicEventCheck();
		} catch (error) {
			console.error(this.logPrefix, "Error during Claude Code initialization:", error);
			throw error;
		}
	}

	private startPeriodicEventCheck(): void {
		console.log(this.logPrefix, "Starting periodic event check...");
		let checkCount = 0;
		const maxChecks = 20; // Check for 20 seconds
		
		const checkInterval = setInterval(async () => {
			checkCount++;
			console.log(this.logPrefix, `Event check ${checkCount}/${maxChecks}: screenLines length = ${this.screenLines.length}`);
			
			if (this.screenLines.length > 0) {
				console.log(this.logPrefix, "📺 Current screen content:");
				this.screenLines.slice(-5).forEach((line, i) => {
					const lineText = line.map(item => item.lexeme).join("");
					if (lineText.trim()) {
						console.log(this.logPrefix, `  Line ${i}:`, JSON.stringify(lineText));
					}
				});
				// Events are working, stop checking
				clearInterval(checkInterval);
				return;
			} else {
				console.log(this.logPrefix, "📺 No screen content yet");
				
				// Mac workaround: Try multiple approaches to force terminal activity
				if (checkCount === 3 && this.terminalId) {
					console.log(this.logPrefix, "🔧 Mac workaround: Sending multiple commands to wake up terminal...");
					try {
						// Try multiple approaches
						await this.sendRawInput(this.terminalId, " ");
						await this.delay(100);
						await this.sendRawInput(this.terminalId, "\b");
						await this.delay(100);
						await this.sendRawInput(this.terminalId, "\r"); // Enter for security prompt
						await this.delay(500);
						await this.sendRawInput(this.terminalId, "\r"); // Another Enter
					} catch (error) {
						console.log(this.logPrefix, "Failed to send wake-up commands:", error);
					}
				}
				
				// Aggressive prompt injection after 7 seconds - bypass pattern detection entirely
				if (checkCount === 7 && this.terminalId && !this.hasSeenTryPrompt) {
					console.log(this.logPrefix, "🚨 EMERGENCY: No events after 7s, bypassing pattern detection and injecting prompt directly...");
					try {
						this.hasSeenTryPrompt = true; // Prevent duplicate injection
						
						// Send the prompt directly - Claude should be at Try prompt by now
						for (const char of this.currentPrompt || "help") {
							if (char === "\n") {
								await this.sendRawInput(this.terminalId, "\\");
								await this.delay(50);
								await this.sendRawInput(this.terminalId, "\r");
							} else {
								await this.sendRawInput(this.terminalId, char);
							}
							await this.delay(50);
						}
						await this.delay(300);
						await this.sendRawInput(this.terminalId, "\r");
						
						console.log(this.logPrefix, "🚨 Emergency prompt injection completed");
					} catch (error) {
						console.log(this.logPrefix, "Failed emergency prompt injection:", error);
					}
				}
				
				// Mac workaround: Handle auto-edits prompts that might be waiting
				if (checkCount === 10 && this.terminalId) {
					console.log(this.logPrefix, "🔧 Mac workaround: Checking for auto-edits prompts, sending Shift+Tab to select 'don't ask again'...");
					try {
						await this.sendRawInput(this.terminalId, "\x1b[Z"); // Shift+Tab sequence
						await this.delay(200);
					} catch (error) {
						console.log(this.logPrefix, "Failed to send Shift+Tab for auto-edits:", error);
					}
				}
			}
			
			if (checkCount >= maxChecks) {
				console.log(this.logPrefix, "❌ Event check timeout - no terminal events received after 20 seconds");
				console.log(this.logPrefix, "This appears to be a Mac-specific terminal event system issue");
				clearInterval(checkInterval);
			}
		}, 1000);
	}

	private async sendSingleKey(key: KeyboardKey): Promise<void> {
		if (!this.terminalId) return;

		let keyData: string;

		switch (key.type) {
			case "char":
				keyData = key.value;
				break;
			case "ctrl":
				if (key.value.toLowerCase() === "c") {
					await this.sendCtrlC(this.terminalId);
					return;
				} else if (key.value.toLowerCase() === "d") {
					await this.sendCtrlD(this.terminalId);
					return;
				}
				keyData = String.fromCharCode(
					key.value.toUpperCase().charCodeAt(0) - 64,
				);
				break;
			case "special":
				switch (key.value) {
					case "Enter":
						keyData = "\r";
						break;
					case "Backspace":
						keyData = "\b";
						break;
					case "Tab":
						keyData = "\t";
						break;
					case "Escape":
						keyData = "\x1b";
						break;
					case "ArrowUp":
						keyData = "\x1b[A";
						break;
					case "ArrowDown":
						keyData = "\x1b[B";
						break;
					case "ArrowLeft":
						keyData = "\x1b[D";
						break;
					case "ArrowRight":
						keyData = "\x1b[C";
						break;
					default:
						keyData = key.value;
				}
				break;
			default:
				keyData = key.value;
		}

		await this.sendRawInput(this.terminalId, keyData);
	}

	private resetCompletionTimeout(): void {
		if (this.completionTimeoutId) {
			clearTimeout(this.completionTimeoutId);
		}

		// Only set timeout if we've seen the Try prompt (task has started)
		if (this.hasSeenTryPrompt) {
			this.completionTimeoutId = setTimeout(() => {
				this.handleTaskCompletion();
			}, 5000); // 5 seconds of inactivity
		}
	}

	private async handleTaskCompletion(): Promise<void> {
		if (!this.terminalId || !this.hasSeenTryPrompt) return;

		console.log(
			this.logPrefix,
			"Task appears to be complete after 5 seconds of inactivity, sending Ctrl+D twice...",
		);

		try {
			await this.sendCtrlD(this.terminalId);
			await this.delay(Math.random() * 500 + 500);
			await this.sendCtrlD(this.terminalId);

			const elapsed = Date.now() - this.startTime;
			this.emit("taskCompleted", {
				prompt: this.currentPrompt,
				elapsed,
			});
		} catch (error) {
			console.error(
				this.logPrefix,
				"Error sending completion sequence:",
				error,
			);
		}
	}

	private async processTuiInteraction(tuiLines: TuiLine[]): Promise<void> {
		if (!this.terminalId) return;

		// Extract all new line content from the events
		let newLines: string[] = tuiLines.map((tuiLine) => tuiLine.content);

		newLines = newLines.map((line) => line.replaceAll(" ", " "));

		console.log(this.logPrefix, "Analyzing new lines for TUI interactions:");
		newLines.forEach((line, i) => {
			if (line.trim()) {
				console.log(this.logPrefix, `  Line ${i}:`, JSON.stringify(line));
			}
		});

		// Check for trust folder confirmation
		const hasEnterToConfirm = newLines.some((line) =>
			line.includes("Enter to confirm"),
		);
		const hasTrustQuestion = newLines.some((line) =>
			line.includes("Do you trust the files in this folder?"),
		);

		if (hasEnterToConfirm && hasTrustQuestion && !this.hasSeenTrustPrompt) {
			console.log(
				this.logPrefix,
				"Found trust confirmation prompt, sending Enter...",
			);
			await this.delay(Math.random() * 500 + 500);
			await this.sendRawInput(this.terminalId, "\r");
			this.hasSeenTrustPrompt = true;
			return;
		}

		// Check for Claude Code security menu with "Yes, proceed" option
		const hasClaudeSecurityMenu = newLines.some((line) => {
			return (
				line.includes("❯ 1. Yes, proceed") ||
				line.includes("1. Yes, proceed") ||
				(line.includes("Claude Code may read files") || line.includes("Claude Code may execute files")) ||
				line.includes("https://docs.anthropic.com/s/claude-code-security")
			);
		});
		
		if (hasClaudeSecurityMenu) {
			console.log(
				this.logPrefix,
				"Found Claude Code security menu, sending Enter to select 'Yes, proceed'...",
			);
			await this.delay(Math.random() * 500 + 500);
			await this.sendRawInput(this.terminalId, "\r");
			return;
		}

		// Check for other general "Yes, proceed" type prompts (fallback)
		const hasProceedPrompt = newLines.some((line) => {
			const normalizedLine = line.toLowerCase();
			return (
				(normalizedLine.includes("y") && normalizedLine.includes("n")) ||
				normalizedLine.includes("[y/n]") ||
				normalizedLine.includes("(y/n)")
			);
		});
		
		if (hasProceedPrompt) {
			console.log(
				this.logPrefix,
				"Found y/n confirmation prompt, sending 'y' and Enter...",
			);
			await this.delay(Math.random() * 500 + 500);
			await this.sendRawInput(this.terminalId, "y");
			await this.delay(Math.random() * 200 + 200);
			await this.sendRawInput(this.terminalId, "\r");
			return;
		}

		// Check for "Yes, and don't ask again this session (shift+tab)"
		const hasShiftTabOption = newLines.some((line) =>
			line.includes("Yes, and don't ask again this session (shift+tab)"),
		);
		if (hasShiftTabOption) {
			console.log(
				this.logPrefix,
				"Found 'don't ask again' option, sending Shift+Tab...",
			);
			await this.sendRawInput(this.terminalId, "\x1b[Z"); // Shift+Tab sequence
			return;
		}

		// Check for "Try" prompt (first time only) - handle various Mac/Windows rendering differences
		const hasTryPrompt = newLines.some((line) => {
			const normalizedLine = line.toLowerCase().trim();
			return (
				normalizedLine.includes("try") || 
				line.includes("│ > Try") ||
				line.includes("> Try") ||
				line.includes("Try") ||
				normalizedLine.includes("> try") ||
				/[│|]\s*>\s*try/i.test(line) ||
				/try.*prompt/i.test(line) ||
				line.includes("What can I help you with?") ||
				line.includes("What would you like me to help with?")
			);
		});
		
		console.log(this.logPrefix, "Try prompt detection:", hasTryPrompt, "hasSeenTryPrompt:", this.hasSeenTryPrompt);
		
		if (hasTryPrompt && !this.hasSeenTryPrompt && this.currentPrompt) {
			console.log(
				this.logPrefix,
				"Found 'Try' prompt, sending task prompt:",
				this.currentPrompt,
			);
			this.hasSeenTryPrompt = true;
			// Send the prompt key by key, simulating typing
			for (const char of this.currentPrompt) {
				if (char === "\n") {
					await this.sendRawInput(this.terminalId, "\\");
					await this.delay(Math.random() * 50 + 50);
					await this.sendRawInput(this.terminalId, "\r");
				} else {
					await this.sendRawInput(this.terminalId, char);
				}
				await this.delay(Math.random() * 50 + 50);
			}
			await this.delay(Math.random() * 500 + 500);
			await this.sendRawInput(this.terminalId, "\r");
			return;
		}

		// Check for "esc to interrupt" - do nothing
		const hasEscToInterrupt = newLines.some((line) =>
			line.includes("esc to interrupt"),
		);
		if (hasEscToInterrupt) {
			console.log(this.logPrefix, "Found 'esc to interrupt', waiting...");
			return;
		}

		// Backup mechanism: If Claude seems ready but we haven't sent prompt yet
		// Look for any signs that Claude is waiting for input
		const hasClaudeWaitingSignals = newLines.some((line) => {
			const normalizedLine = line.toLowerCase();
			return (
				normalizedLine.includes("claude") ||
				normalizedLine.includes("help") ||
				normalizedLine.includes("what") ||
				normalizedLine.includes("?") ||
				line.includes(">") ||
				line.includes("│") ||
				line.includes("prompt") ||
				line.includes("ask")
			);
		});

		// If we see waiting signals and haven't sent prompt yet, and enough time has passed
		const timeSinceStart = Date.now() - this.startTime;
		if (hasClaudeWaitingSignals && !this.hasSeenTryPrompt && this.currentPrompt && timeSinceStart > 3000) {
			console.log(
				this.logPrefix,
				"Backup mechanism: Detected Claude waiting signals, sending prompt anyway after",
				timeSinceStart,
				"ms"
			);
			this.hasSeenTryPrompt = true;
			
			// Send the prompt
			for (const char of this.currentPrompt) {
				if (char === "\n") {
					await this.sendRawInput(this.terminalId, "\\");
					await this.delay(Math.random() * 50 + 50);
					await this.sendRawInput(this.terminalId, "\r");
				} else {
					await this.sendRawInput(this.terminalId, char);
				}
				await this.delay(Math.random() * 50 + 50);
			}
			await this.delay(Math.random() * 500 + 500);
			await this.sendRawInput(this.terminalId, "\r");
			return;
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
