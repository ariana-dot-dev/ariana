import { BackgroundAgent, BackgroundAgentType, MergeAgent, MergeAgentContext, MergeResult } from "../types/BackgroundAgent";
import { OsSession, osSessionGetWorkingDirectory } from "../bindings/os";
import type { GitProject } from "../types/GitProject";

export class BackgroundAgentManager {
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
}