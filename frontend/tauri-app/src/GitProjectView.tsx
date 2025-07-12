import React, { useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import CanvasView from "./CanvasView";
import { useGitProject } from "./contexts/GitProjectContext";
import { cn } from "./utils";
import { useStore } from "./state";
import { UnifiedCanvasAgentList } from "./components/UnifiedCanvasAgentList";
import { AgentOverview } from "./components/AgentOverview";
import { osSessionGetWorkingDirectory } from "./bindings/os";

interface GitProjectViewProps {
	onGoHome?: () => void;
}

const GitProjectView: React.FC<GitProjectViewProps> = ({ onGoHome }) => {
	const { 
		selectedGitProject, 
		currentCanvas, 
		updateCanvasElements, 
		mergeCanvasToRoot,
		getBackgroundAgents,
		removeBackgroundAgent,
		cancelBackgroundAgent,
		forceRemoveBackgroundAgent,
		getCanvasLockState,
		canEditCanvas,
		getCurrentTaskManager
	} = useGitProject();
	const { updateGitProject, removeGitProject } = useStore();
	const [showCanvases, setShowCanvases] = useState(true);
	const [mergingCanvases, setMergingCanvases] = useState<Set<string>>(new Set());
	const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<'canvas' | 'overview'>('canvas');

	const canvasesHoveredRef = useRef(false);

	// Handle canvas merge to root
	const handleShowInExplorer = async (itemId: string) => {
		if (!selectedGitProject) return;

		// Check if it's a canvas
		const canvas = selectedGitProject.canvases.find(c => c.id === itemId);
		if (canvas && canvas.osSession) {
			const path = osSessionGetWorkingDirectory(canvas.osSession);
			if (path) {
				try {
					await invoke("open_path_in_explorer_with_os_session", {
						path: path,
						osSession: canvas.osSession
					});
				} catch (error) {
					console.error("Failed to open canvas in explorer:", error);
				}
			}
			return;
		}

		// Check if it's a background agent
		const agent = getBackgroundAgents().find(a => a.id === itemId);
		if (agent && agent.workspaceOsSession) {
			const path = osSessionGetWorkingDirectory(agent.workspaceOsSession);
			if (path) {
				try {
					await invoke("open_path_in_explorer_with_os_session", {
						path: path,
						osSession: agent.workspaceOsSession
					});
				} catch (error) {
					console.error("Failed to open agent workspace in explorer:", error);
				}
			}
			return;
		}
	};

	const handleMergeCanvas = async (canvasId: string) => {
		setMergingCanvases(prev => new Set(prev).add(canvasId));
		
		try {
			const result = await mergeCanvasToRoot(canvasId);
			
			if (result.success) {
				console.log('Merge initiated successfully, agent ID:', result.agentId);
			} else {
				console.error('Failed to start merge:', result.error);
				alert(`Failed to start merge: ${result.error}`);
			}
		} catch (error) {
			console.error('Unexpected error during merge:', error);
			alert(`Unexpected error: ${error}`);
		} finally {
			setMergingCanvases(prev => {
				const newSet = new Set(prev);
				newSet.delete(canvasId);
				return newSet;
			});
		}
	};

	// Handle canvas creation
	const handleCreateCanvas = (): string | undefined => {
		if (!selectedGitProject) return undefined;
		
		console.log("Creating new canvas copy...");
		
		const result = selectedGitProject.addCanvasCopy();
		
		if (result.success && result.canvasId) {
			selectedGitProject.setCurrentCanvasIndex(selectedGitProject.canvases.length - 1);
			console.log("New canvas copy created with ID:", result.canvasId);
			// Auto-select the new canvas
			setSelectedItemId(result.canvasId);
			// Trigger state update to save to disk
			updateGitProject(selectedGitProject.id);
			return result.canvasId;
		} else {
			console.error("Failed to create canvas copy:", result.error);
			alert(`Failed to create canvas copy: ${result.error}`);
			return undefined;
		}
	};

	// Agent Overview handler functions
	const handleAddPrompt = (canvasId: string, prompt: string) => {
		console.log('🎯 [PROMPT] handleAddPrompt called - Canvas ID:', canvasId, 'Prompt:', prompt);
		
		if (!selectedGitProject) {
			console.error('❌ [PROMPT] No selected git project');
			return;
		}
		
		const canvas = selectedGitProject.canvases.find(c => c.id === canvasId);
		if (!canvas) {
			console.error('❌ [PROMPT] Canvas not found:', canvasId);
			return;
		}
		
		console.log('✅ [PROMPT] Found canvas:', canvas.id, 'Task manager available:', !!canvas.taskManager);
		
		// Create a new prompting task with the provided prompt
		const taskId = canvas.taskManager.createPromptingTask(prompt);
		console.log(`✅ [PROMPT] Created new prompting task ${taskId} for canvas ${canvasId}`);
		
		// Save the updated project
		updateGitProject(selectedGitProject.id);
		console.log('💾 [PROMPT] Updated git project after adding prompt');
	};

	// Handle prompt deletion
	const handlePromptDeletion = (promptId: string, agentId: string) => {
		if (!selectedGitProject) return;
		
		const canvas = selectedGitProject.canvases.find(c => c.id === agentId);
		if (!canvas) return;
		
		// If this is a task ID rather than a prompt ID, handle task deletion
		const task = canvas.taskManager.getTask(promptId);
		if (task && task.status === 'prompting') {
			const deleted = canvas.taskManager.deleteTask(promptId);
			if (deleted) {
				console.log(`Deleted prompting task ${promptId} from canvas ${agentId}`);
				updateGitProject(selectedGitProject.id);
			}
		}
		
		console.log(`Prompt deletion handled for prompt ${promptId} in agent ${agentId}`);
	};

	const handlePlayCanvas = (canvasId: string) => {
		if (!selectedGitProject) return;
		
		const canvas = selectedGitProject.canvases.find(c => c.id === canvasId);
		if (!canvas) return;
		
		// Switch to this canvas and let the user interact with it
		const canvasIndex = selectedGitProject.canvases.findIndex(c => c.id === canvasId);
		if (canvasIndex !== -1) {
			selectedGitProject.setCurrentCanvasIndex(canvasIndex);
			updateGitProject(selectedGitProject.id);
			setSelectedItemId(canvasId);
			// Switch to canvas view
			setViewMode('canvas');
		}
	};

	const handlePauseCanvas = (canvasId: string) => {
		if (!selectedGitProject) return;
		
		const canvas = selectedGitProject.canvases.find(c => c.id === canvasId);
		if (!canvas) return;
		
		// For now, we'll just log this since there's no direct pause mechanism for tasks
		// In a full implementation, this would interact with running processes
		console.log(`Pause requested for canvas ${canvasId}`);
		
		// Cancel any running background agents for this canvas
		const runningAgents = getBackgroundAgents().filter(agent => 
			agent.status === 'running' && agent.context && 
			(agent.context as any).canvasId === canvasId
		);
		
		runningAgents.forEach(agent => {
			cancelBackgroundAgent(agent.id);
		});
	};

	const handleRunTest = (canvasId: string) => {
		if (!selectedGitProject) return;
		
		const canvas = selectedGitProject.canvases.find(c => c.id === canvasId);
		if (!canvas?.osSession) return;
		
		// This would typically run tests in the canvas workspace
		// For now, we'll just log and potentially switch to the canvas
		console.log(`Run test requested for canvas ${canvasId}`);
		
		// Switch to this canvas so user can see the test results
		const canvasIndex = selectedGitProject.canvases.findIndex(c => c.id === canvasId);
		if (canvasIndex !== -1) {
			selectedGitProject.setCurrentCanvasIndex(canvasIndex);
			updateGitProject(selectedGitProject.id);
			setSelectedItemId(canvasId);
			// Switch to canvas view
			setViewMode('canvas');
		}
	};

	// Handle unified item selection (canvas, background agent, or overview)
	const handleItemSelect = (itemId: string | null) => {
		if (!itemId || !selectedGitProject) {
			setSelectedItemId(null);
			setViewMode('canvas');
			return;
		}

		// Check if it's the overview
		if (itemId === 'agent-overview') {
			setViewMode('overview');
			setSelectedItemId(itemId);
			return;
		}


		// Check if it's a canvas
		const canvasIndex = selectedGitProject.canvases.findIndex(c => c.id === itemId);
		if (canvasIndex !== -1) {
			// It's a canvas - switch to it
			selectedGitProject.setCurrentCanvasIndex(canvasIndex);
			updateGitProject(selectedGitProject.id);
			setSelectedItemId(itemId);
			setViewMode('canvas');
			return;
		}

		// Check if it's a background agent
		const agent = getBackgroundAgents().find(a => a.id === itemId);
		if (agent) {
			// It's a background agent - just select it for status display
			setSelectedItemId(itemId);
			setViewMode('canvas');
			return;
		}

		// Unknown item
		setSelectedItemId(null);
		setViewMode('canvas');
	};

	// Get the directory name from the project root
	const getProjectDirectoryName = () => {
		if (!selectedGitProject) return "";
		const root = selectedGitProject.root;
		if ('Local' in root) {
			const path = root.Local;
			return path.split('/').pop() || path.split('\\').pop() || path;
		} else if ('Wsl' in root) {
			const path = root.Wsl.working_directory;
			return path.split('/').pop() || path.split('\\').pop() || path;
		}
		return "";
	};

	// Compute task progress for each canvas using TaskManager (persistent data)
	const getCanvasTaskCounts = (canvasId: string) => {
		if (!selectedGitProject) return { running: 0, finished: 0, error: 0, total: 0 };
		
		const canvas = selectedGitProject.canvases.find(c => c.id === canvasId);
		if (!canvas?.taskManager) return { running: 0, finished: 0, error: 0, total: 0 };
		
		const taskManager = canvas.taskManager;
		const allTasks = taskManager.getTasks();
		const running = taskManager.getInProgressTasks().length;
		const finished = taskManager.getCompletedTasks().length;
		const total = allTasks.length;
		
		// For error count, we could check processes since tasks don't have error state yet
		const processes = canvas.runningProcesses || [];
		const error = processes.filter(p => p.status === 'error').length;
		
		return { running, finished, error, total };
	};

	// Show workspace in explorer
	const showWorkspaceInExplorer = async (canvasId: string) => {
		if (!selectedGitProject) return;
		
		try {
			const canvas = selectedGitProject.canvases.find(c => c.id === canvasId);
			if (!canvas?.osSession) {
				console.warn("Canvas osSession is not ready yet. Cannot open in explorer.");
				return;
			}

			// Get the working directory path for this canvas
			const workingDir = 'Local' in canvas.osSession 
				? canvas.osSession.Local 
				: canvas.osSession.Wsl.working_directory;

			// Use the new function that properly handles osSession
			await invoke("open_path_in_explorer_with_os_session", { 
				path: workingDir,
				osSession: canvas.osSession 
			});
		} catch (error) {
			console.error("Failed to open workspace in explorer:", error);
		}
	};

	// Delete workspace
	const deleteWorkspace = async (canvasId: string) => {
		if (!selectedGitProject) return;
		
		try {
			const canvas = selectedGitProject.canvases.find(c => c.id === canvasId);
			if (!canvas?.osSession) {
				console.warn("Canvas osSession is not ready yet. Cannot delete workspace.");
				return;
			}

			let deletePath = "";
			if ('Local' in canvas.osSession) {
				deletePath = canvas.osSession.Local;
			} else if ('Wsl' in canvas.osSession) {
				deletePath = canvas.osSession.Wsl.working_directory;
			}

			if (!deletePath) return;

			const confirmed = window.confirm(`Are you sure you want to permanently delete this workspace and all its files? This action cannot be undone.\n\nPath: ${deletePath}`);
			if (confirmed) {
				// Try to return to pool first (for reuse if possible)
				try {
					await selectedGitProject.returnCanvasCopy(canvasId);
				} catch (returnError) {
					console.warn('Could not return canvas to pool, deleting instead:', returnError);
					// Delete from filesystem using osSession-aware deletion
					await invoke("delete_path_with_os_session", { 
						path: deletePath, 
						osSession: canvas.osSession 
					});
				}
				
				// Remove from project
				selectedGitProject.removeCanvas(canvasId);
				updateGitProject(selectedGitProject.id);
				console.log(`Deleted workspace from project: ${canvasId}`);
			}
		} catch (error) {
			console.error("Failed to delete workspace:", error);
			alert(`Failed to delete workspace: ${error}`);
		}
	};

	// Auto-create first canvas if none exist
	useEffect(() => {
		if (selectedGitProject && selectedGitProject.canvases.length === 0) {
			console.log("No canvases found, creating first version...");
			const result = selectedGitProject.addCanvasCopy();
			if (result.success) {
				console.log("First canvas created with ID:", result.canvasId);
				updateGitProject(selectedGitProject.id);
			} else {
				console.error("Failed to create first canvas:", result.error);
			}
		}
	}, [selectedGitProject?.id, selectedGitProject?.canvases.length, updateGitProject]);

	// Show overview when no canvases are available
	useEffect(() => {
		if (selectedGitProject && selectedGitProject.canvases.length === 0 && viewMode === 'canvas') {
			setViewMode('overview');
			setSelectedItemId('agent-overview');
		}
	}, [selectedGitProject?.canvases.length, viewMode]);

	// Sync selectedItemId with current canvas (only in canvas mode)
	useEffect(() => {
		if (viewMode === 'canvas' && currentCanvas && selectedItemId !== currentCanvas.id) {
			setSelectedItemId(currentCanvas.id);
		}
	}, [currentCanvas?.id, selectedItemId, viewMode]);


	return selectedGitProject ? (
		<div className="w-full h-full flex gap-1.5">
			<div
				className={cn(
					"group flex flex-col gap-1.5 transition-all outline-0 rounded-md select-none relative z-50 border-[var(--acc-400-50)]",
					showCanvases
						? "w-64"
						: "w-1 my-0 hover:w-3 not-hover:bg-[var(--base-400-20)] hover:border-(length:--border)",
				)}
			>
				{showCanvases && (
					<>
						{/* Back to Projects Button */}
						{onGoHome && (
							<div className="w-full pl-3 pt-2 pb-1">
								<button 
									onClick={onGoHome}
									className="flex items-center gap-2 text-xs text-[var(--base-600)] hover:text-[var(--base-800)] transition-colors cursor-pointer"
								>
									<span>←</span>
									<span>Projects</span>
								</button>
							</div>
						)}
						
						{/* Project Directory Header */}
						<div className="w-full pl-3 py-2">
							<div className="text-sm text-[var(--base-500-50)]">
								{getProjectDirectoryName()}
							</div>
						</div>
						
						<div className="flex flex-col gap-2 h-full w-full overflow-y-auto">
							<div className="flex gap-2">
								<button
									onClick={handleCreateCanvas}
									className="flex-1 px-3 py-2 text-sm border-[var(--base-300)] border-dashed hover:border-solid border-(length:--border) cursor-pointer hover:bg-[var(--acc-100-70)] text-[var(--acc-800-70)] rounded-lg transition-colors flex items-center justify-center gap-2"
								>
									<span>+ new edit</span>
								</button>
							</div>

							{/* Agent Overview Item */}
							<div className="flex flex-col gap-1">
								<button
									onClick={() => handleItemSelect('agent-overview')}
									className={`w-full px-3 py-2 text-sm rounded-lg transition-colors text-left flex items-center gap-2 ${
										selectedItemId === 'agent-overview'
											? 'bg-[var(--acc-500)] text-white'
											: 'hover:bg-[var(--acc-100-70)] text-[var(--base-700)]'
									}`}
								>
									<span>📊</span>
									<span>Agent Overview</span>
								</button>
							</div>

							{/* Unified Canvas and Agent List */}
							<UnifiedCanvasAgentList
								canvases={selectedGitProject.canvases}
								backgroundAgents={getBackgroundAgents()}
								selectedItemId={selectedItemId}
								onSelectItem={handleItemSelect}
								onRemoveCanvas={deleteWorkspace}
								onCancelAgent={cancelBackgroundAgent}
								onForceRemoveAgent={forceRemoveBackgroundAgent}
								onMergeCanvas={handleMergeCanvas}
								onShowInExplorer={handleShowInExplorer}
							/>
						</div>
					</>
				)}
			</div>
			{viewMode === 'overview' ? (
				<div className="w-full h-full animate-fade-in opacity-100">
					<AgentOverview
						canvases={selectedGitProject.canvases}
						backgroundAgents={getBackgroundAgents()}
						project={selectedGitProject}
						onAddPrompt={handleAddPrompt}
						onPlayCanvas={handlePlayCanvas}
						onPauseCanvas={handlePauseCanvas}
						onDeleteCanvas={deleteWorkspace}
						onMergeCanvas={handleMergeCanvas}
						onRunTest={handleRunTest}
						onCreateAgent={handleCreateCanvas}
						taskManager={getCurrentTaskManager()}
						onProjectUpdate={() => updateGitProject(selectedGitProject.id)}
						onPromptDeleted={handlePromptDeletion}
					/>
				</div>
			) : currentCanvas ? (
				<div className="w-full h-full animate-fade-in opacity-100" key={currentCanvas.id}>
					{currentCanvas.lockState === 'loading' ? (
						<div className="w-full h-full flex items-center justify-center">
							<div className="text-center text-[var(--base-600)]">
								<div className="text-lg">Setting up workspace...</div>
								<div className="text-sm mt-2">
									{currentCanvas.copyProgress ? 
										`${currentCanvas.copyProgress.percentage.toFixed(0)}% - ${currentCanvas.copyProgress.speed}` :
										'Preparing copy...'
									}
								</div>
								{currentCanvas.copyProgress && (
									<div className="w-64 bg-[var(--base-200)] rounded-full h-2 mt-3">
										<div 
											className="bg-[var(--acc-500)] h-2 rounded-full transition-all duration-300"
											style={{ width: `${currentCanvas.copyProgress.percentage}%` }}
										/>
									</div>
								)}
							</div>
						</div>
					) : (
						<CanvasView
							elements={currentCanvas.elements}
							onElementsChange={updateCanvasElements}
						/>
					)}
				</div>
			) : (
				<div className="w-full h-full flex items-center justify-center">
					<div className="text-center text-[var(--base-600)]">
						<div className="text-lg">No workspace available</div>
						<div className="text-sm mt-2">Click "+ New Agent" to create your first workspace</div>
					</div>
				</div>
			)}
		</div>
	) : (<></>);
};

export default GitProjectView;
