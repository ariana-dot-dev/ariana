import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { GitProject, GitProjectCanvas, ProcessState, CanvasLockState } from '../types/GitProject';
import { CanvasElement } from '../canvas/types';
import { useStore } from '../state';
import { TaskManager } from '../types/Task';
import { BackgroundAgent, MergeResult } from '../types/BackgroundAgent';
import { BackgroundAgentManager } from '../services/BackgroundAgentManager';

interface GitProjectContextValue {
	selectedGitProject: GitProject | null;
	currentCanvas: GitProjectCanvas | null;
	updateCanvasElements: (elements: CanvasElement[]) => void;
	switchCanvas: (canvasIndex: number) => void;
	addCanvas: (canvas?: GitProjectCanvas) => string;
	removeCanvas: (canvasId: string) => boolean;
	renameCanvas: (canvasId: string, name: string) => boolean;
	// Process management
	addProcess: (process: ProcessState) => boolean;
	updateProcess: (processId: string, updates: Partial<ProcessState>) => boolean;
	removeProcess: (processId: string) => boolean;
	getProcessByElementId: (elementId: string) => ProcessState | undefined;
	getCurrentCanvasProcesses: () => ProcessState[];
	// Task management methods
	createTask: (prompt: string) => string | null;
	startTask: (taskId: string, processId?: string) => boolean;
	completeTask: (taskId: string, commitHash: string) => boolean;
	updateTaskPrompt: (taskId: string, prompt: string) => boolean;
	revertTask: (taskId: string) => boolean;
	restoreTask: (taskId: string) => boolean;
	getCurrentTaskManager: () => TaskManager | null;
	// Background agent management
	mergeCanvasToRoot: (canvasId: string) => Promise<MergeResult>;
	getBackgroundAgents: () => BackgroundAgent[];
	removeBackgroundAgent: (agentId: string) => void;
	cancelBackgroundAgent: (agentId: string) => Promise<void>;
	forceRemoveBackgroundAgent: (agentId: string) => Promise<void>;
	// Canvas locking management
	lockCanvas: (canvasId: string, lockState: CanvasLockState, agentId: string) => boolean;
	unlockCanvas: (canvasId: string, agentId?: string) => boolean;
	isCanvasLocked: (canvasId: string) => boolean;
	getCanvasLockState: (canvasId: string) => CanvasLockState | null;
	canEditCanvas: (canvasId: string) => boolean;
	// In-progress prompt management
	setInProgressPrompt: (canvasId: string, elementId: string, prompt: string) => boolean;
}

const GitProjectContext = createContext<GitProjectContextValue | null>(null);

interface GitProjectProviderProps {
	children: ReactNode;
	gitProject: GitProject | null;
}

export function GitProjectProvider({ children, gitProject }: GitProjectProviderProps) {
	const [, forceUpdate] = useState(0);
	const { updateGitProject } = useStore();

	// Set up reactive subscriptions to the GitProject
	useEffect(() => {
		if (!gitProject) {
			return;
		}

		// SECURITY: Ensure repository ID is initialized for this project
		console.log(`🔍 [GitProjectContext] Project provided: ${gitProject.name}`);
		console.log(`🔍 [GitProjectContext] Git URL: ${gitProject.gitOriginUrl}, Repository ID: ${gitProject.repositoryId}`);
		
		if (gitProject.gitOriginUrl && !gitProject.repositoryId) {
			console.log(`🔄 [GitProjectContext] Automatic fallback: Repository ID missing for active project - triggering detection`);
			gitProject.ensureRepositoryId().catch(error => {
				console.error(`❌ [GitProjectContext] Failed to ensure repository ID for active project:`, error);
			});
		}

		const unsubscribeCanvases = gitProject.subscribe('canvases', () => {
			forceUpdate(prev => prev + 1);
		});

		const unsubscribeCurrentCanvas = gitProject.subscribe('currentCanvasIndex', () => {
			forceUpdate(prev => prev + 1);
		});

		const unsubscribeBackgroundAgents = gitProject.subscribe('backgroundAgents', () => {
			forceUpdate(prev => prev + 1);
		});

		// Remove periodic updates - rely on event-driven updates only
		// Background agents will trigger updates through their own events when needed

		return () => {
			unsubscribeCanvases();
			unsubscribeCurrentCanvas();
			unsubscribeBackgroundAgents();
		};
	}, [gitProject, updateGitProject]);

	const currentCanvas = gitProject?.getCurrentCanvas() || null;
	
	const contextValue: GitProjectContextValue = {
		selectedGitProject: gitProject,
		currentCanvas: currentCanvas,
		
		updateCanvasElements: (elements: any[]) => {
			if (!gitProject) return;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (currentCanvas && gitProject.canEditCanvas(currentCanvas.id)) {
				gitProject.updateCanvasElements(currentCanvas.id, elements);
				// Trigger state update to save to disk
				updateGitProject(gitProject.id);
			}
		},

		switchCanvas: (canvasIndex: number) => {
			if (!gitProject) return;
			gitProject.setCurrentCanvasIndex(canvasIndex);
			updateGitProject(gitProject.id);
		},

		addCanvas: (canvas?: any) => {
			if (!gitProject) return '';
			const canvasId = gitProject.addCanvas(canvas);
			updateGitProject(gitProject.id);
			return canvasId;
		},

		removeCanvas: (canvasId: string) => {
			if (!gitProject) return false;
			const result = gitProject.removeCanvas(canvasId);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		renameCanvas: (canvasId: string, name: string) => {
			if (!gitProject) return false;
			const result = gitProject.renameCanvas(canvasId, name);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		// Process management methods
		addProcess: (process: ProcessState) => {
			if (!gitProject) return false;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return false;
			const result = gitProject.addProcessToCanvas(currentCanvas.id, process);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		updateProcess: (processId: string, updates: Partial<ProcessState>) => {
			if (!gitProject) return false;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return false;
			const result = gitProject.updateProcessInCanvas(currentCanvas.id, processId, updates);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		removeProcess: (processId: string) => {
			if (!gitProject) return false;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return false;
			const result = gitProject.removeProcessFromCanvas(currentCanvas.id, processId);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		getProcessByElementId: (elementId: string) => {
			if (!gitProject) return undefined;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return undefined;
			return gitProject.getProcessByElementId(currentCanvas.id, elementId);
		},

		getCurrentCanvasProcesses: () => {
			if (!gitProject) return [];
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return [];
			return gitProject.getCanvasProcesses(currentCanvas.id);
		},

		// Task management methods
		createTask: (prompt: string) => {
			if (!gitProject) return null;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return null;
			
			const taskId = currentCanvas.taskManager.createPromptingTask(prompt);
			updateGitProject(gitProject.id);
			return taskId;
		},

		startTask: (taskId: string, processId?: string) => {
			if (!gitProject) return false;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return false;
			
			const result = currentCanvas.taskManager.startTask(taskId, processId);
			if (result && processId) {
				// Cleanup in-progress prompt when task starts
				const elementId = gitProject.getElementIdByProcessId(currentCanvas.id, processId);
				if (elementId) {
					gitProject.cleanupInProgressPrompt(currentCanvas.id, elementId);
				}
				updateGitProject(gitProject.id);
			}
			return result;
		},

		completeTask: (taskId: string, commitHash: string) => {
			if (!gitProject) return false;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return false;
			
			// Get task to find processId before completing
			const task = currentCanvas.taskManager.getTask(taskId);
			const processId = (task as any)?.processId;
			
			const result = currentCanvas.taskManager.completeTask(taskId, commitHash);
			if (result && processId) {
				// Cleanup in-progress prompt when task completes
				const elementId = gitProject.getElementIdByProcessId(currentCanvas.id, processId);
				if (elementId) {
					gitProject.cleanupInProgressPrompt(currentCanvas.id, elementId);
				}
				updateGitProject(gitProject.id);
			}
			return result;
		},

		updateTaskPrompt: (taskId: string, prompt: string) => {
			if (!gitProject) return false;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return false;
			
			const result = currentCanvas.taskManager.updateTaskPrompt(taskId, prompt);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		revertTask: (taskId: string) => {
			if (!gitProject) return false;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return false;
			
			const result = currentCanvas.taskManager.revertTask(taskId);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		restoreTask: (taskId: string) => {
			if (!gitProject) return false;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return false;
			
			const result = currentCanvas.taskManager.restoreTask(taskId);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		getCurrentTaskManager: () => {
			if (!gitProject) return null;
			const currentCanvas = gitProject.getCurrentCanvas();
			if (!currentCanvas) return null;
			return currentCanvas.taskManager;
		},

		// Background agent management
		mergeCanvasToRoot: async (canvasId: string) => {
			if (!gitProject) return { success: false, error: "No git project" };
			const result = await gitProject.mergeCanvasToRoot(canvasId);
			if (result.success) updateGitProject(gitProject.id);
			return result;
		},

		getBackgroundAgents: () => {
			if (!gitProject) return [];
			return gitProject.backgroundAgents;
		},

		removeBackgroundAgent: (agentId: string) => {
			if (!gitProject) return;
			gitProject.removeBackgroundAgent(agentId);
			updateGitProject(gitProject.id);
		},

		cancelBackgroundAgent: async (agentId: string) => {
			if (!gitProject) return;
			
			// Cancel agent and unlock any locked canvases
			const agent = gitProject.getBackgroundAgent(agentId);
			if (agent) {
				// Cancel the agent
				agent.cancel();
				
				// Unlock any canvases locked by this agent
				gitProject.canvases.forEach(canvas => {
					if (canvas.lockingAgentId === agentId) {
						gitProject.unlockCanvas(canvas.id, agentId);
					}
				});
				
				updateGitProject(gitProject.id);
			}
		},

		forceRemoveBackgroundAgent: async (agentId: string) => {
			if (!gitProject) return;
			
			// Cancel and remove agent with cleanup
			await BackgroundAgentManager.cancelAgent(agentId, gitProject);
			
			// Agent is already removed from GitProject by BackgroundAgentManager
			updateGitProject(gitProject.id);
		},

		// Canvas locking management
		lockCanvas: (canvasId: string, lockState: CanvasLockState, agentId: string) => {
			if (!gitProject) return false;
			const result = gitProject.lockCanvas(canvasId, lockState, agentId);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		unlockCanvas: (canvasId: string, agentId?: string) => {
			if (!gitProject) return false;
			const result = gitProject.unlockCanvas(canvasId, agentId);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

		isCanvasLocked: (canvasId: string) => {
			if (!gitProject) return false;
			return gitProject.isCanvasLocked(canvasId);
		},

		getCanvasLockState: (canvasId: string) => {
			if (!gitProject) return null;
			return gitProject.getCanvasLockState(canvasId);
		},

		canEditCanvas: (canvasId: string) => {
			if (!gitProject) return false;
			return gitProject.canEditCanvas(canvasId);
		},

		// In-progress prompt management
		setInProgressPrompt: (canvasId: string, elementId: string, prompt: string) => {
			if (!gitProject) return false;
			const result = gitProject.setInProgressPrompt(canvasId, elementId, prompt);
			if (result) updateGitProject(gitProject.id);
			return result;
		},

	};

	return (
		<GitProjectContext.Provider value={contextValue}>
			{children}
		</GitProjectContext.Provider>
	);
}

export function useGitProject(): GitProjectContextValue {
	const context = useContext(GitProjectContext);
	if (!context) {
		throw new Error('useGitProject must be used within a GitProjectProvider');
	}
	return context;
}

// Hook to get the OsSession from the current GitProject
export function useOsSession() {
	const { selectedGitProject } = useGitProject();
	return selectedGitProject?.osSession || null;
}