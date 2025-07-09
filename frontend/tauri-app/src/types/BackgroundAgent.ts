import { OsSession, osSessionGetWorkingDirectory } from "../bindings/os";
import { CanvasService } from "../services/CanvasService";
import { invoke } from "@tauri-apps/api/core";

export type BackgroundAgentType = 'merge';

export type BackgroundAgentStatus = 'initializing' | 'checking' | 'running' | 'completed' | 'failed';

export interface BackgroundAgentState {
	id: string;
	type: BackgroundAgentType;
	status: BackgroundAgentStatus;
	createdAt: number;
	lastUpdated: number;
	osSession: OsSession; // Working directory for this agent
	context: any; // Type-specific context data
	progress?: string; // Current status message
	claudeCodeProcessId?: string; // Active Claude Code process
	errorMessage?: string; // Error details if failed
}

export interface CompletionCheckResult {
	isComplete: boolean;
	newContext?: any; // Updated context for retry
	instructions?: string; // Instructions for Claude Code on retry
}

export abstract class BackgroundAgent<TContext = any> {
	public id: string;
	public abstract readonly type: BackgroundAgentType;
	public status: BackgroundAgentStatus;
	public createdAt: number;
	public lastUpdated: number;
	public osSession: OsSession;
	public context: TContext;
	public progress?: string;
	public claudeCodeProcessId?: string;
	public errorMessage?: string;
	constructor(id: string, osSession: OsSession, context: TContext) {
		this.id = id;
		this.status = 'initializing';
		this.createdAt = Date.now();
		this.lastUpdated = Date.now();
		this.osSession = osSession;
		this.context = context;
	}

	/**
	 * Agent-specific setup code after directory is copied
	 */
	abstract setup(): Promise<void>;

	/**
	 * Check if the agent's task is completed
	 * Called before first run and after each Claude Code completion
	 */
	abstract checkCompletion(): Promise<CompletionCheckResult>;

	/**
	 * Generate the prompt for Claude Code based on current context
	 */
	abstract generatePrompt(retryContext?: string): string;

	/**
	 * Finalize the agent's work (e.g., merge back to root)
	 */
	abstract finalize(): Promise<void>;

	updateStatus(status: BackgroundAgentStatus, progress?: string, errorMessage?: string): void {
		this.status = status;
		this.lastUpdated = Date.now();
		if (progress !== undefined) this.progress = progress;
		if (errorMessage !== undefined) this.errorMessage = errorMessage;
	}

	toJSON(): BackgroundAgentState {
		return {
			id: this.id,
			type: this.type,
			status: this.status,
			createdAt: this.createdAt,
			lastUpdated: this.lastUpdated,
			osSession: this.osSession,
			context: this.context,
			progress: this.progress,
			claudeCodeProcessId: this.claudeCodeProcessId,
			errorMessage: this.errorMessage,
		};
	}

	static fromJSON(data: BackgroundAgentState): BackgroundAgent {
		switch (data.type) {
			case 'merge':
				return MergeBackgroundAgent.fromJSON(data);
			default:
				throw new Error(`Unknown background agent type: ${data.type}`);
		}
	}
}

export interface MergeAgentContext {
	rootOsSession: OsSession;
	canvasToMergeOsSession: OsSession;
	allHistoricalPrompts: string[];
	conflictFiles: string[];
	mergeAttempts: number;
	maxAttempts: number;
	rootBranchName: string; // The root's branch name  
	canvasBranchName: string; // The canvas's branch name
}

export type MergeResult = 
  | { success: true; agentId: string }
  | { success: false; error: string };

export class MergeBackgroundAgent extends BackgroundAgent<MergeAgentContext> {
	public readonly type: BackgroundAgentType = 'merge';

	constructor(id: string, osSession: OsSession, context: MergeAgentContext) {
		super(id, osSession, context);
	}

	async setup(): Promise<void> {
		this.updateStatus('initializing', 'Setting up merge environment...');

		// Step 1: Create a NEW temporary copy of ROOT (like creating a canvas)
		const rootDir = osSessionGetWorkingDirectory(this.context.rootOsSession);
		const workingDir = osSessionGetWorkingDirectory(this.osSession);
		const canvasDir = osSessionGetWorkingDirectory(this.context.canvasToMergeOsSession);

		// SAFETY CHECK: Ensure working directory is not the same as root directory
		if (rootDir === workingDir) {
			throw new Error(`SAFETY: Working directory cannot be the same as root directory. This would corrupt the main repository.`);
		}

		// Validate directories exist
		if (!rootDir) {
			throw new Error('Root directory is undefined');
		}
		if (!workingDir) {
			throw new Error('Working directory is undefined');
		}
		if (!canvasDir) {
			throw new Error('Canvas directory is undefined');
		}

		console.log(`Agent setup: Validating canvas directory ${canvasDir}`);
		// Validate that the canvas directory exists before proceeding
		try {
			await invoke('execute_command_with_os_session', {
				command: 'test',
				args: ['-d', canvasDir],
				directory: '/',
				osSession: this.context.canvasToMergeOsSession
			});
		} catch (error) {
			throw new Error(`Canvas directory no longer exists: ${canvasDir}. The canvas may have been deleted.`);
		}

		console.log(`Agent setup: Copying ROOT from ${rootDir} to ${workingDir}`);
		const copyResult = await CanvasService.copyDirectory(rootDir, workingDir, this.context.rootOsSession);
		if (!copyResult.success) {
			throw new Error(`Failed to copy root directory: ${copyResult.error}`);
		}

		// Step 2: Check what branch we're actually on in the working directory
		let currentBranch: string;
		try {
			currentBranch = await invoke<string>('git_get_current_branch', {
				directory: workingDir,
				osSession: this.osSession
			});
			console.log(`Agent setup: Currently on branch ${currentBranch} in working directory`);
		} catch (error) {
			console.log(`Agent setup: Failed to detect current branch, assuming we're on ${this.context.rootBranchName}`);
			currentBranch = this.context.rootBranchName;
		}

		// Only checkout if we're not already on the root branch
		if (currentBranch !== this.context.rootBranchName) {
			console.log(`Agent setup: Switching from ${currentBranch} to root branch ${this.context.rootBranchName}`);
			try {
				await invoke('execute_command_with_os_session', {
					command: 'git',
					args: ['checkout', this.context.rootBranchName],
					directory: workingDir,
					osSession: this.osSession
				});
			} catch (checkoutError) {
				console.log(`Agent setup: Failed to checkout ${this.context.rootBranchName}, staying on ${currentBranch}`);
				// Update our context to use the actual branch we're on
				this.context.rootBranchName = currentBranch;
			}
		}

		// Step 3: Create a "canvas-changes" branch for applying canvas content
		console.log(`Agent setup: Creating canvas-changes branch`);
		await invoke('execute_command_with_os_session', {
			command: 'git',
			args: ['checkout', '-b', 'canvas-changes'],
			directory: workingDir,
			osSession: this.osSession
		});

		// Step 4: Copy canvas files over the working directory (excluding .git)
		// This applies the canvas changes to the canvas-changes branch
		console.log(`Agent setup: Applying canvas changes from ${canvasDir}`);
		const canvasCopyResult = await CanvasService.copyDirectory(canvasDir, workingDir, this.osSession, true);
		if (!canvasCopyResult.success) {
			throw new Error(`Failed to copy canvas changes: ${canvasCopyResult.error}`);
		}

		// Step 5: Commit the canvas changes 
		try {
			console.log(`Agent setup: Committing canvas changes`);
			await invoke('git_commit', {
				directory: workingDir,
				message: `Apply changes from canvas branch ${this.context.canvasBranchName}`,
				osSession: this.osSession
			});
		} catch (error) {
			console.log('No changes to commit from canvas:', error);
		}

		// Step 6: Switch back to root branch for merge check
		console.log(`Agent setup: Switching back to root branch ${this.context.rootBranchName}`);
		try {
			await invoke('execute_command_with_os_session', {
				command: 'git',
				args: ['checkout', this.context.rootBranchName],
				directory: workingDir,
				osSession: this.osSession
			});
		} catch (checkoutError) {
			console.log(`Agent setup: Failed to checkout ${this.context.rootBranchName}, trying to create it`);
			// If checkout fails, the branch might not exist - try to create it
			try {
				await invoke('execute_command_with_os_session', {
					command: 'git',
					args: ['checkout', '-b', this.context.rootBranchName],
					directory: workingDir,
					osSession: this.osSession
				});
				console.log(`Agent setup: Created and switched to ${this.context.rootBranchName}`);
			} catch (createError) {
				console.log(`Agent setup: Failed to create ${this.context.rootBranchName}, staying on current branch`);
				// Find out what branch we're actually on and use that
				const actualBranch = await invoke<string>('git_get_current_branch', {
					directory: workingDir,
					osSession: this.osSession
				});
				console.log(`Agent setup: Using actual branch ${actualBranch} instead of ${this.context.rootBranchName}`);
				this.context.rootBranchName = actualBranch;
			}
		}

		this.updateStatus('checking', 'Checking for merge conflicts...');
	}

	async checkCompletion(): Promise<CompletionCheckResult> {
		try {
			const workingDir = osSessionGetWorkingDirectory(this.osSession);
			if (!workingDir) {
				throw new Error('Working directory is undefined');
			}
			console.log(`Agent checkCompletion: Starting in directory ${workingDir}`);

			// Try to perform the git merge first
			try {
				console.log(`Agent checkCompletion: Attempting merge of canvas-changes into ${this.context.rootBranchName}`);
				await invoke('git_merge_branch', {
					directory: workingDir,
					sourceBranch: 'canvas-changes',
					targetBranch: this.context.rootBranchName,
					osSession: this.osSession
				});
				
				// If merge succeeded without conflicts, we're done
				console.log(`Agent checkCompletion: Merge completed successfully`);
				return { isComplete: true };
				
			} catch (mergeError) {
				console.log(`Agent checkCompletion: Merge failed with conflicts:`, mergeError);
				
				// Merge failed due to conflicts - get the conflict files
				const conflictFiles = await invoke<string[]>('git_get_conflict_files', {
					directory: workingDir,
					osSession: this.osSession
				});

				if (conflictFiles.length === 0) {
					// No conflicts detected, merge failed for other reasons
					throw new Error(`Merge failed but no conflicts detected: ${mergeError}`);
				}

				// Update context with current conflict state
				const newContext: MergeAgentContext = {
					...this.context,
					conflictFiles,
					mergeAttempts: this.context.mergeAttempts + 1
				};

				const instructions = `Merge conflicts detected in: ${conflictFiles.join(', ')}. Please resolve all conflicts in these files by editing them directly. Do NOT run any git commands - only edit the files to resolve conflicts.`;

				return {
					isComplete: false,
					newContext,
					instructions
				};
			}

		} catch (error) {
			throw new Error(`Failed to check merge completion: ${error}`);
		}
	}

	generatePrompt(retryContext?: string): string {
		const basePrompt = `
You are resolving merge conflicts in a collaborative coding environment.

HISTORICAL CONTEXT (all previous work that led to this merge):
${this.context.allHistoricalPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}

CURRENT TASK:
Git has attempted to merge changes from a canvas workspace into the main branch, but merge conflicts were detected.
Your job is to resolve these conflicts by editing the affected files directly.

CONFLICT FILES TO RESOLVE:
${this.context.conflictFiles.map(file => `- ${file}`).join('\n')}

${retryContext || 'Please resolve all merge conflicts while preserving the intent of both versions.'}

IMPORTANT INSTRUCTIONS:
- DO NOT run any git commands (git merge, git add, git commit, etc.)
- ONLY edit the conflicted files to resolve the conflicts
- Look for conflict markers like <<<<<<< HEAD, =======, and >>>>>>> 
- Remove the conflict markers and integrate both changes appropriately
- Focus on preserving functionality from both the original code and the canvas changes
- The system will automatically commit your changes after you resolve the conflicts

FILES WITH CONFLICTS: ${this.context.conflictFiles.join(', ')}

Attempt ${this.context.mergeAttempts + 1} of ${this.context.maxAttempts}.
		`.trim();

		return basePrompt;
	}

	async finalize(): Promise<void> {
		this.updateStatus('completed', 'Finalizing merge...');

		const workingDir = osSessionGetWorkingDirectory(this.osSession);
		const rootDir = osSessionGetWorkingDirectory(this.context.rootOsSession);
		
		// Validate directories exist
		if (!workingDir) {
			throw new Error('Working directory is undefined');
		}
		if (!rootDir) {
			throw new Error('Root directory is undefined');
		}
		
		try {
			// The merge should already be completed by checkCompletion()
			// But if there were conflicts that Claude resolved, we need to commit them
			console.log(`Agent finalize: Committing any resolved conflicts`);
			try {
				await invoke('git_commit', {
					directory: workingDir,
					message: `Merge canvas changes: resolved conflicts automatically`,
					osSession: this.osSession
				});
			} catch (commitError) {
				// It's OK if there's nothing to commit
				console.log('Nothing to commit after conflict resolution:', commitError);
			}

			// Step 2: Only after successful merge, sync back to the real root
			console.log(`Agent finalize: Syncing merged result back to real root ${rootDir}`);
			const finalCopyResult = await CanvasService.copyDirectory(workingDir, rootDir, this.context.rootOsSession, true);
			if (!finalCopyResult.success) {
				throw new Error(`Failed to sync result back to root: ${finalCopyResult.error}`);
			}

			// Step 3: Sync all existing copies to new root state
			const { CopyPoolManager } = await import('../services/CopyPoolManager');
			const copyPool = CopyPoolManager.getInstance();
			await copyPool.syncAllToRoot(rootDir, this.context.rootOsSession);
			console.log('Synced all copy pool entries to new root state');

			this.updateStatus('completed', 'Merge completed successfully');
			
			// Return the merge workspace to the copy pool for reuse
			await this.returnToPool();
		} catch (error) {
			throw new Error(`Finalize failed: ${error}`);
		}
	}

	/**
	 * Returns the completed merge workspace to the copy pool for reuse
	 */
	private async returnToPool(): Promise<void> {
		try {
			const workingDir = osSessionGetWorkingDirectory(this.osSession);
			const rootDir = osSessionGetWorkingDirectory(this.context.rootOsSession);
			
			if (!workingDir || !rootDir) {
				console.warn('Cannot return to pool: missing directory paths');
				return;
			}

			// Import the copy pool manager (dynamic import to avoid circular dependencies)
			const { CopyPoolManager } = await import('../services/CopyPoolManager');
			const copyPool = CopyPoolManager.getInstance();
			
			// Create a copy pool entry for this merge workspace
			const copyEntry = {
				id: this.id,
				path: workingDir,
				osSession: this.osSession,
				branchName: `merge-${this.id}`,
				createdAt: new Date()
			};

			await copyPool.returnCopy(copyEntry, rootDir, this.context.rootOsSession);
			console.log(`Returned merge workspace ${workingDir} to copy pool`);
		} catch (error) {
			console.warn('Failed to return merge workspace to pool:', error);
		}
	}

	static fromJSON(data: BackgroundAgentState): MergeBackgroundAgent {
		const context = data.context as MergeAgentContext;
		const agent = new MergeBackgroundAgent(data.id, data.osSession, context);
		
		// Restore state
		agent.status = data.status;
		agent.createdAt = data.createdAt;
		agent.lastUpdated = data.lastUpdated;
		agent.progress = data.progress;
		agent.claudeCodeProcessId = data.claudeCodeProcessId;
		agent.errorMessage = data.errorMessage;

		return agent;
	}
}