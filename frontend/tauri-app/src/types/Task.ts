import { OsSession } from "../bindings/os";

export type TaskStatus = 'prompting' | 'in_progress' | 'completed';

export interface TaskBase {
	id: string;
	prompt: string;
	createdAt: number;
	status: TaskStatus;
}

export interface PromptingTask extends TaskBase {
	status: 'prompting';
}

export interface InProgressTask extends TaskBase {
	status: 'in_progress';
	startedAt: number;
	processId?: string; // Link to ProcessState if needed
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

export type Task = PromptingTask | InProgressTask | CompletedTask;

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
		return task.id;
	}

	startTask(taskId: string, processId?: string): boolean {
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) return false;
		
		const task = this.tasks[taskIndex];
		if (task.status !== 'prompting') return false;

		const inProgressTask: InProgressTask = {
			...task,
			status: 'in_progress',
			startedAt: Date.now(),
			processId
		};
		
		this.tasks[taskIndex] = inProgressTask;
		this.notifyListeners();
		return true;
	}

	completeTask(taskId: string, commitHash: string, dependsOn?: string[]): boolean {
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) return false;
		
		const task = this.tasks[taskIndex];
		if (task.status !== 'in_progress') return false;

		const completedTask: CompletedTask = {
			...task,
			status: 'completed',
			completedAt: Date.now(),
			commitHash,
			isReverted: false,
			dependsOn
		};
		
		this.tasks[taskIndex] = completedTask;
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

	getInProgressTasks(): InProgressTask[] {
		return this.tasks.filter(t => t.status === 'in_progress') as InProgressTask[];
	}

	getCompletedTasks(): CompletedTask[] {
		return this.tasks.filter(t => t.status === 'completed') as CompletedTask[];
	}

	getCurrentPromptingTask(): PromptingTask | undefined {
		const promptingTasks = this.getPromptingTasks();
		return promptingTasks[promptingTasks.length - 1]; // Latest prompting task
	}

	getCurrentInProgressTask(): InProgressTask | undefined {
		const inProgressTasks = this.getInProgressTasks();
		return inProgressTasks[inProgressTasks.length - 1]; // Latest in-progress task
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