import { BackgroundAgent, BackgroundAgentType, MergeAgent, MergeAgentContext, MergeResult } from "../types/BackgroundAgent";
import { OsSession, osSessionGetWorkingDirectory } from "../bindings/os";
import type { GitProject } from "../types/GitProject";

export class BackgroundAgentManager {
	private static cleanupTimers = new Map<string, NodeJS.Timeout>();
	private static readonly CLEANUP_DELAY_MS = 20000; // 20 seconds
	private static persistenceCallback: ((projectId: string) => void) | null = null;

	/**
	 * Initialize automatic cleanup for all existing agents in a GitProject
	 * Call this when the app starts or when a GitProject is loaded
	 */
	static initializeCleanupMonitoring(gitProject: GitProject): void {
		console.log(`[BackgroundAgentManager] Initializing cleanup monitoring for ${gitProject.backgroundAgents.length} agents in project ${gitProject.name}`);
		
		gitProject.backgroundAgents.forEach(agent => {
			console.log(`[BackgroundAgentManager] Agent ${agent.id.slice(0, 8)} (${agent.type}): status=${agent.status}, terminal=${this.isTerminalState(agent.status)}`);
			
			if (this.isTerminalState(agent.status)) {
				// Agent is already in terminal state, schedule immediate cleanup
				console.log(`[BackgroundAgentManager] Agent ${agent.id.slice(0, 8)} is in terminal state, scheduling cleanup`);
				this.scheduleAgentCleanup(agent.id, gitProject);
			} else {
				// Agent is still active, set up monitoring
				console.log(`[BackgroundAgentManager] Agent ${agent.id.slice(0, 8)} is active, setting up monitoring`);
				this.setupAgentMonitoring(agent, gitProject);
			}
		});
	}
	/**
	 * Check if an agent is in a terminal state and should be scheduled for cleanup
	 */
	private static isTerminalState(status: string): boolean {
		return ['completed', 'failed', 'cancelled'].includes(status);
	}

	/**
	 * Schedule an agent for automatic cleanup after the delay
	 */
	private static scheduleAgentCleanup(agentId: string, gitProject: GitProject): void {
		// Cancel any existing cleanup timer for this agent
		this.cancelCleanupTimer(agentId);

		console.log(`[BackgroundAgentManager] Scheduling cleanup for agent ${agentId.slice(0, 8)} in ${this.CLEANUP_DELAY_MS}ms`);
		
		const timer = setTimeout(async () => {
			try {
				const agent = gitProject.getBackgroundAgent(agentId);
				console.log(`[BackgroundAgentManager] Cleanup timer triggered for agent ${agentId.slice(0, 8)}, agent exists: ${!!agent}, status: ${agent?.status}`);
				
				if (agent && this.isTerminalState(agent.status)) {
					console.log(`[BackgroundAgentManager] Auto-removing completed agent ${agentId.slice(0, 8)} (${agent.type}/${agent.status})`);
					await this.cancelAgent(agentId, gitProject);
					
					// CRITICAL FIX: Trigger persistence after timer-based cleanup
					// This ensures removed agents don't reappear after app restart
					console.log(`[BackgroundAgentManager] Triggering persistence for timer cleanup of agent ${agentId.slice(0, 8)}`);
					this.triggerPersistence(gitProject);
				} else {
					console.log(`[BackgroundAgentManager] Skipping cleanup for agent ${agentId.slice(0, 8)} - agent not found or not in terminal state`);
				}
			} catch (error) {
				console.error(`[BackgroundAgentManager] Error during auto-cleanup of agent ${agentId.slice(0, 8)}:`, error);
			} finally {
				this.cleanupTimers.delete(agentId);
			}
		}, this.CLEANUP_DELAY_MS);

		this.cleanupTimers.set(agentId, timer);
		console.log(`[BackgroundAgentManager] Timer set for agent ${agentId.slice(0, 8)}, total active timers: ${this.cleanupTimers.size}`);
	}

	/**
	 * Cancel a scheduled cleanup timer for an agent
	 */
	private static cancelCleanupTimer(agentId: string): void {
		const timer = this.cleanupTimers.get(agentId);
		if (timer) {
			clearTimeout(timer);
			this.cleanupTimers.delete(agentId);
			console.log(`[BackgroundAgentManager] Cancelled cleanup timer for agent ${agentId}`);
		}
	}

	/**
	 * Set up automatic cleanup monitoring for an agent
	 */
	private static setupAgentMonitoring(agent: BackgroundAgent, gitProject: GitProject): void {
		// Subscribe to status changes
		const unsubscribe = agent.subscribe(() => {
			if (this.isTerminalState(agent.status)) {
				// Agent reached terminal state, schedule cleanup
				this.scheduleAgentCleanup(agent.id, gitProject);
				// Unsubscribe since we only need to detect the first terminal state
				unsubscribe();
			}
		});
	}

	/**
	 * Called automatically when an agent status changes to handle cleanup
	 * This should be called by the agent itself when updateStatus is called
	 */
	static onAgentStatusChanged(agent: BackgroundAgent, gitProject: GitProject): void {
		if (this.isTerminalState(agent.status)) {
			console.log(`[BackgroundAgentManager] Agent ${agent.id.slice(0, 8)} reached terminal state (${agent.status}), scheduling cleanup`);
			this.scheduleAgentCleanup(agent.id, gitProject);
		}
	}

	/**
	 * Check if there are any running agents of the same type that require serialization
	 */
	private static hasRunningSerializedAgent(agentType: BackgroundAgentType, gitProject: GitProject): boolean {
		const runningAgents = gitProject.backgroundAgents.filter(agent => 
			agent.type === agentType && 
			agent.requiresSerialization &&
			['preparation', 'running'].includes(agent.status)
		);
		
		if (runningAgents.length > 0) {
			console.log(`[BackgroundAgentManager] Found ${runningAgents.length} running ${agentType} agents:`, 
				runningAgents.map(a => `${a.id} (${a.status})`));
		}
		
		return runningAgents.length > 0;
	}

	/**
	 * Start the next queued agent of the same type if any exist
	 */
	private static startNextQueuedAgent(agentType: BackgroundAgentType, gitProject: GitProject): void {
		const nextAgent = gitProject.backgroundAgents.find(agent => 
			agent.type === agentType && 
			agent.requiresSerialization &&
			agent.status === 'queued'
		);

		if (nextAgent) {
			console.log(`[BackgroundAgentManager] Starting next queued ${agentType} agent:`, nextAgent.id);
			this.executeAgent(nextAgent, gitProject, (nextAgent as any).context.canvasId).catch(error => {
				console.error(`[BackgroundAgentManager] Queued agent ${nextAgent.id} failed:`, error);
				nextAgent.updateStatus('failed', undefined, error.message);
				if ((nextAgent as any).context?.canvasId) {
					gitProject.unlockCanvas((nextAgent as any).context.canvasId, nextAgent.id);
				}
			});
		}
	}

	/**
	 * Create a merge agent to merge canvas changes back to root
	 */
	static async createMergeAgent(
		rootOsSession: OsSession,
		canvasOsSession: OsSession,
		canvasId: string,
		allHistoricalPrompts: string[],
		gitProject: GitProject
	): Promise<string> {
		const agentId = crypto.randomUUID();
		
		// Create isolated workspace for merge operations
		const workspaceOsSession = await this.createIsolatedWorkspace(rootOsSession);

		// Build merge context
		const context: MergeAgentContext = {
			rootOsSession,
			canvasOsSession,
			canvasId,
			originalRootBranch: gitProject.getOriginalRootBranch(),
			conflictFiles: [],
			maxRetries: 3,
			currentRetry: 0,
			allHistoricalPrompts
		};

		// Check if another merge agent is already running BEFORE creating new agent
		console.log(`[BackgroundAgentManager] Checking for running merge agents. Current agents:`, 
			gitProject.backgroundAgents.map(a => `${a.id.slice(0, 8)} (${a.type}/${a.status})`));
		
		const shouldQueue = this.hasRunningSerializedAgent('merge', gitProject);
		
		// Create merge agent
		const agent = new MergeAgent(agentId, workspaceOsSession, context);
		
		// Add to GitProject
		gitProject.addBackgroundAgent(agent);
		
		// Set up automatic cleanup monitoring
		this.setupAgentMonitoring(agent, gitProject);
		
		if (shouldQueue) {
			console.log(`[BackgroundAgentManager] Merge agent ${agentId} queued - another merge is in progress`);
			agent.updateStatus('queued', 'Waiting for other merge operations to complete...');
			return agentId;
		}

		// Lock canvas during merge
		const lockSuccess = gitProject.lockCanvas(canvasId, 'merging', agentId);
		if (!lockSuccess) {
			throw new Error(`Failed to lock canvas ${canvasId} for merging`);
		}

		// Start agent execution asynchronously
		this.executeAgent(agent, gitProject, canvasId).catch(error => {
			console.error(`[BackgroundAgentManager] Agent ${agentId} failed:`, error);
			agent.updateStatus('failed', undefined, error.message);
			gitProject.unlockCanvas(canvasId, agentId);
		});

		return agentId;
	}

	/**
	 * Execute the agent through its lifecycle phases
	 */
	private static async executeAgent(agent: BackgroundAgent, gitProject: GitProject, canvasId: string): Promise<void> {
		try {
			console.log(`[BackgroundAgentManager] Starting agent ${agent.id} execution`);

			// Phase 1: Preparation
			await agent.prepare();
			
			// Phase 2-3: Check and resolve loop
			let checkResult = await agent.checkCompletion();
			
			while (!checkResult.isComplete && agent.context.currentRetry < agent.context.maxRetries) {
				agent.checkCancellation(); // Respect cancellation
				
				// Phase 3: Run agent to make progress
				await agent.runAgent(checkResult.retryContext);
				
				// Check completion again
				checkResult = await agent.checkCompletion();
			}

			if (!checkResult.isComplete) {
				throw new Error(`Agent failed to complete after ${agent.context.maxRetries} attempts`);
			}

			// Phase 4: Cleanup and finalization
			await agent.cleanup();
			
			// Update canvas state to merged
			gitProject.lockCanvas(canvasId, 'merged', agent.id);
			console.log(`[BackgroundAgentManager] Agent ${agent.id} completed successfully`);

			// Schedule automatic cleanup for completed agent
			this.onAgentStatusChanged(agent, gitProject);

			// Start next queued agent of the same type if any
			if (agent.requiresSerialization) {
				this.startNextQueuedAgent(agent.type, gitProject);
			}

		} catch (error: any) {
			if (agent.cancellationToken.isCancelled) {
				console.log(`[BackgroundAgentManager] Agent ${agent.id} was cancelled`);
				agent.updateStatus('cancelled');
			} else {
				console.error(`[BackgroundAgentManager] Agent ${agent.id} failed:`, error);
				agent.updateStatus('failed', undefined, error.message);
			}

			// Schedule automatic cleanup for failed/cancelled agent
			this.onAgentStatusChanged(agent, gitProject);
			
			// Unlock canvas on failure/cancellation
			gitProject.unlockCanvas(canvasId, agent.id);
			
			// Cleanup workspace
			await this.cleanupWorkspace(agent.workspaceOsSession);

			// Start next queued agent of the same type if any
			if (agent.requiresSerialization) {
				this.startNextQueuedAgent(agent.type, gitProject);
			}
		}
	}

	/**
	 * Cancel and remove an agent
	 */
	static async cancelAgent(agentId: string, gitProject: GitProject): Promise<void> {
		const agent = gitProject.getBackgroundAgent(agentId);
		if (!agent) return;

		// Cancel any pending cleanup timer
		this.cancelCleanupTimer(agentId);

		// Only cancel if agent is not already in a final state
		if (!['completed', 'failed', 'cancelled'].includes(agent.status)) {
			// Cancel the agent
			agent.cancel();

			// Unlock any locked canvases for non-completed agents
			gitProject.canvases.forEach(canvas => {
				if (canvas.lockingAgentId === agentId) {
					gitProject.unlockCanvas(canvas.id, agentId);
				}
			});
		} else {
			// For completed agents, preserve the canvas state and just clean up
			console.log(`[BackgroundAgentManager] Removing completed agent ${agentId} without state changes`);
		}

		// Cleanup workspace
		await this.cleanupWorkspace(agent.workspaceOsSession);

		// Start next queued agent of the same type if any
		if (agent.requiresSerialization) {
			this.startNextQueuedAgent(agent.type, gitProject);
		}

		// Remove from GitProject
		gitProject.removeBackgroundAgent(agentId);

		console.log(`[BackgroundAgentManager] Agent ${agentId} removed`);
	}

	/**
	 * Create isolated workspace for agent operations
	 */
	private static async createIsolatedWorkspace(rootOsSession: OsSession): Promise<OsSession> {
		const rootDir = osSessionGetWorkingDirectory(rootOsSession);
		if (!rootDir) {
			throw new Error("Could not determine root directory for workspace creation");
		}

		const { CanvasService } = await import('./CanvasService');
		const randomId = CanvasService.generateRandomId();
		
		let workspaceOsSession: OsSession;
		
		if ('Local' in rootOsSession) {
			const separator = rootDir.includes('/') ? '/' : '\\';
			const parentDir = rootDir.substring(0, rootDir.lastIndexOf(separator));
			const rootDirName = rootDir.substring(rootDir.lastIndexOf(separator) + 1);
			const workspaceDir = `${parentDir}${separator}${rootDirName}-agent-${randomId}`;
			workspaceOsSession = { Local: workspaceDir };
		} else if ('Wsl' in rootOsSession) {
			const parentDir = rootDir.substring(0, rootDir.lastIndexOf('/'));
			const rootDirName = rootDir.substring(rootDir.lastIndexOf('/') + 1);
			const workspaceDir = `${parentDir}/${rootDirName}-agent-${randomId}`;
			workspaceOsSession = {
				Wsl: {
					distribution: rootOsSession.Wsl.distribution,
					working_directory: workspaceDir
				}
			};
		} else {
			throw new Error("Unknown OS session type for workspace creation");
		}

		return workspaceOsSession;
	}

	/**
	 * Cleanup agent workspace
	 */
	private static async cleanupWorkspace(workspaceOsSession: OsSession): Promise<void> {
		try {
			const workspaceDir = osSessionGetWorkingDirectory(workspaceOsSession);
			if (!workspaceDir) return;

			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('delete_path_with_os_session', {
				path: workspaceDir,
				osSession: workspaceOsSession
			});

			console.log(`[BackgroundAgentManager] Cleaned up workspace: ${workspaceDir}`);
		} catch (error) {
			console.warn(`[BackgroundAgentManager] Failed to cleanup workspace:`, error);
		}
	}

	/**
	 * Set persistence callback for automatic saves after timer-based cleanup
	 */
	static setPersistenceCallback(callback: (projectId: string) => void): void {
		this.persistenceCallback = callback;
	}

	/**
	 * Trigger persistence after agent removal
	 */
	private static triggerPersistence(gitProject: GitProject): void {
		if (this.persistenceCallback) {
			this.persistenceCallback(gitProject.id);
		} else {
			console.warn(`[BackgroundAgentManager] No persistence callback set - agent removal may not be saved`);
		}
	}
}