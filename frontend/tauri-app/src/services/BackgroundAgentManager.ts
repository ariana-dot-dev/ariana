import { BackgroundAgent, BackgroundAgentStatus, MergeBackgroundAgent, MergeAgentContext } from "../types/BackgroundAgent";
import { OsSession, osSessionGetWorkingDirectory } from "../bindings/os";
import { CanvasService } from "./CanvasService";
import { ClaudeCodeAgent } from "./ClaudeCodeAgent";
import { ProcessManager } from "./ProcessManager";
import { invoke } from "@tauri-apps/api/core";
import type { GitProject } from "../types/GitProject";

export class BackgroundAgentManager {
	// Remove static state - GitProject will be the single source of truth

	/**
	 * Create a merge background agent
	 */
	static async createMergeAgent(
		rootOsSession: OsSession,
		canvasToMergeOsSession: OsSession,
		allHistoricalPrompts: string[],
		gitProject: GitProject,
		canvasId: string
	): Promise<string> {
		const agentId = crypto.randomUUID();
		
		// Create working directory for the agent with proper path handling
		const rootDir = osSessionGetWorkingDirectory(rootOsSession);
		if (!rootDir) {
			throw new Error("Could not determine root directory");
		}
		const randomId = CanvasService.generateRandomId();
		
		let agentOsSession: OsSession;
		let workingDir: string;
		
		if ('Local' in rootOsSession) {
			// For Local sessions, create directory next to root with proper separator
			const separator = rootDir.includes('/') ? '/' : '\\';
			const parentDir = rootDir.substring(0, rootDir.lastIndexOf(separator));
			const rootDirName = rootDir.substring(rootDir.lastIndexOf(separator) + 1);
			workingDir = `${parentDir}${separator}${rootDirName}-merge-${randomId}`;
			agentOsSession = { Local: workingDir };
		} else if ('Wsl' in rootOsSession) {
			// For WSL sessions, always use Unix-style paths
			const parentDir = rootDir.substring(0, rootDir.lastIndexOf('/'));
			const rootDirName = rootDir.substring(rootDir.lastIndexOf('/') + 1);
			workingDir = `${parentDir}/${rootDirName}-merge-${randomId}`;
			agentOsSession = {
				Wsl: {
					distribution: rootOsSession.Wsl.distribution,
					working_directory: workingDir
				}
			};
		} else {
			throw new Error("Unknown OS session type");
		}

		// Use the original root branch from GitProject instead of detecting current branch
		// This prevents using corrupted branch names if root was accidentally switched
		const rootBranchName = gitProject.getOriginalRootBranch();
		console.log('Using original root branch from GitProject:', rootBranchName);

		// Detect the current branch in the CANVAS directory
		let canvasBranchName: string;
		const canvasDir = osSessionGetWorkingDirectory(canvasToMergeOsSession);
		try {
			console.log('Detecting CANVAS branch in directory:', canvasDir, 'with OS session:', canvasToMergeOsSession);
			canvasBranchName = await invoke<string>('git_get_current_branch', {
				directory: canvasDir,
				osSession: canvasToMergeOsSession
			});
			console.log('Detected canvas branch:', canvasBranchName);
		} catch (error) {
			// Fallback to root branch if detection fails
			console.warn('Failed to detect canvas branch, using root branch as fallback:', error);
			canvasBranchName = rootBranchName;
		}

		const context: MergeAgentContext = {
			rootOsSession,
			canvasToMergeOsSession,
			allHistoricalPrompts,
			conflictFiles: [],
			mergeAttempts: 0,
			maxAttempts: 3,
			rootBranchName,
			canvasBranchName
		};

		const agent = new MergeBackgroundAgent(agentId, agentOsSession, context);
		
		// Add agent to GitProject (single source of truth)
		gitProject.addBackgroundAgent(agent);

		// Patch the agent's updateStatus method to automatically sync with GitProject
		const originalUpdateStatus = agent.updateStatus.bind(agent);
		agent.updateStatus = function(status, progress, errorMessage) {
			originalUpdateStatus(status, progress, errorMessage);
			gitProject.updateBackgroundAgent(agentId, agent);
			console.log(`[BackgroundAgentManager] Agent ${agentId} status updated: ${status} - ${progress || 'no message'}`);
		};

		// Lock the canvas before starting the agent
		const lockSuccess = gitProject.lockCanvas(canvasId, 'merging', agentId);
		if (!lockSuccess) {
			throw new Error(`Failed to lock canvas ${canvasId} for merging`);
		}

		// Start the agent state machine
		this.runAgentStateMachine(agentId, gitProject, canvasId).catch(error => {
			console.error(`Background agent ${agentId} failed:`, error);
			
			// Update agent status in GitProject
			const agent = gitProject.getBackgroundAgent(agentId);
			if (agent) {
				agent.updateStatus('failed', undefined, error instanceof Error ? error.message : String(error));
				gitProject.updateBackgroundAgent(agentId, agent);
			}
			
			// Unlock canvas on failure
			gitProject.unlockCanvas(canvasId, agentId);
		});

		return agentId;
	}

	// Remove static agent storage methods - GitProject is now the source of truth

	/**
	 * Force remove an agent and cleanup its filesystem
	 */
	static async forceRemoveAgent(agentId: string, gitProject: GitProject): Promise<void> {
		const agent = gitProject.getBackgroundAgent(agentId);
		if (!agent) return;

		try {
			// Stop any running Claude Code process
			if (agent.claudeCodeProcessId) {
				const claudeCodeAgent = ProcessManager.getProcess(agent.claudeCodeProcessId);
				if (claudeCodeAgent && typeof claudeCodeAgent.stopTask === 'function') {
					await claudeCodeAgent.stopTask();
				}
				ProcessManager.unregisterProcess(agent.claudeCodeProcessId);
			}

			// Unlock any canvases locked by this agent
			gitProject.canvases.forEach(canvas => {
				if (canvas.lockingAgentId === agentId) {
					gitProject.unlockCanvas(canvas.id, agentId);
				}
			});

			// Delete the agent's working directory
			const workingDir = osSessionGetWorkingDirectory(agent.osSession);
			await invoke('delete_path_with_os_session', {
				path: workingDir,
				osSession: agent.osSession
			});

			console.log(`Force removed agent ${agentId} and cleaned up directory: ${workingDir}`);
		} catch (error) {
			console.error(`Error cleaning up agent ${agentId}:`, error);
		} finally {
			// Remove from GitProject
			gitProject.removeBackgroundAgent(agentId);
		}
	}

	/**
	 * Main state machine for background agents
	 */
	private static async runAgentStateMachine(agentId: string, gitProject: GitProject, canvasId: string): Promise<void> {
		const agent = gitProject.getBackgroundAgent(agentId);
		if (!agent) throw new Error(`Agent ${agentId} not found`);

		try {
			console.log(`Agent ${agentId}: Starting state machine`);
			
			// Step 1: Setup
			console.log(`Agent ${agentId}: Running setup`);
			await agent.setup();
			console.log(`Agent ${agentId}: Setup completed successfully`);

			// Step 2: Initial completion check
			console.log(`Agent ${agentId}: Checking completion`);
			let checkResult = await agent.checkCompletion();
			console.log(`Agent ${agentId}: Completion check result:`, checkResult);
			
			if (checkResult.isComplete) {
				// Task is already complete, finalize immediately
				console.log(`Agent ${agentId}: Task already complete, finalizing`);
				await agent.finalize();
				// Set canvas to merged state
				gitProject.lockCanvas(canvasId, 'merged', agentId);
				console.log(`[BackgroundAgentManager] Agent ${agentId} completed - canvas ${canvasId} set to merged state`);
				return;
			}

			// Step 3: Run Claude Code until completion or max attempts
			console.log(`Agent ${agentId}: Starting Claude Code loop`);
			while (!checkResult.isComplete && agent.context.mergeAttempts < agent.context.maxAttempts) {
				// Update context if provided
				if (checkResult.newContext) {
					agent.context = checkResult.newContext;
				}

				// Generate prompt for this attempt
				const prompt = agent.generatePrompt(checkResult.instructions);

				// Start Claude Code
				agent.updateStatus('running', `Running Claude Code (attempt ${agent.context.mergeAttempts + 1}/${agent.context.maxAttempts})...`);
				
				// Create a new Claude Code agent instance and start it
				const claudeCodeAgent = new ClaudeCodeAgent();
				const processId = crypto.randomUUID();
				agent.claudeCodeProcessId = processId;

				// Register the Claude Code agent for tracking
				ProcessManager.registerProcess(processId, claudeCodeAgent);

				// Start the Claude Code task
				await claudeCodeAgent.startTask(agent.osSession, prompt);

				// Wait for Claude Code completion
				await this.waitForClaudeCodeCompletion(agent);

				// After Claude resolves conflicts, commit the changes
				console.log(`Agent ${agentId}: Committing Claude's conflict resolutions`);
				const workingDir = osSessionGetWorkingDirectory(agent.osSession);
				try {
					await invoke('git_commit', {
						directory: workingDir,
						message: `Resolved merge conflicts - attempt ${agent.context.mergeAttempts}`,
						osSession: agent.osSession
					});
				} catch (commitError) {
					console.log('Nothing to commit after Claude resolution:', commitError);
				}

				// Check completion again
				agent.updateStatus('checking', 'Checking merge status...');
				checkResult = await agent.checkCompletion();
			}

			if (checkResult.isComplete) {
				// Task completed successfully
				await agent.finalize();
				// Set canvas to merged state
				gitProject.lockCanvas(canvasId, 'merged', agentId);
				console.log(`[BackgroundAgentManager] Agent ${agentId} completed - canvas ${canvasId} set to merged state`);
			} else {
				// Max attempts reached
				agent.updateStatus('failed', undefined, `Failed to complete merge after ${agent.context.maxAttempts} attempts`);
				// Unlock canvas on failure
				gitProject.unlockCanvas(canvasId, agentId);
				console.log(`[BackgroundAgentManager] Agent ${agentId} failed - canvas ${canvasId} unlocked`);
			}

		} catch (error) {
			console.error(`Agent ${agentId}: State machine failed with error:`, error);
			agent.updateStatus('failed', undefined, error instanceof Error ? error.message : String(error));
			// Unlock canvas on error
			gitProject.unlockCanvas(canvasId, agentId);
		}
	}

	/**
	 * Wait for Claude Code process to complete
	 */
	private static async waitForClaudeCodeCompletion(agent: BackgroundAgent): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!agent.claudeCodeProcessId) {
				reject(new Error('Claude Code process ID is missing'));
				return;
			}

			const claudeCodeAgent = ProcessManager.getProcess(agent.claudeCodeProcessId);
			if (!claudeCodeAgent || !claudeCodeAgent.isTaskRunning) {
				reject(new Error('Claude Code agent not found or not running'));
				return;
			}

			// Listen for task completion
			const onTaskComplete = () => {
				agent.claudeCodeProcessId = undefined;
				resolve();
			};

			const onTaskError = (error: any) => {
				agent.claudeCodeProcessId = undefined;
				reject(new Error(`Claude Code task failed: ${error}`));
			};

			claudeCodeAgent.on('taskCompleted', onTaskComplete);
			claudeCodeAgent.on('taskError', onTaskError);

			// Timeout after 30 minutes
			setTimeout(() => {
				claudeCodeAgent.off('taskCompleted', onTaskComplete);
				claudeCodeAgent.off('taskError', onTaskError);
				reject(new Error('Claude Code process timed out'));
			}, 30 * 60 * 1000);
		});
	}

	// Agent persistence is now handled by GitProject
}