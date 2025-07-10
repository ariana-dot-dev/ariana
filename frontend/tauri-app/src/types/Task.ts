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

	// Update task prompt (only for prompting tasks)
	updateTaskPrompt(taskId: string, prompt: string): boolean {
		const taskIndex = this.tasks.findIndex(t => t.id === taskId);
		if (taskIndex === -1) return false;
		
		const task = this.tasks[taskIndex];
		if (task.status !== 'prompting') return false;

		this.tasks[taskIndex] = { ...task, prompt };
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