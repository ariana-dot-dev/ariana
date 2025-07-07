import React, { useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import CanvasView from "./CanvasView";
import { useGitProject } from "./contexts/GitProjectContext";
import { cn } from "./utils";
import { useStore } from "./state";
import { BackgroundAgentsList } from "./components/BackgroundAgentsList";
import { BackgroundAgentTerminalView } from "./components/BackgroundAgentTerminalView";
import { CanvasesList } from "./components/CanvasesList";

const GitProjectView: React.FC<{}> = ({ }) => {
	const { 
		selectedGitProject, 
		currentCanvas, 
		updateCanvasElements, 
		mergeCanvasToRoot,
		getBackgroundAgents,
		removeBackgroundAgent,
		forceRemoveBackgroundAgent,
		getCanvasLockState,
		canEditCanvas
	} = useGitProject();
	const { updateGitProject, removeGitProject } = useStore();
	const [showCanvases, setShowCanvases] = useState(true);
	const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
	const [mergingCanvases, setMergingCanvases] = useState<Set<string>>(new Set());
	const [viewingAgent, setViewingAgent] = useState<string | null>(null);

	const canvasesHoveredRef = useRef(false);

	// Handle canvas merge to root
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
	const handleCreateCanvas = async () => {
		setIsCreatingCanvas(true);
		console.log("Creating new canvas copy...");
		
		try {
			const result = await selectedGitProject!.addCanvasCopy();
			
			if (result.success && result.canvasId) {
				selectedGitProject!.setCurrentCanvasIndex(selectedGitProject!.canvases.length - 1);
				console.log("New canvas copy created with ID:", result.canvasId);
				// Trigger state update to save to disk
				updateGitProject(selectedGitProject!.id);
			} else {
				console.error("Failed to create canvas copy:", result.error);
				alert(`Failed to create canvas copy: ${result.error}`);
			}
		} catch (error) {
			console.error("Unexpected error creating canvas copy:", error);
			alert(`Unexpected error: ${error}`);
		} finally {
			setIsCreatingCanvas(false);
		}
	};

	// Handle canvas selection
	const handleCanvasSelect = (index: number) => {
		selectedGitProject!.setCurrentCanvasIndex(index);
		// Trigger state update to save to disk
		updateGitProject(selectedGitProject!.id);
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
			if (!canvas?.osSession) return;

			let explorerPath = "";
			if ('Local' in canvas.osSession) {
				explorerPath = canvas.osSession.Local;
			} else if ('Wsl' in canvas.osSession) {
				// Convert WSL path to Windows explorer path
				explorerPath = `\\\\wsl$\\${canvas.osSession.Wsl.distribution}${canvas.osSession.Wsl.working_directory.replace(/\//g, '\\')}`;
			}

			if (explorerPath) {
				await invoke("open_path_in_explorer", { path: explorerPath });
			}
		} catch (error) {
			console.error("Failed to open workspace in explorer:", error);
		}
	};

	// Delete workspace
	const deleteWorkspace = async (canvasId: string) => {
		if (!selectedGitProject) return;
		
		try {
			const canvas = selectedGitProject.canvases.find(c => c.id === canvasId);
			if (!canvas?.osSession) return;

			let deletePath = "";
			if ('Local' in canvas.osSession) {
				deletePath = canvas.osSession.Local;
			} else if ('Wsl' in canvas.osSession) {
				deletePath = canvas.osSession.Wsl.working_directory;
			}

			if (!deletePath) return;

			const confirmed = window.confirm(`Are you sure you want to permanently delete this workspace and all its files? This action cannot be undone.\n\nPath: ${deletePath}`);
			if (confirmed) {
				// Delete from filesystem first using osSession-aware deletion
				await invoke("delete_path_with_os_session", { 
					path: deletePath, 
					osSession: canvas.osSession 
				});
				// Then remove from project
				selectedGitProject.removeCanvas(canvasId);
				updateGitProject(selectedGitProject.id);
				console.log(`Deleted workspace from filesystem and project: ${canvasId}`);
			}
		} catch (error) {
			console.error("Failed to delete workspace:", error);
			alert(`Failed to delete workspace: ${error}`);
		}
	};

	console.log("GitProjectView render:", {
		selectedGitProject: selectedGitProject?.name,
		currentCanvas: currentCanvas?.name,
		canvasCount: selectedGitProject?.canvases.length,
		currentCanvasElements: currentCanvas?.elements.length || 0,
		canvasTaskCounts: selectedGitProject?.canvases.map((c, index) => ({
			index: index,
			counts: getCanvasTaskCounts(c.id)
		})) || []
	});

	// Auto-create first canvas if none exist
	useEffect(() => {
		if (selectedGitProject && selectedGitProject.canvases.length === 0) {
			console.log("No canvases found, creating first version...");
			const createFirstCanvas = async () => {
				try {
					const result = await selectedGitProject.addCanvasCopy();
					if (result.success) {
						console.log("First canvas created with ID:", result.canvasId);
						updateGitProject(selectedGitProject.id);
					} else {
						console.error("Failed to create first canvas:", result.error);
					}
				} catch (error) {
					console.error("Error creating first canvas:", error);
				}
			};
			createFirstCanvas();
		}
	}, [selectedGitProject?.id, selectedGitProject?.canvases.length, updateGitProject]);

	return selectedGitProject ? (
		<div className="w-full h-full flex gap-1.5">
			<div
				className={cn(
					"group flex flex-col gap-1.5 transition-all outline-0 rounded-md select-none relative z-50 border-[var(--acc-400-50)]",
					showCanvases
						? "w-64"
						: "w-1 my-0 hover:w-3 not-hover:bg-[var(--base-400-20)] hover:border-2",
				)}
			>
				{showCanvases && (
					<>
						{/* Project Directory Header */}
						<div className="w-full pl-3 py-2">
							<div className="text-sm text-[var(--base-500-50)]">
								{getProjectDirectoryName()}
							</div>
						</div>
						
						<div className="flex flex-col h-full w-full overflow-y-auto">
							<div className="flex flex-col">
								<CanvasesList
									canvases={selectedGitProject.canvases}
									currentCanvasId={currentCanvas?.id || null}
									onCanvasSelect={handleCanvasSelect}
									onCreateCanvas={handleCreateCanvas}
									onMergeCanvas={handleMergeCanvas}
									getCanvasTaskCounts={getCanvasTaskCounts}
									getCanvasLockState={getCanvasLockState}
									isCreatingCanvas={isCreatingCanvas}
									mergingCanvases={mergingCanvases}
									onShowInExplorer={showWorkspaceInExplorer}
									onDeleteWorkspace={deleteWorkspace}
								/>
							</div>

							{/* Background Agents List */}
							<BackgroundAgentsList 
								agents={getBackgroundAgents()} 
								onRemoveAgent={removeBackgroundAgent}
								onForceRemoveAgent={forceRemoveBackgroundAgent}
								onSelectAgent={setViewingAgent}
								selectedAgentId={viewingAgent}
							/>
						</div>
					</>
				)}
			</div>
			{viewingAgent ? (
				// Show background agent terminal view
				(() => {
					const agent = getBackgroundAgents().find(a => a.id === viewingAgent);
					return agent ? (
						<div className="w-full h-full animate-fade-in opacity-100" key={`agent-${agent.id}`}>
							<BackgroundAgentTerminalView 
								agent={agent}
								onClose={() => setViewingAgent(null)}
							/>
						</div>
					) : (
						<div className="w-full h-full flex items-center justify-center relative z-10">
							<div className="text-center text-[var(--base-600)]">
								<div className="text-lg">Agent not found</div>
								<button 
									onClick={(e) => {
										console.log('Back to Canvases clicked');
										e.preventDefault();
										e.stopPropagation();
										setViewingAgent(null);
									}}
									className="mt-2 px-3 py-1 bg-[var(--base-200)] rounded hover:bg-[var(--base-300)] cursor-pointer transition-colors border border-[var(--base-400)] text-[var(--base-700)] hover:text-[var(--base-800)] active:bg-[var(--base-400)] select-none"
									style={{ pointerEvents: 'auto' }}
								>
									Close
								</button>
							</div>
						</div>
					);
				})()
			) : currentCanvas ? (
				<div className="w-full h-full animate-fade-in opacity-100" key={currentCanvas.id}>
					<CanvasView
						elements={currentCanvas.elements}
						onElementsChange={updateCanvasElements}
					/>
				</div>
			) : (
				<div className="w-full h-full flex items-center justify-center">
					<div className="text-center text-[var(--base-600)]">
						<div className="text-lg">Creating first version...</div>
						<div className="text-sm mt-2">Please wait while we set up your project workspace</div>
					</div>
				</div>
			)}
		</div>
	) : (<></>);
};

export default GitProjectView;
