import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { OsSession } from "../bindings/os";

export interface TerminalKind {
	$type: "ssh" | "git-bash" | "wsl";
	host?: string;
	username?: string;
	port?: number;
	workingDirectory?: string;
	distribution?: string;
}

export interface TerminalSpec {
	kind: TerminalKind;
	workingDir?: string;
	shellCommand?: string;
	environment?: Record<string, string>;
	lines: number;
	cols: number;
}

export interface Color {
	Black?: never;
	Red?: never;
	Green?: never;
	Yellow?: never;
	Blue?: never;
	Magenta?: never;
	Cyan?: never;
	White?: never;
	BrightBlack?: never;
	BrightRed?: never;
	BrightGreen?: never;
	BrightYellow?: never;
	BrightBlue?: never;
	BrightMagenta?: never;
	BrightCyan?: never;
	BrightWhite?: never;
	Extended?: number;
}

export interface LineItem {
	lexeme: string;
	width: number;
	is_underline: boolean;
	is_bold: boolean;
	is_italic: boolean;
	background_color?: Color;
	foreground_color?: Color;
}

export function defaultLineItem(): LineItem {
	return {
		lexeme: "",
		width: 1,
		is_underline: false,
		is_bold: false,
		is_italic: false,
	};
}

export type ScrollDirection = "Up" | "Down";

export interface TerminalEvent {
	type: "screenUpdate" | "cursorMove" | "patch" | "newLines";
	lines?: LineItem[][];
	line?: number;
	col?: number;
	items?: LineItem[];
	direction?: ScrollDirection;
	amount?: number;
	screen?: LineItem[][];
	cursor_line?: number;
	cursor_col?: number;
	metadata?: {
		sessionId?: string;
		[key: string]: any;
	};
}

export class CustomTerminalAPI {
	protected eventListeners = new Map<string, UnlistenFn[]>();
	protected disconnectListeners = new Map<string, UnlistenFn[]>();
	protected terminalId: string | null = null;
	protected isConnected: boolean = false;

	/**
	 * Connect to a terminal by specification
	 */
	async connectTerminal(osSession: OsSession): Promise<string> {
		try {
			const terminalId = await invoke<string>("custom_connect_terminal", {
				osSession,
			});
			this.terminalId = terminalId;
			this.isConnected = true;
			return terminalId;
		} catch (error) {
			throw new Error(`Failed to connect terminal: ${error}`);
		}
	}

	/**
	 * Kill a terminal by ID
	 */
	async killTerminal(id: string): Promise<void> {
		try {
			// Clean up all event listeners for this terminal
			const eventListeners = this.eventListeners.get(id);
			if (eventListeners) {
				eventListeners.forEach(unlisten => unlisten());
				this.eventListeners.delete(id);
			}

			const disconnectListeners = this.disconnectListeners.get(id);
			if (disconnectListeners) {
				disconnectListeners.forEach(unlisten => unlisten());
				this.disconnectListeners.delete(id);
			}

			await invoke("custom_kill_terminal", { id });

			if (this.terminalId === id) {
				this.terminalId = null;
				this.isConnected = false;
			}
		} catch (error) {
			throw new Error(`Failed to kill terminal: ${error}`);
		}
	}

	/**
	 * Send input lines as a vector of strings to a terminal
	 * Lines are joined with backslashes for multi-line commands
	 */
	async sendInputLines(id: string, lines: string[]): Promise<void> {
		try {
			await invoke("custom_send_input_lines", { id, lines });
		} catch (error) {
			throw new Error(`Failed to send input lines: ${error}`);
		}
	}

	/**
	 * Send raw input data directly to terminal
	 */
	async sendRawInput(id: string, data: string): Promise<void> {
		try {
			await invoke("custom_send_raw_input", { id, data });
		} catch (error) {
			throw new Error(`Failed to send raw input: ${error}`);
		}
	}

	/**
	 * Listen to terminal events (new lines, patches, cursor moves, scroll)
	 * Now supports multiple listeners per terminal
	 */
	async onTerminalEvent(
		id: string,
		callback: (events: TerminalEvent[]) => void, // Expect an array of events
	): Promise<void> {
		try {
			// Get existing listeners array or create new one
			let listeners = this.eventListeners.get(id) || [];
			const listenerCount = listeners.length;
			
			console.log(`[CustomTerminalAPI] Adding event listener for terminal ${id} (current: ${listenerCount})`);

			// Listen for an array of TerminalEvent
			const unlisten = await listen<TerminalEvent[]>(
				`custom-terminal-event-${id}`,
				(event) => {
					try {
						// The payload is now an array of events
						callback(event.payload);
					} catch (error) {
						console.error(`[CustomTerminalAPI] ❌ Callback execution failed for ${id}:`, error);
					}
				},
			);

			// Add the new listener to the array
			listeners.push(unlisten);
			this.eventListeners.set(id, listeners);
			
			console.log(`[CustomTerminalAPI] ✅ Event listener added for ${id} (total: ${listeners.length})`);
		} catch (error) {
			console.error(`[CustomTerminalAPI] ❌ Failed to add terminal event listener for ${id}:`, error);
			throw new Error(`Failed to set up terminal event listener: ${error}`);
		}
	}

	/**
	 * Listen to terminal disconnect events
	 * Now supports multiple listeners per terminal
	 */
	async onTerminalDisconnect(id: string, callback: () => void): Promise<void> {
		try {
			// Get existing listeners array or create new one
			let listeners = this.disconnectListeners.get(id) || [];

			const unlisten = await listen(`custom-terminal-disconnect-${id}`, () => {
				callback();
			});

			// Add the new listener to the array
			listeners.push(unlisten);
			this.disconnectListeners.set(id, listeners);
		} catch (error) {
			throw new Error(
				`Failed to set up terminal disconnect listener: ${error}`,
			);
		}
	}

	/**
	 * Resize terminal to specified lines and columns
	 */
	async resizeTerminal(id: string, lines: number, cols: number): Promise<void> {
		try {
			await invoke("custom_resize_terminal", { id, lines, cols });
		} catch (error) {
			throw new Error(`Failed to resize terminal: ${error}`);
		}
	}

	/**
	 * Send Ctrl+C signal
	 */
	async sendCtrlC(id: string): Promise<void> {
		try {
			await invoke("custom_send_ctrl_c", { id });
		} catch (error) {
			throw new Error(`Failed to send Ctrl+C: ${error}`);
		}
	}

	/**
	 * Send Ctrl+D signal
	 */
	async sendCtrlD(id: string): Promise<void> {
		try {
			await invoke("custom_send_ctrl_d", { id });
		} catch (error) {
			throw new Error(`Failed to send Ctrl+D: ${error}`);
		}
	}

	/**
	 * Send scroll up signal
	 */
	async sendScrollUp(id: string, amount: number): Promise<void> {
		try {
			await invoke("custom_send_scroll_up", { id, amount });
		} catch (error) {
			throw new Error(`Failed to send scroll up: ${error}`);
		}
	}

	/**
	 * Send scroll down signal
	 */
	async sendScrollDown(id: string, amount: number): Promise<void> {
		try {
			await invoke("custom_send_scroll_down", { id, amount });
		} catch (error) {
			throw new Error(`Failed to send scroll down: ${error}`);
		}
	}

	/**
	 * Cleanup all event listeners
	 */
	cleanup(): void {
		// Clean up all event listeners
		for (const listeners of this.eventListeners.values()) {
			listeners.forEach(unlisten => unlisten());
		}
		// Clean up all disconnect listeners
		for (const listeners of this.disconnectListeners.values()) {
			listeners.forEach(unlisten => unlisten());
		}
		this.eventListeners.clear();
		this.disconnectListeners.clear();
		this.terminalId = null;
		this.isConnected = false;
	}

	/**
	 * Get the current terminal ID
	 */
	getTerminalId(): string | null {
		return this.terminalId;
	}

	/**
	 * Check if terminal is connected
	 */
	getIsConnected(): boolean {
		return this.isConnected;
	}
}

// Export singleton instance
export const customTerminalAPI = new CustomTerminalAPI();

// Utility functions for working with colors
export const Colors = {
	Black: "Black" as const,
	Red: "Red" as const,
	Green: "Green" as const,
	Yellow: "Yellow" as const,
	Blue: "Blue" as const,
	Magenta: "Magenta" as const,
	Cyan: "Cyan" as const,
	White: "White" as const,
	BrightBlack: "BrightBlack" as const,
	BrightRed: "BrightRed" as const,
	BrightGreen: "BrightGreen" as const,
	BrightYellow: "BrightYellow" as const,
	BrightBlue: "BrightBlue" as const,
	BrightMagenta: "BrightMagenta" as const,
	BrightCyan: "BrightCyan" as const,
	BrightWhite: "BrightWhite" as const,
	Extended: (value: number) => ({ Extended: value }),
} as const;

// Helper functions for creating terminal specifications
export const TerminalSpecs = {
	ssh: (
		host: string,
		username: string,
		port = 22,
		options: Partial<TerminalSpec> = {},
	): TerminalSpec => ({
		kind: { $type: "ssh", host, username, port },
		lines: 10,
		cols: 80,
		...options,
	}),

	gitBash: (
		workingDirectory?: string,
		options: Partial<TerminalSpec> = {},
	): TerminalSpec => ({
		kind: { $type: "git-bash", workingDirectory },
		lines: 10,
		cols: 80,
		...options,
	}),

	wsl: (
		distribution?: string,
		workingDirectory?: string,
		options: Partial<TerminalSpec> = {},
	): TerminalSpec => ({
		kind: { $type: "wsl", distribution, workingDirectory },
		lines: 10,
		cols: 80,
		...options,
	}),
};
