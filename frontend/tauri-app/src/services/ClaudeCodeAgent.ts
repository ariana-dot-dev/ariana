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
	private startTime: number = 0;
	private logPrefix: string;
	private hasSeenTryPrompt = false;
	private hasSeenTrustPrompt = false;
	private isProcessingEvents = false;
	private eventQueue: TerminalEvent[][] = [];
	private lastActivityTime: number = 0;
	private completionTimeoutId: NodeJS.Timeout | null = null;
	private osSession: OsSession | null = null;
	private isCompletingTask: boolean = false;

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
		console.log(`${this.logPrefix} Starting cleanup...`);
		
		if (this.terminalId) {
			try {
				console.log(`${this.logPrefix} Killing terminal ${this.terminalId}`);
				await this.killTerminal(this.terminalId);
			} catch (error) {
				console.error(`${this.logPrefix} Error killing terminal:`, error);
			}
		}

		console.log(`${this.logPrefix} Calling super.cleanup()`);
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
		this.isCompletingTask = false;
		
		if (this.completionTimeoutId) {
			clearTimeout(this.completionTimeoutId);
			this.completionTimeoutId = null;
		}
		
		this.removeAllListeners();
		console.log(`${this.logPrefix} Cleanup completed`);
	}

	// Private methods

	private setupTerminalListeners(): void {
		if (!this.terminalId) return;

		try {
			this.onTerminalEvent(this.terminalId, (events: TerminalEvent[]) => {
				// Remove excessive logging that causes performance issues
				this.queueEventBatch(events);
			});
		} catch (error) {
			console.error(this.logPrefix, "❌ Error setting up ClaudeCodeAgent event listener:", error);
		}
	}

	private queueEventBatch(events: TerminalEvent[]): void {
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
		for (const event of events) {
			switch (event.type) {
				case "screenUpdate":
					if (event.screen) {
						this.screenLines = [...event.screen];
					}
					break;

				case "newLines":
					if (event.lines) {
						this.screenLines.push(...event.lines);
					}
					break;

				case "patch":
					if (event.line !== undefined && event.items) {
						// Ensure we have enough lines
						while (this.screenLines.length <= event.line) {
							this.screenLines.push([]);
						}
						this.screenLines[event.line] = [...event.items];
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

		console.log(this.logPrefix, "Getting current working directory...");
		// Get the current working directory
		await this.sendInputLines(this.terminalId, ["pwd"]);
		await this.delay(500);

		// Start Claude Code without prompt initially
		const claudeCommand = "claude";
		console.log(
			this.logPrefix,
			"Starting Claude Code with command:",
			claudeCommand,
		);
		await this.sendInputLines(this.terminalId, [claudeCommand]);

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

	private resetCompletionTimeout(): void {
		if (this.completionTimeoutId) {
			clearTimeout(this.completionTimeoutId);
		}

		// Only set timeout if we've seen the Try prompt and aren't already completing
		if (this.hasSeenTryPrompt && !this.isCompletingTask) {
			this.completionTimeoutId = setTimeout(() => {
				this.handleTaskCompletion();
			}, 5000); // 5 seconds of inactivity
		}
	}

	private async handleTaskCompletion(): Promise<void> {
		if (!this.terminalId || !this.hasSeenTryPrompt || this.isCompletingTask) {
			console.log(this.logPrefix, `Skipping task completion - terminalId: ${this.terminalId}, hasSeenTryPrompt: ${this.hasSeenTryPrompt}, isCompletingTask: ${this.isCompletingTask}`);
			return;
		}

		this.isCompletingTask = true;

		console.log(
			this.logPrefix,
			"Task appears to be complete after 5 seconds of inactivity, draining event queue...",
		);

		// Wait for any pending events to be processed
		let drainAttempts = 0;
		const maxDrainAttempts = 50; // 5 seconds max
		while (this.eventQueue.length > 0 && drainAttempts < maxDrainAttempts) {
			console.log(this.logPrefix, `Draining events, queue length: ${this.eventQueue.length}, attempt: ${drainAttempts + 1}`);
			await this.delay(100);
			drainAttempts++;
		}
		
		// Force process any remaining events
		if (this.eventQueue.length > 0) {
			console.warn(this.logPrefix, `Forcing final event processing, ${this.eventQueue.length} events remaining`);
			await this.processEventQueue();
		}

		console.log(this.logPrefix, "Event queue drained, sending Ctrl+D...");

		try {
			await this.sendCtrlD(this.terminalId);
			await this.delay(Math.random() * 50 + 50);
			await this.sendCtrlD(this.terminalId);
			await this.delay(Math.random() * 50 + 50);
			await this.sendCtrlD(this.terminalId);
			await this.delay(Math.random() * 50 + 50);
			await this.sendCtrlD(this.terminalId);

			// Additional delay to let terminal settle after Ctrl+D
			console.log(this.logPrefix, "Waiting for terminal to settle...");
			await this.delay(2000);

			const elapsed = Date.now() - this.startTime;
			
			// Create git commit as part of task completion
			let commitHash = "";
			if (this.osSession && this.currentPrompt) {
				try {
					// Add delay to ensure file system operations complete
					await this.delay(1000);
					
					const { GitService } = await import('./GitService');
					console.log(this.logPrefix, `Attempting to commit changes...`);
					commitHash = await GitService.createCommit(this.osSession, this.currentPrompt);
					console.log(this.logPrefix, `Successfully created commit: ${commitHash}`);
				} catch (error) {
					const errorString = String(error);
					console.log(this.logPrefix, `Git commit error: ${errorString}`);
					
					if (errorString === "NO_CHANGES_TO_COMMIT" || errorString.toLowerCase().includes("nothing to commit")) {
						// Check if there are actually changes that weren't detected
						console.warn(this.logPrefix, "Git reports no changes but task completed - possible timing issue");
						commitHash = "NO_CHANGES";
					} else {
						// Real git error - this indicates a repository or git configuration problem
						console.error(this.logPrefix, "Git commit failed with error:", error);
						
						// Check for common git repository issues
						if (errorString.includes("unknown revision") || 
						    errorString.includes("ambiguous argument") || 
						    errorString.includes("not a git repository") ||
						    errorString.includes("detected dubious ownership")) {
							this.emit("taskError", new Error(`Cannot complete task: Git repository error - ${errorString}`));
							return;
						}
						
						// For other git errors, log but don't fail the task
						console.error(this.logPrefix, `Git error (non-fatal): ${errorString}`);
						commitHash = "GIT_ERROR";
					}
				}
			}

			this.emit("taskCompleted", {
				prompt: this.currentPrompt,
				elapsed,
				commitHash
			});
			
			// Critical: Clean up terminal and event listeners after completion
			console.log(this.logPrefix, "Task completed, starting cleanup...");
			await this.cleanup();
		} catch (error) {
			console.error(
				this.logPrefix,
				"Error sending completion sequence:",
				error,
			);
			this.isCompletingTask = false;
			// Also cleanup on error to prevent resource leaks
			await this.cleanup();
		}
	}

	private async processTuiInteraction(tuiLines: TuiLine[]): Promise<void> {
		if (!this.terminalId) return;

		// Extract all new line content from the events
		let newLines: string[] = tuiLines.map((tuiLine) => tuiLine.content);

		newLines = newLines.map((line) => line.replaceAll(" ", " "));

		// Check for "Yes, and don't ask again this session (shift+tab)"
		const hasShiftTabOption = newLines.some((line) =>
			line.includes("1. Yes"),
		);
		if (hasShiftTabOption) {
			console.log(
				this.logPrefix,
				"Found '1. Yes'",
			);
			await this.delay(1000);
			await this.sendRawInput(this.terminalId, "\x0d");
			// await this.sendRawInput(this.terminalId, "\r");
			// await this.sendRawInput(this.terminalId, "\r");
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

		// Check for "esc to interrupt" - do nothing
		const hasEscToInterrupt = newLines.some((line) =>
			line.includes("esc to interrupt"),
		);
		if (hasEscToInterrupt) {
			// send `x0d` and then delete
			// await this.sendRawInput(this.terminalId, "\x0d");
			// await this.delay(500);
			// await this.sendRawInput(this.terminalId, "\x08");
			return;
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
