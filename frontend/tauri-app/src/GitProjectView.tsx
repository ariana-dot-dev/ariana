import React, { useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import CanvasView from "./CanvasView";
import { useGitProject } from "./contexts/GitProjectContext";
import { cn } from "./utils";
import { useStore } from "./state";
import { UnifiedCanvasAgentList } from "./components/UnifiedCanvasAgentList";
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
		canEditCanvas
	} = useGitProject();
	const { updateGitProject, removeGitProject } = useStore();
	const [showCanvases, setShowCanvases] = useState(true);
	const [mergingCanvases, setMergingCanvases] = useState<Set<string>>(new Set());
	const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

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
	const handleCreateCanvas = () => {
		if (!selectedGitProject) return;
		
		console.log("Creating new canvas copy...");
		
		const result = selectedGitProject.addCanvasCopy();
		
		if (result.success && result.canvasId) {
			selectedGitProject.setCurrentCanvasIndex(selectedGitProject.canvases.length - 1);
			console.log("New canvas copy created with ID:", result.canvasId);
			// Auto-select the new canvas
			setSelectedItemId(result.canvasId);
			// Trigger state update to save to disk
			updateGitProject(selectedGitProject.id);
		} else {
			console.error("Failed to create canvas copy:", result.error);
			alert(`Failed to create canvas copy: ${result.error}`);
		}
	};

	// Handle unified item selection (canvas or background agent)
	const handleItemSelect = (itemId: string | null) => {
		if (!itemId || !selectedGitProject) {
			setSelectedItemId(null);
			return;
		}

		// Check if it's a canvas
		const canvasIndex = selectedGitProject.canvases.findIndex(c => c.id === itemId);
		if (canvasIndex !== -1) {
			// It's a canvas - switch to it
			selectedGitProject.setCurrentCanvasIndex(canvasIndex);
			updateGitProject(selectedGitProject.id);
			setSelectedItemId(itemId);
			return;
		}

		// Check if it's a background agent
		const agent = getBackgroundAgents().find(a => a.id === itemId);
		if (agent) {
			// It's a background agent - just select it for status display
			setSelectedItemId(itemId);
			return;
		}

		// Unknown item
		setSelectedItemId(null);
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

	// Sync selectedItemId with current canvas
	useEffect(() => {
		if (currentCanvas && selectedItemId !== currentCanvas.id) {
			setSelectedItemId(currentCanvas.id);
		}
	}, [currentCanvas?.id, selectedItemId]);

	return selectedGitProject ? (
		<div className="w-full h-full flex gap-1.5">
			<div
				className={cn(
					"group flex flex-col gap-1.5 transition-all outline-0 rounded-md select-none relative z-50 border-[var(--acc-400-50)]",
					showCanvases
						? "w-[40ch]"
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
							<button
								onClick={handleCreateCanvas}
								className="self-end w-fit text-xs px-3 py-2 bg-[var(--positive-100-50)] border-[var(--positive-600-50)] hover:border-[var(--positive-600-70)] border-dashed hover:border-solid border-(length:--border) cursor-pointer hover:bg-[var(--positive-100-70)] text-[var(--positive-600-50)] hover:text-[var(--positive-600)] rounded-xl transition-colors flex items-center justify-center gap-2"
							>
								<span>+ New Agent</span>
							</button>

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
			{currentCanvas ? (
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
