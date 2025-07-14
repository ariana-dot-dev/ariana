import {
	TerminalSpec,
	TerminalEvent,
	LineItem,
	CustomTerminalAPI,
} from "./CustomTerminalAPI";
import { EventEmitter } from "../utils/EventEmitter";
import { OsSession } from "../bindings/os";

const EMPTY_CHAR = " ";

export interface ClaudeCodeTaskResult {
	elapsed: number;
	commitHash?: string;
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
	private terminalLines: number = 24; // Track current terminal height
	private terminalCols: number = 80; // Track current terminal width
	private startTime: number = 0;
	private logPrefix: string;
	private hasSeenTryPrompt = false;
	private hasSeenTrustPrompt = false;
	private isProcessingEvents = false;
	private lastActivityTime: number = 0;
	private osSession: OsSession | null = null;
	private isCompletingTask: boolean = false;
	private stateCheckInterval: number | null = null;
	private lastStateCheck: number = 0;
	// Manual control state
	private isPaused: boolean = false;
	private isManuallyControlled: boolean = false;
	// Visual rendering support
	private visualEventHandler: ((events: TerminalEvent[]) => void) | null = null;

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
	 * Override resizeTerminal to track dimensions and pass through to parent
	 */
	async resizeTerminal(id: string, lines: number, cols: number): Promise<void> {
		// Track terminal dimensions
		this.terminalLines = lines;
		this.terminalCols = cols;
		
		await super.resizeTerminal(id, lines, cols);
	}

	/**
	 * Start a new Claude Code task
	 */
	async startTask(
		osSession: OsSession,
		prompt: string,
		onTerminalReady?: (terminalId: string) => void,
	): Promise<void> {
		if (this.isRunning) {
			const error = "Claude Code task is already running";
			console.error(this.logPrefix, "❌", error);
			throw new Error(error);
		}

		this.isRunning = true;
		this.currentTask = prompt;
		this.currentPrompt = prompt;
		this.osSession = osSession;
		this.startTime = Date.now();
		this.screenLines = [];
		this.hasSeenTryPrompt = false;

		try {
			await this.connectTerminal(osSession);

			// Set up event listeners
			this.setupTerminalListeners();

			// Notify that terminal is ready
			onTerminalReady?.(this.terminalId!);

			// Wait a bit for terminal to be fully ready
			await this.delay(1000);

			// Check if Claude Code is installed and start the process
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
			// Stop the state check interval
			this.stopStateCheckInterval();
			
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
	 * Get the current screen lines (uses terminal dimensions for proper viewport)
	 */
	getCurrentTuiLines(): TuiLine[] {
		if (!this.terminalId) return [];

		// Use terminal dimensions to get only visible lines, not the full history
		const visibleLines = this.terminalLines || 24; // Default to 24 if not set
		const startIndex = Math.max(0, this.screenLines.length - visibleLines);
		
		return this.screenLines.slice(startIndex).map((line, index) => ({
			content: line.map((item) => item.lexeme).join(""),
			timestamp: Date.now() - (this.screenLines.slice(startIndex).length - index) * 100,
		}));
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
	 * Register a visual event handler for the CustomTerminalRenderer
	 * This allows the renderer to receive events for visual display
	 */
	registerVisualEventHandler(handler: (events: TerminalEvent[]) => void): void {
		this.visualEventHandler = handler;
	}

	/**
	 * Unregister the visual event handler
	 */
	unregisterVisualEventHandler(): void {
		this.visualEventHandler = null;
	}

	/**
	 * Clean up resources
	 */
	async cleanup(preserveTerminal: boolean = false): Promise<void> {
		// Only kill terminal if not preserving
		if (this.terminalId && !preserveTerminal) {
			try {
				await this.killTerminal(this.terminalId);
			} catch (error) {
				console.error(`${this.logPrefix} Error killing terminal:`, error);
			}
		}

		super.cleanup();
		
		// Stop the state check interval
		this.stopStateCheckInterval();
		
		this.isRunning = false;
		this.currentTask = null;
		this.currentPrompt = null;
		this.screenLines = [];
		this.hasSeenTryPrompt = false;
		this.hasSeenTrustPrompt = false;
		this.isProcessingEvents = false;
		this.lastActivityTime = 0;
		this.lastStateCheck = 0;
		this.isCompletingTask = false;
		this.isPaused = false;
		this.isManuallyControlled = false;
		
		this.removeAllListeners();
	}

	// Private methods

	private setupTerminalListeners(): void {
		if (!this.terminalId) return;

		try {
			// Add counter to track callback invocations
			let callbackCount = 0;
			
			this.onTerminalEvent(this.terminalId, (events: TerminalEvent[]) => {
				callbackCount++;
				
				// Just update the internal state, don't process immediately
				this.updateInternalState(events);
			});
			
			// Start 1-second state checking interval
			this.startStateCheckInterval();
		} catch (error) {
			console.error(this.logPrefix, "❌ Error setting up ClaudeCodeAgent event listener:", error);
		}
	}

	private startStateCheckInterval(): void {
		if (this.stateCheckInterval) return; // Already running
		
		this.stateCheckInterval = window.setInterval(() => {
			this.checkCurrentState();
		}, 1000); // Check state every 1 second
	}
	
	private stopStateCheckInterval(): void {
		if (this.stateCheckInterval) {
			window.clearInterval(this.stateCheckInterval);
			this.stateCheckInterval = null;
		}
	}
	
	private updateInternalState(events: TerminalEvent[]): void {
		// Forward events to visual renderer if registered
		if (this.visualEventHandler) {
			this.visualEventHandler(events);
		}
		
		// Silently update internal state without processing
		this.handleTerminalEvents(events);
		this.lastActivityTime = Date.now();
	}
	
	private checkCurrentState(): void {
		const now = Date.now();
		this.lastStateCheck = now;
		
		// Get current TUI lines for CLI agents library
		const tuiLines = this.getCurrentTuiLines();
		
		// Only emit and process if we have actual content
		if (tuiLines.length > 0) {
			// Emit screen update event
			this.emit("screenUpdate", tuiLines);
			
			// Process TUI interactions based on current state
			this.processTuiInteraction(tuiLines).catch(error => {
				console.error(this.logPrefix, "Error in TUI interaction processing:", error);
			});
		}
	}

	private handleTerminalEvents(events: TerminalEvent[]): void {
		// Only process the latest screen state, not intermediate changes
		let latestScreenUpdate: TerminalEvent | null = null;
		let hasPatches = false;
		let hasNewLines = false;

		// Find the latest complete screen update or collect patches/newLines
		for (const event of events) {
			switch (event.type) {
				case "screenUpdate":
					latestScreenUpdate = event; // Use the latest screen update
					hasPatches = false; // Screen update supersedes patches
					hasNewLines = false; // Screen update supersedes new lines
					break;
				case "patch":
					if (!latestScreenUpdate) hasPatches = true;
					break;
				case "newLines":
					if (!latestScreenUpdate) hasNewLines = true;
					break;
			}
		}

		// Apply the final state
		if (latestScreenUpdate && latestScreenUpdate.screen) {
			this.screenLines = [...latestScreenUpdate.screen];
		} else if (hasPatches || hasNewLines) {
			// Only apply patches/newLines if no complete screen update
			for (const event of events) {
				switch (event.type) {
					case "newLines":
						if (event.lines) {
							this.screenLines.push(...event.lines);
						}
						break;
					case "patch":
						if (event.line !== undefined && event.items) {
							while (this.screenLines.length <= event.line) {
								this.screenLines.push([]);
							}
							this.screenLines[event.line] = [...event.items];
						}
						break;
				}
			}
		}
		
		// Just update the internal state, don't emit events here
		// Events will be emitted during the 1-second state check
	}

	private async initializeClaudeCode(): Promise<void> {
		if (!this.terminalId) {
			console.error(
				this.logPrefix,
				"No terminal ID available for Claude Code initialization",
			);
			return;
		}

		// Check if claude is available
		await this.sendInputLines(this.terminalId, ["which claude"]);
		await this.delay(1000);

		// Get the current working directory
		await this.sendInputLines(this.terminalId, ["pwd"]);
		await this.delay(500);

		// Test if terminal is responding by sending a simple echo command
		await this.sendInputLines(this.terminalId, ["echo 'TERMINAL_TEST_SUCCESS'"]);
		await this.delay(1000);

		// Start Claude Code without prompt initially
		const claudeCommand = "claude";
		await this.sendInputLines(this.terminalId, [claudeCommand]);

		this.emit("taskStarted", {
			prompt: this.currentPrompt,
			terminalId: this.terminalId,
		});
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

	// Manual control methods
	async pauseAgent(): Promise<void> {
		if (!this.terminalId || this.isPaused) {
			return;
		}

		await this.sendEscapeUntilInterrupted();
		this.isPaused = true;
		this.emit('agentPaused');
	}

	async resumeAgent(): Promise<void> {
		if (!this.terminalId || !this.isPaused) {
			return;
		}

		await this.sendRawInput(this.terminalId, "continue");
		await this.delay(1000);
		await this.sendRawInput(this.terminalId, "\x0d"); // Send Enter
		this.isPaused = false;
		this.emit('agentResumed');
	}

	async queuePrompt(prompt: string): Promise<void> {
		if (!this.terminalId) {
			throw new Error('No terminal available for queuing prompt');
		}

		// Send prompt to Claude Code (will be queued if busy)
		for (const char of prompt) {
			if (char === "\n") {
				await this.sendRawInput(this.terminalId, "\\");
				await this.delay(Math.random() * 5 + 5);
				await this.sendRawInput(this.terminalId, "\r\n");
			} else {
				await this.sendRawInput(this.terminalId, char);
			}
			await this.delay(Math.random() * 5 + 5);
		}
		await this.delay(1000);
		await this.sendRawInput(this.terminalId, "\x0d");

		this.emit('promptQueued', { prompt });
	}

	async prepareManualCommit(): Promise<void> {
		// Don't send Ctrl+D - keep terminal alive
		this.emit('readyForCommit');
	}

	private async sendEscapeUntilInterrupted(): Promise<void> {
		let attempts = 0;

		while (true) {
			await this.sendRawInput(this.terminalId!, "\x1b"); // ESC
			await this.delay(500);
			attempts++;

			let currentLines = this.getCurrentTuiLines();
			currentLines = currentLines.map((line) => ({ ...line, content: line.content.replaceAll(" ", " ") }));
			const hasInterrupted = currentLines.some(line =>
				line.content.includes("Interrupted by user")
			);
			const hasPrompt = currentLines.some(line =>
				line.content.includes("│ >")
			);

			if (hasInterrupted && hasPrompt) {
				break;
			}

			if (attempts >= 5) {
				break; // Prevent infinite loop in case of unexpected behavior
			}
		}
	}

	getAgentStatus(): { isRunning: boolean; isPaused: boolean; terminalId: string | null } {
		return {
			isRunning: this.isRunning,
			isPaused: this.isPaused,
			terminalId: this.terminalId
		};
	}

	private async processTuiInteraction(tuiLines: TuiLine[]): Promise<void> {
		if (!this.terminalId) return;

		// Extract all new line content from the events
		let newLines: string[] = tuiLines.map((tuiLine) => tuiLine.content);

		newLines = newLines.map((line) => line.replaceAll(EMPTY_CHAR, " "));

		// Check for "esc to interrupt" - do nothing
		const hasEscToInterrupt = newLines.some((line) =>
			line.includes("esc to interrupt"),
		);
		if (hasEscToInterrupt) {
			return;
		}

		// Check for "│ > Try" prompt (first time only)
		const hasTryPrompt = newLines.some((line) => line.includes("│ >"));
		if (hasTryPrompt && !this.hasSeenTryPrompt && this.currentPrompt) {
			this.hasSeenTryPrompt = true;
			// Emit event to trigger UI update
			this.emit("promptSent");
			// Send the prompt key by key, simulating typing
			for (const char of this.currentPrompt) {
				if (char === "\n") {
					await this.sendRawInput(this.terminalId, "\\");
					await this.delay(Math.random() * 5 + 5);
					await this.sendRawInput(this.terminalId, "\r\n");
				} else {
					await this.sendRawInput(this.terminalId, char);
				}
				await this.delay(Math.random() * 5 + 5);
			}
			await this.delay(1000);
			await this.sendRawInput(this.terminalId, "\x0d");
			return;
		}

		// Check for "Yes, and don't ask again this session (shift+tab)"
		const hasShiftTabOption = newLines.some((line) =>
			line.includes("1. Yes"),
		);
		if (hasShiftTabOption && !this.hasSeenTrustPrompt) {
			this.hasSeenTrustPrompt = true; // Prevent repeated processing
			await this.delay(1000);
			await this.sendRawInput(this.terminalId, "\x0d");
			return;
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Check if a task is currently running and a prompt has been sent
	 * Pause button should only show if agent is running AND we've sent the prompt
	 */
	isTaskRunning(): boolean {
		return this.isRunning && this.hasSeenTryPrompt;
	}

	/**
	 * Check if agent is available to accept new prompts (terminal alive and ready)
	 * Used to determine if we should queue prompts or create new agent
	 */
	isAgentAvailable(): boolean {
		return !!this.terminalId && !this.isCompletingTask;
	}

	/**
	 * Reset task state after manual commit
	 * Called when tasks are committed manually via the commit button
	 */
	resetAfterCommit(): void {
		this.isRunning = false;
		this.hasSeenTryPrompt = false;
		this.currentTask = null;
		this.currentPrompt = null;
		this.isManuallyControlled = true; // Keep terminal alive but mark as manually controlled
	}
}
