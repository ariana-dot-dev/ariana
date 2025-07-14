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
		console.log(`${this.logPrefix} Terminal resized to ${lines}x${cols}`);
		
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
		this.osSession = osSession;
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
		
		// Log screen buffer growth periodically
		if (this.screenLines.length > 0 && this.screenLines.length % 1000 === 0) {
			console.log(`[MemoryTrack] ${this.logPrefix} Screen buffer: ${this.screenLines.length} lines, visible: ${visibleLines}, memory estimate: ~${(this.screenLines.length * 80 / 1024).toFixed(1)}KB`);
		}
		
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
		console.log(`${this.logPrefix} Registered visual event handler for terminal rendering`);
	}

	/**
	 * Unregister the visual event handler
	 */
	unregisterVisualEventHandler(): void {
		this.visualEventHandler = null;
		console.log(`${this.logPrefix} Unregistered visual event handler`);
	}

	/**
	 * Clean up resources
	 */
	async cleanup(preserveTerminal: boolean = false): Promise<void> {
		console.log(`${this.logPrefix} R2,R9: Starting cleanup (preserveTerminal: ${preserveTerminal}) - terminal persistence control`);
		
		// Only kill terminal if not preserving
		if (this.terminalId && !preserveTerminal) {
			try {
				console.log(`${this.logPrefix} R2,R9: Killing terminal ${this.terminalId} - preserveTerminal is false`);
				await this.killTerminal(this.terminalId);
			} catch (error) {
				console.error(`${this.logPrefix} R2,R9: Error killing terminal:`, error);
			}
		} else if (this.terminalId && preserveTerminal) {
			console.log(`${this.logPrefix} R2,R9: Preserving terminal ${this.terminalId} - will survive canvas switches and app restarts`);
		}

		console.log(`${this.logPrefix} Calling super.cleanup()`);
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
		console.log(`${this.logPrefix} Cleanup completed`);
	}

	// Private methods

	private setupTerminalListeners(): void {
		if (!this.terminalId) return;

		try {
			console.log(`${this.logPrefix} Setting up terminal event listener for terminal: ${this.terminalId}`);
			
			// Add counter to track callback invocations
			let callbackCount = 0;
			
			this.onTerminalEvent(this.terminalId, (events: TerminalEvent[]) => {
				callbackCount++;
				console.log(`${this.logPrefix} ✅ Terminal event callback invoked (call #${callbackCount}): ${events.length} events`);
				console.log(`${this.logPrefix} Event types:`, events.map(e => e.type));
				
				// Just update the internal state, don't process immediately
				this.updateInternalState(events);
			});
			
			// Start 1-second state checking interval
			this.startStateCheckInterval();
			
			// Add periodic check to see if callback is being called
			setInterval(() => {
				console.log(`${this.logPrefix} Event callback status: ${callbackCount} total callbacks received`);
			}, 10000); // Log every 10 seconds
			
			console.log(`${this.logPrefix} Terminal event listener setup completed`);
		} catch (error) {
			console.error(this.logPrefix, "❌ Error setting up ClaudeCodeAgent event listener:", error);
		}
	}

	private startStateCheckInterval(): void {
		if (this.stateCheckInterval) return; // Already running
		
		console.log(`${this.logPrefix} Starting 1-second state check interval`);
		this.stateCheckInterval = window.setInterval(() => {
			this.checkCurrentState();
		}, 1000); // Check state every 1 second
	}
	
	private stopStateCheckInterval(): void {
		if (this.stateCheckInterval) {
			window.clearInterval(this.stateCheckInterval);
			this.stateCheckInterval = null;
			console.log(`${this.logPrefix} Stopped state check interval`);
		}
	}
	
	private updateInternalState(events: TerminalEvent[]): void {
		// Add debug logging
		console.log(`${this.logPrefix} updateInternalState called with ${events.length} events:`, events.map(e => e.type));
		
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
		
		// Add debug logging
		console.log(`${this.logPrefix} checkCurrentState: screenLines.length=${this.screenLines.length}, tuiLines.length=${tuiLines.length}`);
		
		if (tuiLines.length > 0) {
			console.log(`${this.logPrefix} Processing ${tuiLines.length} TUI lines:`, tuiLines.map(line => line.content.substring(0, 100)));
		}
		
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
		// Add debug logging
		console.log(`${this.logPrefix} handleTerminalEvents called with ${events.length} events`);
		
		// Only process the latest screen state, not intermediate changes
		let latestScreenUpdate: TerminalEvent | null = null;
		let hasPatches = false;
		let hasNewLines = false;

		// Find the latest complete screen update or collect patches/newLines
		for (const event of events) {
			console.log(`${this.logPrefix} Processing event type: ${event.type}`);
			switch (event.type) {
				case "screenUpdate":
					latestScreenUpdate = event; // Use the latest screen update
					hasPatches = false; // Screen update supersedes patches
					hasNewLines = false; // Screen update supersedes new lines
					console.log(`${this.logPrefix} Found screenUpdate event with ${event.screen?.length || 0} lines`);
					break;
				case "patch":
					if (!latestScreenUpdate) hasPatches = true;
					console.log(`${this.logPrefix} Found patch event for line ${event.line}`);
					break;
				case "newLines":
					if (!latestScreenUpdate) hasNewLines = true;
					console.log(`${this.logPrefix} Found newLines event with ${event.lines?.length || 0} lines`);
					break;
			}
		}

		// Apply the final state
		if (latestScreenUpdate && latestScreenUpdate.screen) {
			console.log(`${this.logPrefix} Applying screenUpdate: ${latestScreenUpdate.screen.length} lines`);
			this.screenLines = [...latestScreenUpdate.screen];
		} else if (hasPatches || hasNewLines) {
			console.log(`${this.logPrefix} Applying patches/newLines: hasPatches=${hasPatches}, hasNewLines=${hasNewLines}`);
			// Only apply patches/newLines if no complete screen update
			for (const event of events) {
				switch (event.type) {
					case "newLines":
						if (event.lines) {
							console.log(`${this.logPrefix} Adding ${event.lines.length} new lines`);
							this.screenLines.push(...event.lines);
						}
						break;
					case "patch":
						if (event.line !== undefined && event.items) {
							console.log(`${this.logPrefix} Patching line ${event.line} with ${event.items.length} items`);
							while (this.screenLines.length <= event.line) {
								this.screenLines.push([]);
							}
							this.screenLines[event.line] = [...event.items];
						}
						break;
				}
			}
		}

		console.log(`${this.logPrefix} Final screenLines length: ${this.screenLines.length}`);
		
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

		console.log(this.logPrefix, "Checking if Claude Code is available...");
		// Check if claude is available
		await this.sendInputLines(this.terminalId, ["which claude"]);
		await this.delay(1000);
		console.log(this.logPrefix, "Sent 'which claude' command, waiting for response...");

		console.log(this.logPrefix, "Getting current working directory...");
		// Get the current working directory
		await this.sendInputLines(this.terminalId, ["pwd"]);
		await this.delay(500);
		console.log(this.logPrefix, "Sent 'pwd' command, waiting for response...");

		// Test if terminal is responding by sending a simple echo command
		console.log(this.logPrefix, "Testing terminal responsiveness with echo command...");
		await this.sendInputLines(this.terminalId, ["echo 'TERMINAL_TEST_SUCCESS'"]);
		await this.delay(1000);
		console.log(this.logPrefix, "Sent echo test command, waiting for response...");

		// Start Claude Code without prompt initially
		const claudeCommand = "claude";
		console.log(
			this.logPrefix,
			"Starting Claude Code with command:",
			claudeCommand,
		);
		await this.sendInputLines(this.terminalId, [claudeCommand]);
		console.log(this.logPrefix, "Sent 'claude' command, waiting for Claude Code to start...");

		console.log(this.logPrefix, "Claude Code command sent");
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
			console.log(`${this.logPrefix} R8: Cannot pause agent - no terminal (${!this.terminalId}) or already paused (${this.isPaused})`);
			return;
		}

		console.log(`${this.logPrefix} R8: Starting agent pause - sending escape sequences until interrupted`);
		await this.sendEscapeUntilInterrupted();
		this.isPaused = true;
		console.log(`${this.logPrefix} R8: Agent successfully paused - ready for manual control`);
		this.emit('agentPaused');
	}

	async resumeAgent(): Promise<void> {
		if (!this.terminalId || !this.isPaused) {
			console.log(`${this.logPrefix} R8: Cannot resume agent - no terminal (${!this.terminalId}) or not paused (${!this.isPaused})`);
			return;
		}

		console.log(`${this.logPrefix} R8: Resuming agent - sending continue prompt and enter`);
		await this.sendRawInput(this.terminalId, "continue");
		await this.delay(1000);
		await this.sendRawInput(this.terminalId, "\x0d"); // Send Enter
		this.isPaused = false;
		console.log(`${this.logPrefix} R8: Agent successfully resumed - continuing execution`);
		this.emit('agentResumed');
	}

	async queuePrompt(prompt: string): Promise<void> {
		if (!this.terminalId) {
			console.log(`${this.logPrefix} R5,R12: Cannot queue prompt - no terminal available`);
			throw new Error('No terminal available for queuing prompt');
		}

		console.log(`${this.logPrefix} R5,R12: Queuing prompt in existing Claude Code instance: ${prompt.substring(0, 50)}...`);
		console.log(`${this.logPrefix} R5,R12: This will be queued and processed after current task (multi-task support)`);

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

		console.log(`${this.logPrefix} R5,R12: Prompt successfully queued in Claude Code - task marked as running`);
		this.emit('promptQueued', { prompt });
	}

	async prepareManualCommit(): Promise<void> {
		console.log(`${this.logPrefix} R2,R9: Preparing for manual commit - terminal will remain alive`);
		// Don't send Ctrl+D - keep terminal alive
		console.log(`${this.logPrefix} R2,R9: No Ctrl+D sent - persistent terminal maintained until manual commit`);
		this.emit('readyForCommit');
	}

	private async sendEscapeUntilInterrupted(): Promise<void> {
		console.log(`${this.logPrefix} R6,Q8: Starting escape sequence - sending escape until proper interruption detected`);
		let attempts = 0;

		while (true) {
			await this.sendRawInput(this.terminalId!, "\x1b"); // ESC
			await this.delay(500);
			attempts++;

			let currentLines = this.getCurrentTuiLines();
			currentLines = currentLines.map((line) => ({ ...line, content: line.content.replaceAll(" ", " ") }));
			const hasInterrupted = currentLines.some(line =>
				line.content.includes("Interrupted by user")
			);
			const hasPrompt = currentLines.some(line =>
				line.content.includes("│ >")
			);

			console.log(`${this.logPrefix} R6,Q8: Attempt ${attempts} - Interrupted: ${hasInterrupted}, Prompt: ${hasPrompt}`);

			if (hasInterrupted && hasPrompt) {
				console.log(`${this.logPrefix} R6,Q8: Successfully interrupted after ${attempts} attempts - found both 'Interrupted by user' and '| >' prompt`);
				break;
			}

			if (attempts % 10 === 0) {
				console.log(`${this.logPrefix} R6,Q8: Escape attempt ${attempts}, continuing indefinitely until proper interruption (no timeout as specified)`);
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

		newLines = newLines.map((line) => line.replaceAll(" ", " "));
		console.log(this.logPrefix, "Processing TUI interactions with new lines:", newLines);

		// Check for "esc to interrupt" - do nothing
		const hasEscToInterrupt = newLines.some((line) =>
			line.includes("esc to interrupt"),
		);
		if (hasEscToInterrupt) {
			console.log(this.logPrefix, "Found 'esc to interrupt' - doing nothing");
			// send `x0d` and then delete
			// await this.sendRawInput(this.terminalId, "\x0d");
			// await this.delay(500);
			// await this.sendRawInput(this.terminalId, "\x08");
			return;
		}

		// Check for "│ > Try" prompt (first time only)
		const hasTryPrompt = newLines.some((line) => line.includes("│ >"));
		if (hasTryPrompt && !this.hasSeenTryPrompt && this.currentPrompt) {
			console.log(
				this.logPrefix,
				"Found 'Try' prompt, sending task prompt:",
				this.currentPrompt,
			);
			this.hasSeenTryPrompt = true;
			console.log(
				this.logPrefix,
				"R8: Set hasSeenTryPrompt = true, pause button should now appear"
			);
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
			// await this.sendRawInput(this.terminalId, "\x0d");
			return;
		}

		// Check for "Yes, and don't ask again this session (shift+tab)"
		const hasShiftTabOption = newLines.some((line) =>
			line.includes("1. Yes"),
		);
		if (hasShiftTabOption && !this.hasSeenTrustPrompt) {
			console.log(
				this.logPrefix,
				"Found '1. Yes'",
			);
			this.hasSeenTrustPrompt = true; // Prevent repeated processing
			await this.delay(1000);
			await this.sendRawInput(this.terminalId, "\x0d");
			return;
		}
		
		// Add debug logging for unhandled content
		console.log(this.logPrefix, "No recognized patterns found in TUI lines:", newLines);
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Check if a task is currently running and a prompt has been sent
	 * Pause button should only show if agent is running AND we've sent the prompt
	 */
	isTaskRunning(): boolean {
		const result = this.isRunning && this.hasSeenTryPrompt;
		console.log(`${this.logPrefix} R8: isTaskRunning check - isRunning: ${this.isRunning}, hasSeenTryPrompt: ${this.hasSeenTryPrompt}, result: ${result}`);
		return result;
	}

	/**
	 * Check if agent is available to accept new prompts (terminal alive and ready)
	 * Used to determine if we should queue prompts or create new agent
	 */
	isAgentAvailable(): boolean {
		const result = !!this.terminalId && !this.isCompletingTask;
		console.log(`${this.logPrefix} R2,R9: isAgentAvailable check - terminalId: ${!!this.terminalId}, isCompletingTask: ${this.isCompletingTask}, result: ${result}`);
		return result;
	}

	/**
	 * Reset task state after manual commit
	 * Called when tasks are committed manually via the commit button
	 */
	resetAfterCommit(): void {
		console.log(`${this.logPrefix} R10: Resetting agent state after manual commit`);
		this.isRunning = false;
		this.hasSeenTryPrompt = false;
		this.currentTask = null;
		this.currentPrompt = null;
		this.isManuallyControlled = true; // Keep terminal alive but mark as manually controlled
		console.log(`${this.logPrefix} R2,R9: Agent reset but terminal remains alive`);
	}
}
