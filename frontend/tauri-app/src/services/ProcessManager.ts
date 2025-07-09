/**
 * Global process manager that survives React component unmount/remount cycles
 * Focused solely on runtime process instance tracking (not persistence)
 * Maps processId -> active process instances (like ClaudeCodeAgent)
 */
export class ProcessManager {
	private static activeProcesses = new Map<string, any>(); // processId -> actual process instance (ClaudeCodeAgent, etc)
	private static terminalConnections = new Map<string, string>(); // elementId -> terminalId for UI restore

	/**
	 * Register a running process instance (e.g., ClaudeCodeAgent)
	 * This is for runtime tracking only, not for persistence
	 */
	static registerProcess(processId: string, processInstance: any): void {
		console.log('[ProcessManager] Registering process:', processId, processInstance.constructor?.name);
		this.activeProcesses.set(processId, processInstance);
	}

	/**
	 * Get a running process instance by ID
	 * Returns null if process is not currently running
	 */
	static getProcess(processId: string): any {
		return this.activeProcesses.get(processId) || null;
	}

	/**
	 * Remove a process when it completes or stops
	 */
	static unregisterProcess(processId: string): void {
		console.log('[ProcessManager] Unregistering process:', processId);
		this.activeProcesses.delete(processId);
	}

	/**
	 * Check if a process instance is currently active and running
	 */
	static isProcessRunning(processId: string): boolean {
		const process = this.activeProcesses.get(processId);
		if (!process) return false;
		
		// Check if it's a ClaudeCodeAgent with isTaskRunning method
		if (typeof process.isTaskRunning === 'function') {
			return process.isTaskRunning();
		}
		
		// Check legacy isRunning property
		if (process.isRunning !== undefined) {
			return process.isRunning;
		}
		
		// If registered but no status info, assume running
		return true;
	}

	/**
	 * Associate a terminal connection with an element for UI restoration
	 * This helps restore terminal views when components remount
	 */
	static setTerminalConnection(elementId: string, terminalId: string): void {
		console.log('[ProcessManager] Setting terminal connection:', elementId, '->', terminalId);
		this.terminalConnections.set(elementId, terminalId);
	}

	/**
	 * Get terminal ID associated with an element
	 */
	static getTerminalConnection(elementId: string): string | undefined {
		return this.terminalConnections.get(elementId);
	}

	/**
	 * Remove terminal connection when element is destroyed
	 */
	static removeTerminalConnection(elementId: string): void {
		console.log('[ProcessManager] Removing terminal connection:', elementId);
		this.terminalConnections.delete(elementId);
	}

	/**
	 * Get all currently active process IDs
	 */
	static getActiveProcessIds(): string[] {
		return Array.from(this.activeProcesses.keys());
	}

	/**
	 * Cleanup dead/completed processes from memory
	 * Should be called periodically to prevent memory leaks
	 */
	static cleanup(): void {
		const toRemove: string[] = [];
		
		for (const [processId, process] of this.activeProcesses.entries()) {
			if (!this.isProcessRunning(processId)) {
				console.log('[ProcessManager] Marking dead process for cleanup:', processId);
				toRemove.push(processId);
			}
		}
		
		toRemove.forEach(processId => {
			this.unregisterProcess(processId);
		});
		
		console.log('[ProcessManager] Cleanup complete. Removed', toRemove.length, 'dead processes');
	}

	/**
	 * Get debug info about current state
	 */
	static getDebugInfo(): { activeProcesses: number; terminalConnections: number } {
		return {
			activeProcesses: this.activeProcesses.size,
			terminalConnections: this.terminalConnections.size
		};
	}

	/**
	 * Log memory usage periodically
	 */
	static startMemoryLogging(): void {
		// Disabled to reduce console spam
		// setInterval(() => {
		//   console.log(`[MEMORY] ProcessManager:`);
		//   console.log(`  - active processes: ${this.activeProcesses.size}`);
		//   console.log(`  - terminal connections: ${this.terminalConnections.size}`);
		// }, 5000);
	}
}