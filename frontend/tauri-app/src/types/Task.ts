import { OsSession } from "../bindings/os";

export type TaskStatus = 'prompting' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';

export interface TaskBase {
	id: string;
	prompt: string;
	createdAt: number;
	status: TaskStatus;
}

export interface PromptingTask extends TaskBase {
	status: 'prompting';
}

export interface QueuedTask extends TaskBase {
	status: 'queued';
	queuedAt: number;
}

export interface RunningTask extends TaskBase {
	status: 'running';
	startedAt: number;
	processId?: string; // Link to ProcessState if needed
}

export interface PausedTask extends TaskBase {
	status: 'paused';
	startedAt: number;
	pausedAt: number;
	processId?: string; // Link to ProcessState if needed
}


export interface FailedTask extends TaskBase {
	status: 'failed';
	startedAt?: number;
	failedAt: number;
	reason?: string;
}

export interface CompletedTask extends TaskBase {
	status: 'completed';
	startedAt: number;
	completedAt: number;
	commitHash: string; // Empty string or "NO_CHANGES" for tasks with no file changes
	isReverted: boolean;
	// Dependencies for revert/restore logic
	dependsOn?: string[]; // Task IDs this task depends on
}

export type Task = PromptingTask | QueuedTask | RunningTask | PausedTask | CompletedTask | FailedTask;

export class TaskManager {
	private tasks: Task[] = [];
	private listeners: Set<() => void> = new Set();
	
	// Listener management methods
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	
	private notifyListeners(): void {
		this.listeners.forEach(listener => listener());
	}
	
	// Task creation and state transitions
	createPromptingTask(prompt: string): string {
		const task: PromptingTask = {
			id: crypto.randomUUID(),
			prompt,
			createdAt: Date.now(),
			status: 'prompting'
		};
		this.tasks.push(task);
		this.notifyListeners();
		return task.id;
	}

	queueTask(taskId: string): boolean {
		console.log(`[TaskManager] R4: Attempting to queue task ${taskId} for multi-task support`);
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1 || this.tasks[taskIndex].status !== 'prompting') {
			console.log(`[TaskManager] R4: Failed to queue task ${taskId} - task not found or not in prompting state`);
			return false;
		}

		const task = this.tasks[taskIndex] as PromptingTask;
		const queuedTask: QueuedTask = {
			...task,
			status: 'queued',
			queuedAt: Date.now()
		};

		this.tasks[taskIndex] = queuedTask;
		console.log(`[TaskManager] R4: Successfully queued task ${taskId} at ${queuedTask.queuedAt}`);
		this.notifyListeners();
		return true;
	}

	startTask(taskId: string, processId?: string): boolean {
		console.log(`[TaskManager] R3,R5: Starting task ${taskId} with processId ${processId || 'none'}`);
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) {
			console.log(`[TaskManager] R3,R5: Failed to start task ${taskId} - task not found`);
			return false;
		}
		
		const task = this.tasks[taskIndex];
		if (task.status !== 'prompting' && task.status !== 'queued') {
			console.log(`[TaskManager] R3,R5: Failed to start task ${taskId} - invalid status: ${task.status}`);
			return false;
		}

		const runningTask: RunningTask = {
			...task,
			status: 'running',
			startedAt: Date.now(),
			processId
		};
		
		this.tasks[taskIndex] = runningTask;
		console.log(`[TaskManager] R3,R5: Successfully started task ${taskId} - terminal launched and Claude Code started`);
		this.notifyListeners();
		return true;
	}

	pauseTask(taskId: string): boolean {
		console.log(`[TaskManager] R8: Attempting to pause task ${taskId} (manual control)`);
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1 || this.tasks[taskIndex].status !== 'running') {
			console.log(`[TaskManager] R8: Failed to pause task ${taskId} - task not found or not running`);
			return false;
		}

		const task = this.tasks[taskIndex] as RunningTask;
		const pausedTask: PausedTask = {
			...task,
			status: 'paused',
			pausedAt: Date.now()
		};

		this.tasks[taskIndex] = pausedTask;
		console.log(`[TaskManager] R8: Successfully paused task ${taskId} at ${pausedTask.pausedAt}`);
		this.notifyListeners();
		return true;
	}

	resumeTask(taskId: string): boolean {
		console.log(`[TaskManager] R8: Attempting to resume task ${taskId} (manual control)`);
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1 || this.tasks[taskIndex].status !== 'paused') {
			console.log(`[TaskManager] R8: Failed to resume task ${taskId} - task not found or not paused`);
			return false;
		}

		const task = this.tasks[taskIndex] as PausedTask;
		const runningTask: RunningTask = {
			...task,
			status: 'running'
		};

		this.tasks[taskIndex] = runningTask;
		console.log(`[TaskManager] R8: Successfully resumed task ${taskId} - sending continue prompt`);
		this.notifyListeners();
		return true;
	}

	failTask(taskId: string, reason?: string): boolean {
		console.log(`[TaskManager] R15: Marking task ${taskId} as failed - reason: ${reason || 'unspecified'}`);
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) {
			console.log(`[TaskManager] R15: Failed to fail task ${taskId} - task not found`);
			return false;
		}
		
		const task = this.tasks[taskIndex];
		if (task.status !== 'running' && task.status !== 'queued' && task.status !== 'paused') {
			console.log(`[TaskManager] R15: Failed to fail task ${taskId} - invalid status: ${task.status}`);
			return false;
		}

		const failedTask: FailedTask = {
			...task,
			status: 'failed',
			failedAt: Date.now(),
			reason
		};
		
		this.tasks[taskIndex] = failedTask;
		console.log(`[TaskManager] R15: Successfully marked task ${taskId} as failed - will trigger git stash`);
		this.notifyListeners();
		return true;
	}

	completeTask(taskId: string, commitHash: string, dependsOn?: string[]): boolean {
		console.log(`[TaskManager] R10: Completing task ${taskId} with commit hash: ${commitHash}`);
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) {
			console.log(`[TaskManager] R10: Failed to complete task ${taskId} - task not found`);
			return false;
		}
		
		const task = this.tasks[taskIndex];
		if (task.status !== 'in_progress' && task.status !== 'running') {
			console.log(`[TaskManager] R10: Failed to complete task ${taskId} - invalid status: ${task.status}`);
			return false;
		}

		const completedTask: CompletedTask = {
			...task,
			status: 'completed',
			completedAt: Date.now(),
			commitHash,
			isReverted: false,
			dependsOn
		};
		
		this.tasks[taskIndex] = completedTask;
		console.log(`[TaskManager] R10: Successfully completed task ${taskId} - manual commit via button pressed`);
		this.notifyListeners();
		return true;
	}

	// Task queries
	getTasks(): Task[] {
		return [...this.tasks];
	}

	getTask(taskId: string): Task | undefined {
		return this.tasks.find(t => t.id === taskId);
	}

	getPromptingTasks(): PromptingTask[] {
		return this.tasks.filter(t => t.status === 'prompting') as PromptingTask[];
	}

	getQueuedTasks(): QueuedTask[] {
		return this.tasks.filter(t => t.status === 'queued') as QueuedTask[];
	}

	getRunningTasks(): RunningTask[] {
		return this.tasks.filter(t => t.status === 'running') as RunningTask[];
	}

	getPausedTasks(): PausedTask[] {
		return this.tasks.filter(t => t.status === 'paused') as PausedTask[];
	}

	getInProgressTasks(): RunningTask[] {
		return this.tasks.filter(t => t.status === 'running') as RunningTask[];
	}

	getFailedTasks(): FailedTask[] {
		return this.tasks.filter(t => t.status === 'failed') as FailedTask[];
	}

	// Get all tasks that are currently "active" (queued, running, or paused)
	getActiveTasks(): (QueuedTask | RunningTask | PausedTask)[] {
		return this.tasks.filter(t => 
			t.status === 'queued' || t.status === 'running' || t.status === 'paused'
		) as (QueuedTask | RunningTask | PausedTask)[];
	}

	getCompletedTasks(): CompletedTask[] {
		return this.tasks.filter(t => t.status === 'completed') as CompletedTask[];
	}

	getCurrentPromptingTask(): PromptingTask | undefined {
		const promptingTasks = this.getPromptingTasks();
		return promptingTasks[promptingTasks.length - 1]; // Latest prompting task
	}

	getCurrentInProgressTask(): RunningTask | undefined {
		const inProgressTasks = this.getInProgressTasks();
		return inProgressTasks[inProgressTasks.length - 1]; // Latest in-progress task
	}

	// Task fusion logic for multi-task commits
	fuseRunningTasks(): CompletedTask {
		console.log(`[TaskManager] R7,Q1: Starting task fusion - combining running tasks into single commit`);
		const runningTasks = this.getRunningTasks();
		if (runningTasks.length === 0) {
			console.log(`[TaskManager] R7,Q1: No running tasks to fuse - operation failed`);
			throw new Error('No running tasks to fuse');
		}

		console.log(`[TaskManager] R7,Q1: Fusing ${runningTasks.length} running tasks - task IDs: ${runningTasks.map(t => t.id).join(', ')}`);
		const firstTask = runningTasks[0];
		
		// Concatenate all running task prompts with separators
		const fusedPrompt = runningTasks.map(t => t.prompt).join('\n\n---\n\n');
		console.log(`[TaskManager] R7,Q1: Created fused prompt with ${fusedPrompt.length} characters using separator: \\n\\n---\\n\\n`);
		
		const fusedTask: CompletedTask = {
			id: firstTask.id,
			prompt: fusedPrompt,
			createdAt: firstTask.createdAt,
			status: 'completed',
			startedAt: firstTask.startedAt,
			completedAt: Date.now(),
			commitHash: '', // Will be set after actual git commit
			isReverted: false,
			processId: firstTask.processId
		};
		
		// Remove all running tasks from the list
		this.tasks = this.tasks.filter(t => !runningTasks.includes(t as RunningTask));
		console.log(`[TaskManager] Q11: Removed ${runningTasks.length} individual running tasks from data model - they disappear as if they never existed`);
		
		// Insert fused task at the position of the first running task (preserve order)
		const insertIndex = this.tasks.findIndex(t => t.createdAt > firstTask.createdAt);
		this.tasks.splice(insertIndex >= 0 ? insertIndex : this.tasks.length, 0, fusedTask);
		console.log(`[TaskManager] Q11: Inserted fused task at position of first task (ID: ${firstTask.id}) - preserving order in list`);
		
		this.notifyListeners();
		return fusedTask;
	}

	// Ensure there's always an empty task for prompting
	ensureEmptyTask(): void {
		console.log(`[TaskManager] R1,Q5: Checking if empty task creation needed - auto-task creation logic`);
		const hasEmptyPromptingTask = this.tasks.some(t => 
			t.status === 'prompting' && (!t.prompt || t.prompt.trim() === '')
		);
		
		if (!hasEmptyPromptingTask) {
			console.log(`[TaskManager] R1,Q5: No empty prompting task found - creating new empty task automatically`);
			this.createPromptingTask('');
		} else {
			console.log(`[TaskManager] R1,Q5: Empty prompting task already exists - no action needed`);
		}
	}

	// Revert/Restore logic
	getRevertableCommits(): CompletedTask[] {
		return this.getCompletedTasks().filter(task => 
			task.commitHash && 
			task.commitHash !== "NO_CHANGES" && 
			!task.isReverted
		);
	}

	getRestorableCommits(): CompletedTask[] {
		return this.getCompletedTasks().filter(task => 
			task.commitHash && 
			task.commitHash !== "NO_CHANGES" && 
			task.isReverted
		);
	}

	revertTask(taskId: string): boolean {
		const completedTasks = this.getCompletedTasks();
		const taskIndex = completedTasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) return false;

		// Mark this task and all subsequent tasks as reverted
		for (let i = taskIndex; i < completedTasks.length; i++) {
			const task = completedTasks[i];
			const globalIndex = this.tasks.findIndex(t => t.id === task.id);
			if (globalIndex !== -1) {
				(this.tasks[globalIndex] as CompletedTask).isReverted = true;
			}
		}
		this.notifyListeners();
		return true;
	}

	restoreTask(taskId: string): boolean {
		const completedTasks = this.getCompletedTasks();
		const taskIndex = completedTasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) return false;

		// Restore this task and all previous tasks
		for (let i = 0; i <= taskIndex; i++) {
			const task = completedTasks[i];
			const globalIndex = this.tasks.findIndex(t => t.id === task.id);
			if (globalIndex !== -1) {
				(this.tasks[globalIndex] as CompletedTask).isReverted = false;
			}
		}
		this.notifyListeners();
		return true;
	}

	// Get target commit for revert operations
	getRevertTargetCommit(taskId: string): string | undefined {
		const completedTasks = this.getCompletedTasks();
		const taskIndex = completedTasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) return undefined;

		// Find the last valid commit before this task
		for (let i = taskIndex - 1; i >= 0; i--) {
			const task = completedTasks[i];
			if (task.commitHash && task.commitHash !== "NO_CHANGES") {
				return task.commitHash;
			}
		}
		
		// If no previous commits found, cannot revert
		// Return undefined to indicate revert is not possible
		return undefined;
	}

	/**
	 * Perform git revert operation and update task state
	 * @param taskId - ID of the task to revert
	 * @param osSession - OS session for git operations
	 * @returns Promise<boolean> - Success/failure
	 */
	async performRevert(taskId: string, osSession: OsSession): Promise<boolean> {
		try {
			const task = this.getTask(taskId);
			if (!task || task.status !== 'completed' || !task.commitHash || task.commitHash === "NO_CHANGES") {
				console.log(`[TaskManager] Cannot revert task ${taskId} - invalid state`);
				return false;
			}

			// First try to get target commit from task history
			let targetCommitHash = this.getRevertTargetCommit(taskId);
			
			// If no task-based target, fall back to git log (for first task)
			if (!targetCommitHash && task.commitHash) {
				try {
					const { invoke } = await import("@tauri-apps/api/core");
					const { osSessionGetWorkingDirectory } = await import("../bindings/os");
					
					const gitLog = await invoke<string>('execute_command_with_os_session', {
						command: 'git',
						args: ['log', '--oneline', '-n', '2', '--format=%H'],
						directory: osSessionGetWorkingDirectory(osSession),
						osSession
					});
					
					const commits = gitLog.trim().split('\n');
					if (commits.length >= 2) {
						targetCommitHash = commits[1]; // Previous commit
						console.log(`[TaskManager] Using git-based revert to commit: ${targetCommitHash}`);
					}
				} catch (error) {
					console.error(`[TaskManager] Failed to get git log:`, error);
				}
			}
			
			if (!targetCommitHash) {
				console.log(`[TaskManager] No target commit available for revert`);
				return false;
			}
			
			// Perform git revert
			const { GitService } = await import('../services/GitService');
			await GitService.revertToCommit(osSession, targetCommitHash);
			
			// Update task state
			this.revertTask(taskId);
			
			console.log(`[TaskManager] Successfully reverted task ${taskId} to ${targetCommitHash}`);
			// Notify listeners after successful revert
			this.notifyListeners();
			return true;
			
		} catch (error) {
			console.error(`[TaskManager] Failed to revert task ${taskId}:`, error);
			return false;
		}
	}

	/**
	 * Perform git restore operation and update task state
	 * @param taskId - ID of the task to restore
	 * @param osSession - OS session for git operations
	 * @returns Promise<boolean> - Success/failure
	 */
	async performRestore(taskId: string, osSession: OsSession): Promise<boolean> {
		try {
			const task = this.getTask(taskId);
			if (!task || task.status !== 'completed' || !task.commitHash || task.commitHash === "NO_CHANGES") {
				console.log(`[TaskManager] Cannot restore task ${taskId} - invalid state`);
				return false;
			}

			// Perform git restore to task's commit
			const { GitService } = await import('../services/GitService');
			await GitService.revertToCommit(osSession, task.commitHash);
			
			// Update task state
			this.restoreTask(taskId);
			
			console.log(`[TaskManager] Successfully restored task ${taskId} to ${task.commitHash}`);
			// Notify listeners after successful restore
			this.notifyListeners();
			return true;
			
		} catch (error) {
			console.error(`[TaskManager] Failed to restore task ${taskId}:`, error);
			return false;
		}
	}

	// Update task prompt (only for prompting tasks)
	updateTaskPrompt(taskId: string, prompt: string): boolean {
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) return false;
		
		const task = this.tasks[taskIndex];
		if (task.status !== 'prompting') return false;

		this.tasks[taskIndex] = { ...task, prompt };
		this.notifyListeners();
		return true;
	}

	// Update commit hash for completed tasks (used after fusion)
	updateCommitHash(taskId: string, commitHash: string): boolean {
		console.log(`[TaskManager] R10: Updating commit hash for task ${taskId} to: ${commitHash}`);
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) {
			console.log(`[TaskManager] R10: Failed to update commit hash - task ${taskId} not found`);
			return false;
		}
		
		const task = this.tasks[taskIndex];
		if (task.status !== 'completed') {
			console.log(`[TaskManager] R10: Failed to update commit hash - task ${taskId} not completed`);
			return false;
		}

		(this.tasks[taskIndex] as CompletedTask).commitHash = commitHash;
		this.notifyListeners();
		console.log(`[TaskManager] R10: Successfully updated commit hash for task ${taskId}`);
		return true;
	}

	// Serialization for persistence
	toJSON(): any {
		return {
			tasks: this.tasks
		};
	}

	static fromJSON(data: any): TaskManager {
		const manager = new TaskManager();
		if (data && Array.isArray(data.tasks)) {
			manager.tasks = data.tasks;
		}
		return manager;
	}
}