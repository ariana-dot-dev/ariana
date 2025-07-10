import { OsSession, osSessionGetWorkingDirectory } from "../bindings/os";

export type BackgroundAgentType = 'merge' | 'deploy' | 'test' | 'analyze';

export type BackgroundAgentStatus = 'queued' | 'preparation' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundAgentState {
	id: string;
	type: BackgroundAgentType;
	status: BackgroundAgentStatus;
	createdAt: number;
	lastUpdated: number;
	workspaceOsSession: OsSession; // Isolated workspace for this agent
	context: any; // Type-specific context data
	progress?: string; // Current status message
	errorMessage?: string; // Error details if failed
	cancellationToken: CancellationToken;
}

export interface CompletionCheckResult {
	isComplete: boolean;
	retryContext?: any; // Updated context for retry with more specific instructions
}

export interface CancellationToken {
	isCancelled: boolean;
	cancel(): void;
}

export function createCancellationToken(): CancellationToken {
	let cancelled = false;
	return {
		get isCancelled() { return cancelled; },
		cancel() { cancelled = true; }
	};
}

export abstract class BackgroundAgent<TContext = any> {
	public readonly id: string;
	public abstract readonly type: BackgroundAgentType;
	public abstract readonly requiresSerialization: boolean; // True if only one agent of this type can run at a time
	public status: BackgroundAgentStatus;
	public readonly createdAt: number;
	public lastUpdated: number;
	public readonly workspaceOsSession: OsSession;
	public context: TContext;
	public progress?: string;
	public errorMessage?: string;
	public readonly cancellationToken: CancellationToken;

	// Reactive listeners for UI updates
	private listeners: Set<() => void> = new Set();

	constructor(id: string, workspaceOsSession: OsSession, context: TContext) {
		this.id = id;
		this.status = this.requiresSerialization ? 'queued' : 'preparation';
		this.createdAt = Date.now();
		this.lastUpdated = Date.now();
		this.workspaceOsSession = workspaceOsSession;
		this.context = context;
		this.cancellationToken = createCancellationToken();
	}

	/**
	 * Phase 1: Prepare isolated workspace and setup
	 * For merge: copy root, apply canvas changes, create git branches
	 */
	abstract prepare(): Promise<void>;

	/**
	 * Phase 2: Check if the task is completed
	 * For merge: check for git conflict markers in files
	 * Returns completion status and optional retry context for more specific instructions
	 */
	abstract checkCompletion(): Promise<CompletionCheckResult>;

	/**
	 * Phase 3: Run the agent to make progress toward completion
	 * For merge: run Claude Code to resolve conflicts (edit files only, no git commands)
	 * Takes optional retry context for more targeted resolution
	 */
	abstract runAgent(retryContext?: any): Promise<void>;

	/**
	 * Phase 4: Cleanup and finalize
	 * For merge: sync resolved changes back to root, update copy pool
	 */
	abstract cleanup(): Promise<void>;

	/**
	 * Update agent status and notify listeners
	 */
	updateStatus(status: BackgroundAgentStatus, progress?: string, errorMessage?: string): void {
		this.status = status;
		this.lastUpdated = Date.now();
		if (progress !== undefined) this.progress = progress;
		if (errorMessage !== undefined) this.errorMessage = errorMessage;
		this.notifyListeners();
	}

	/**
	 * Subscribe to agent state changes
	 */
	subscribe(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	private notifyListeners(): void {
		this.listeners.forEach(callback => callback());
	}

	/**
	 * Cancel the agent at any point
	 */
	cancel(): void {
		this.cancellationToken.cancel();
		this.updateStatus('cancelled', 'Operation cancelled by user');
	}

	/**
	 * Check if agent was cancelled
	 */
	checkCancellation(): void {
		if (this.cancellationToken.isCancelled) {
			throw new Error('Operation was cancelled');
		}
	}

	/**
	 * Serialization for persistence
	 */
	toJSON(): BackgroundAgentState {
		return {
			id: this.id,
			type: this.type,
			status: this.status,
			createdAt: this.createdAt,
			lastUpdated: this.lastUpdated,
			workspaceOsSession: this.workspaceOsSession,
			context: this.context,
			progress: this.progress,
			errorMessage: this.errorMessage,
			cancellationToken: this.cancellationToken,
		};
	}

	/**
	 * Factory method for creating agents from JSON
	 */
	static fromJSON(data: BackgroundAgentState): BackgroundAgent {
		switch (data.type) {
			case 'merge':
				return MergeAgent.fromJSON(data);
			default:
				throw new Error(`Unknown background agent type: ${data.type}`);
		}
	}
}

// =============================================================================
// MERGE AGENT IMPLEMENTATION
// =============================================================================

export interface MergeAgentContext {
	rootOsSession: OsSession;
	canvasOsSession: OsSession;
	canvasId: string;
	originalRootCommitHash?: string; // Track root state at merge start
	originalRootBranch: string; // The actual branch name from root (not hardcoded 'main')
	conflictFiles: string[];
	maxRetries: number;
	currentRetry: number;
	allHistoricalPrompts: string[];
}

export interface MergeResult {
	success: boolean;
	agentId?: string;
	error?: string;
}

export class MergeAgent extends BackgroundAgent<MergeAgentContext> {
	public readonly type: BackgroundAgentType = 'merge';
	public readonly requiresSerialization: boolean = true; // Merge agents must run one at a time

	constructor(id: string, workspaceOsSession: OsSession, context: MergeAgentContext) {
		super(id, workspaceOsSession, context);
	}

	/**
	 * Phase 1: Prepare merge workspace
	 */
	async prepare(): Promise<void> {
		this.checkCancellation();
		this.updateStatus('preparation', 'Setting up merge workspace...');

		const workingDir = osSessionGetWorkingDirectory(this.workspaceOsSession);
		const rootDir = osSessionGetWorkingDirectory(this.context.rootOsSession);
		const canvasDir = osSessionGetWorkingDirectory(this.context.canvasOsSession);

		if (!workingDir || !rootDir || !canvasDir) {
			throw new Error('Invalid directory paths for merge operation');
		}

		// Safety check: workspace must be isolated
		if (workingDir === rootDir || workingDir === canvasDir) {
			throw new Error('Merge workspace must be isolated from root and canvas');
		}

		try {
			// Step 1: Copy root to workspace (handle git repositories properly)
			const { CanvasService } = await import('../services/CanvasService');
			const { invoke } = await import("@tauri-apps/api/core");
			console.log(`[MergeAgent] Copying root from ${rootDir} to ${workingDir}`);
			
			// First, try to create the working directory
			await invoke('execute_command_with_os_session', {
				command: 'mkdir',
				args: ['-p', workingDir],
				directory: '/',
				osSession: this.workspaceOsSession
			});

			// Check if root is a git repository
			let isGitRepo = false;
			try {
				isGitRepo = await invoke<boolean>('check_git_repository', {
					directory: rootDir,
					osSession: this.context.rootOsSession
				});
			} catch (error) {
				console.log(`[MergeAgent] Failed to check if root is git repo: ${error}`);
			}

			if (isGitRepo) {
				// Copy the git repository (including .git) using optimized copy
				try {
					await invoke('copy_files_optimized', {
						source: rootDir,
						destination: workingDir,
						osSession: this.context.rootOsSession,
						excludeGit: false // Include .git directory for git repos
					});
				} catch (error) {
					throw new Error(`Failed to copy git repository: ${error}`);
				}
			} else {
				// Root is not a git repository, initialize workspace as git repo
				console.error(`[MergeAgent] Root is not a git repository, initializing workspace as git repository`);
				throw new Error('Root directory is not a git repository. Please initialize it as a git repository before merging.');
			}

			this.checkCancellation();

			// Step 2: Record original root state for conflict detection
			try {
				this.context.originalRootCommitHash = await invoke<string>('get_git_hash', {
					directory: rootDir,
					osSession: this.context.rootOsSession
				});
			} catch (error) {
				// Root has no commits yet - set to empty string to track this state
				console.log(`[MergeAgent] Root has no commits yet, tracking as initial state`);
				this.context.originalRootCommitHash = '';
			}

			// Step 3: Create and switch to canvas-changes branch
			await invoke('execute_command_with_os_session', {
				command: 'git',
				args: ['checkout', '-b', 'canvas-changes'],
				directory: workingDir,
				osSession: this.workspaceOsSession
			});

			this.checkCancellation();

			// Step 4: Apply canvas changes (excluding .git)
			console.log(`[MergeAgent] Applying canvas changes from ${canvasDir}`);
			try {
				await invoke('copy_files_optimized', {
					source: canvasDir,
					destination: workingDir,
					osSession: this.workspaceOsSession,
					excludeGit: true // Exclude .git from canvas
				});
			} catch (error) {
				throw new Error(`Failed to apply canvas changes: ${error}`);
			}

			// Step 5: Commit canvas changes
			try {
				await invoke('git_commit', {
					directory: workingDir,
					message: `Apply canvas changes for merge`,
					osSession: this.workspaceOsSession
				});
			} catch (error) {
				console.log('[MergeAgent] No changes to commit from canvas');
			}

			this.checkCancellation();

			// Step 6: Switch back to root branch and attempt merge
			// Use the actual root branch name instead of hardcoding 'main'
			if (this.context.originalRootCommitHash !== '') {
				// Repository has commits, checkout existing branch
				await invoke('execute_command_with_os_session', {
					command: 'git',
					args: ['checkout', this.context.originalRootBranch],
					directory: workingDir,
					osSession: this.workspaceOsSession
				});
			} else {
				// Empty repository, create the root branch
				await invoke('execute_command_with_os_session', {
					command: 'git',
					args: ['checkout', '-b', this.context.originalRootBranch],
					directory: workingDir,
					osSession: this.workspaceOsSession
				});
			}

		} catch (error) {
			if (this.cancellationToken.isCancelled) {
				throw error; // Re-throw cancellation
			}
			throw new Error(`Preparation failed: ${error}`);
		}
	}

	/**
	 * Phase 2: Check for completion (conflicts resolved)
	 */
	async checkCompletion(): Promise<CompletionCheckResult> {
		this.checkCancellation();

		const workingDir = osSessionGetWorkingDirectory(this.workspaceOsSession);
		if (!workingDir) {
			throw new Error('Working directory is undefined');
		}

		try {
			const { invoke } = await import("@tauri-apps/api/core");

			// Attempt merge to detect conflicts
			try {
				await invoke('git_merge_branch', {
					directory: workingDir,
					sourceBranch: 'canvas-changes',
					targetBranch: this.context.originalRootBranch,
					osSession: this.workspaceOsSession
				});

				// Merge succeeded - we're done!
				return { isComplete: true };

			} catch (mergeError) {
				// Get conflict files
				const conflictFiles = await invoke<string[]>('git_get_conflict_files', {
					directory: workingDir,
					osSession: this.workspaceOsSession
				});

				if (conflictFiles.length === 0) {
					throw new Error(`Merge failed but no conflicts detected: ${mergeError}`);
				}

				// Update context with current conflicts for targeted resolution
				this.context.conflictFiles = conflictFiles;
				
				return {
					isComplete: false,
					retryContext: {
						conflictFiles,
						retryNumber: this.context.currentRetry + 1,
						specificFiles: conflictFiles.join(', ')
					}
				};
			}
		} catch (error) {
			if (this.cancellationToken.isCancelled) {
				throw error;
			}
			throw new Error(`Completion check failed: ${error}`);
		}
	}

	/**
	 * Phase 3: Run Claude Code to resolve conflicts
	 */
	async runAgent(retryContext?: any): Promise<void> {
		this.checkCancellation();
		this.updateStatus('running', `Resolving conflicts (attempt ${this.context.currentRetry + 1}/${this.context.maxRetries})...`);

		const prompt = this.generateConflictResolutionPrompt(retryContext);

		try {
			// Use existing Claude Code infrastructure
			const { ClaudeCodeAgent } = await import('../services/ClaudeCodeAgent');
			const claudeAgent = new ClaudeCodeAgent();

			// Start Claude Code task
			await claudeAgent.startTask(this.workspaceOsSession, prompt);

			// Wait for completion with cancellation support
			await this.waitForClaudeCompletion(claudeAgent);

			// Commit Claude's changes
			const workingDir = osSessionGetWorkingDirectory(this.workspaceOsSession);
			const { invoke } = await import("@tauri-apps/api/core");
			
			try {
				await invoke('git_commit', {
					directory: workingDir,
					message: `Resolve merge conflicts - attempt ${this.context.currentRetry + 1}`,
					osSession: this.workspaceOsSession
				});
			} catch (commitError) {
				console.log('[MergeAgent] No changes to commit after Claude resolution');
			}

			this.context.currentRetry++;

		} catch (error) {
			if (this.cancellationToken.isCancelled) {
				throw error;
			}
			throw new Error(`Agent execution failed: ${error}`);
		}
	}

	/**
	 * Phase 4: Sync resolved changes back to root
	 */
	async cleanup(): Promise<void> {
		this.checkCancellation();
		this.updateStatus('completed', 'Syncing changes back to root...');

		const workingDir = osSessionGetWorkingDirectory(this.workspaceOsSession);
		const rootDir = osSessionGetWorkingDirectory(this.context.rootOsSession);

		if (!workingDir || !rootDir) {
			throw new Error('Invalid directory paths for cleanup');
		}

		try {
			const { invoke } = await import("@tauri-apps/api/core");

			// Check if root changed during merge (only if original had commits)
			if (this.context.originalRootCommitHash !== '') {
				try {
					const currentRootHash = await invoke<string>('get_git_hash', {
						directory: rootDir,
						osSession: this.context.rootOsSession
					});

					if (currentRootHash !== this.context.originalRootCommitHash) {
						throw new Error('Root repository was modified during merge. Manual intervention required.');
					}
				} catch (error) {
					// If getting git hash fails, root might have become invalid
					throw new Error(`Failed to verify root state during cleanup: ${error}`);
				}
			} else {
				// Original root had no commits, verify it still has no commits
				// or that it only has the commits we expect from this merge
				console.log('[MergeAgent] Original root had no commits, skipping root change verification');
			}

			// Sync workspace back to root (atomic operation)
			try {
				await invoke('copy_files_optimized', {
					source: workingDir,
					destination: rootDir,
					osSession: this.context.rootOsSession,
					excludeGit: true // Exclude .git when syncing back to root
				});
			} catch (error) {
				throw new Error(`Failed to sync back to root: ${error}`);
			}

			// Commit the merged changes to the root repository
			try {
				const mergeCommitHash = await invoke<string>('git_commit', {
					directory: rootDir,
					message: `Merge canvas changes from canvas ${this.context.canvasId}`,
					osSession: this.context.rootOsSession
				});
				console.log(`[MergeAgent] Created merge commit in root: ${mergeCommitHash}`);
			} catch (commitError) {
				console.log('[MergeAgent] No changes to commit in root after merge');
			}

			// Update all copies in the pool
			const { CopyPoolManager } = await import('../services/CopyPoolManager');
			const copyPool = CopyPoolManager.getInstance();
			await copyPool.syncAllToRoot(rootDir, this.context.rootOsSession);

			this.updateStatus('completed', 'Merge completed successfully');

		} catch (error) {
			if (this.cancellationToken.isCancelled) {
				throw error;
			}
			throw new Error(`Cleanup failed: ${error}`);
		}
	}

	/**
	 * Generate targeted conflict resolution prompt
	 */
	private generateConflictResolutionPrompt(retryContext?: any): string {
		const baseContext = `
You are resolving merge conflicts in a collaborative coding environment.

HISTORICAL CONTEXT:
${this.context.allHistoricalPrompts.map((p, i) => `${i + 1}. ${p}`).join('\n')}

CURRENT TASK:
Resolve merge conflicts in the following files by editing them directly.
`;

		const retryInstructions = retryContext ? `
SPECIFIC CONFLICTS TO RESOLVE:
${retryContext.specificFiles}

This is attempt ${retryContext.retryNumber} of ${this.context.maxRetries}.
${retryContext.retryNumber > 1 ? 'Previous attempts failed - please be more thorough in conflict resolution.' : ''}
` : `
CONFLICT FILES:
${this.context.conflictFiles.join(', ')}
`;

		return `${baseContext}${retryInstructions}

INSTRUCTIONS:
- Edit the conflicted files to resolve all merge conflicts
- Look for conflict markers: <<<<<<< HEAD, =======, >>>>>>> 
- Remove conflict markers and integrate both changes appropriately
- DO NOT run any git commands - only edit files
- Preserve functionality from both the original code and canvas changes
- Focus on making the code work correctly after merging

The system will automatically commit your changes.`.trim();
	}

	/**
	 * Wait for Claude Code completion with cancellation support
	 */
	private async waitForClaudeCompletion(claudeAgent: any): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!claudeAgent.isTaskRunning) {
				reject(new Error('Claude Code agent not running'));
				return;
			}

			const checkCancellation = () => {
				if (this.cancellationToken.isCancelled) {
					claudeAgent.stopTask();
					reject(new Error('Operation was cancelled'));
				}
			};

			const onTaskComplete = () => {
				clearInterval(cancellationInterval);
				resolve();
			};

			const onTaskError = (error: any) => {
				clearInterval(cancellationInterval);
				reject(new Error(`Claude Code task failed: ${error}`));
			};

			claudeAgent.on('taskCompleted', onTaskComplete);
			claudeAgent.on('taskError', onTaskError);

			// Check for cancellation every second
			const cancellationInterval = setInterval(checkCancellation, 1000);

			// Timeout after 30 minutes
			setTimeout(() => {
				clearInterval(cancellationInterval);
				claudeAgent.off('taskCompleted', onTaskComplete);
				claudeAgent.off('taskError', onTaskError);
				claudeAgent.stopTask();
				reject(new Error('Claude Code process timed out'));
			}, 30 * 60 * 1000);
		});
	}

	/**
	 * Create MergeAgent from JSON state
	 */
	static fromJSON(data: BackgroundAgentState): MergeAgent {
		const context = data.context as MergeAgentContext;
		const agent = new MergeAgent(data.id, data.workspaceOsSession, context);
		
		// Restore state
		agent.status = data.status;
		agent.lastUpdated = data.lastUpdated;
		agent.progress = data.progress;
		agent.errorMessage = data.errorMessage;

		return agent;
	}
}