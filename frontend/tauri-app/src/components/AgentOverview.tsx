import React, { useState, useMemo } from 'react';
import { GitProjectCanvas, CanvasLockState, GitProject } from '../types/GitProject';
import { BackgroundAgent, BackgroundAgentStatus } from '../types/BackgroundAgent';
import { Task, TaskStatus, TaskManager } from '../types/Task';
import { CollectiveBacklogManagement } from './CollectiveBacklogManagement';

interface AgentOverviewProps {
	canvases: GitProjectCanvas[];
	backgroundAgents: BackgroundAgent[];
	project?: GitProject; // Add project to access git origin URL
	onAddPrompt?: (canvasId: string, prompt: string) => void;
	onPlayCanvas?: (canvasId: string) => void;
	onPauseCanvas?: (canvasId: string) => void;
	onDeleteCanvas?: (canvasId: string) => void;
	onMergeCanvas?: (canvasId: string) => void;
	onRunTest?: (canvasId: string) => void;
	onCreateAgent?: () => string | undefined; // Returns the new agent ID
	taskManager?: TaskManager; // Add task manager for task linking
	onProjectUpdate?: () => void; // Callback to save project state
	onPromptDeleted?: (promptId: string, agentId: string) => void; // Callback for prompt deletion
}

export const AgentOverview: React.FC<AgentOverviewProps> = ({
	canvases,
	backgroundAgents,
	project,
	onAddPrompt,
	onPlayCanvas,
	onPauseCanvas,
	onDeleteCanvas,
	onMergeCanvas,
	onRunTest,
	onCreateAgent,
	taskManager,
	onProjectUpdate,
	onPromptDeleted
}) => {
	const [promptInputs, setPromptInputs] = useState<{[key: string]: string}>({});
	const [showPromptInput, setShowPromptInput] = useState<{[key: string]: boolean}>({});
	const [dragState, setDragState] = useState<{
		draggedTaskId: string | null;
		draggedCanvasId: string | null;
		dragOverIndex: number | null;
		dragOverCanvasId: string | null;
		isDragging: boolean;
	}>({
		draggedTaskId: null,
		draggedCanvasId: null,
		dragOverIndex: null,
		dragOverCanvasId: null,
		isDragging: false
	});

	// Use ref to persist drag state across re-renders
	const dragStateRef = React.useRef(dragState);
	React.useEffect(() => {
		dragStateRef.current = dragState;
	}, [dragState]);
	const [selectedCanvases, setSelectedCanvases] = useState<Set<string>>(new Set());
	const [selectedBackgroundAgents, setSelectedBackgroundAgents] = useState<Set<string>>(new Set());

	// Selection helper functions
	const toggleCanvasSelection = (canvasId: string) => {
		setSelectedCanvases(prev => {
			const newSet = new Set(prev);
			if (newSet.has(canvasId)) {
				newSet.delete(canvasId);
			} else {
				newSet.add(canvasId);
			}
			return newSet;
		});
	};

	const toggleAllCanvases = () => {
		if (selectedCanvases.size === canvases.length) {
			setSelectedCanvases(new Set());
		} else {
			setSelectedCanvases(new Set(canvases.map(c => c.id)));
		}
	};

	const toggleBackgroundAgentSelection = (agentId: string) => {
		setSelectedBackgroundAgents(prev => {
			const newSet = new Set(prev);
			if (newSet.has(agentId)) {
				newSet.delete(agentId);
			} else {
				newSet.add(agentId);
			}
			return newSet;
		});
	};

	const toggleAllBackgroundAgents = () => {
		if (selectedBackgroundAgents.size === backgroundAgents.length) {
			setSelectedBackgroundAgents(new Set());
		} else {
			setSelectedBackgroundAgents(new Set(backgroundAgents.map(a => a.id)));
		}
	};

	const clearSelection = () => {
		setSelectedCanvases(new Set());
		setSelectedBackgroundAgents(new Set());
	};

	const selectedAgentIds = [...selectedCanvases, ...selectedBackgroundAgents];

	const getCanvasTaskCounts = (canvasId: string) => {
		const canvas = canvases.find(c => c.id === canvasId);
		if (!canvas?.taskManager) return { running: 0, finished: 0, total: 0 };
		
		const taskManager = canvas.taskManager;
		const allTasks = taskManager.getTasks();
		const running = taskManager.getInProgressTasks().length;
		const finished = taskManager.getCompletedTasks().length;
		const total = allTasks.length;
		
		return { running, finished, total };
	};

	const getCanvasActiveTasks = (canvasId: string) => {
		const canvas = canvases.find(c => c.id === canvasId);
		if (!canvas?.taskManager) return [];
		
		return canvas.taskManager.getTasks().filter(task => 
			task.status === 'prompting' || task.status === 'in_progress' || task.status === 'completed'
		);
	};

	const getCanvasStatus = (canvas: GitProjectCanvas) => {
		const lockState = canvas.lockState || 'normal';
		const taskCounts = getCanvasTaskCounts(canvas.id);
		
		if (lockState === 'merged') return 'Merged';
		if (lockState === 'merging') return 'Merging';
		if (lockState === 'loading') return 'Loading';
		if (taskCounts.running > 0) return 'Running';
		if (taskCounts.total > 0 && taskCounts.finished === taskCounts.total) return 'Completed';
		if (taskCounts.total > 0) return 'In Progress';
		return 'Idle';
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case 'Running':
			case 'In Progress':
			case 'Merging':
			case 'Loading':
			case 'initializing':
			case 'checking':
				return 'bg-[var(--acc-100)] text-[var(--acc-700)]';
			case 'Completed':
			case 'Merged':
			case 'running':
			case 'completed':
				return 'bg-[var(--positive-100)] text-[var(--positive-700)]';
			case 'Failed':
			case 'failed':
				return 'bg-[var(--negative-100)] text-[var(--negative-700)]';
			case 'Idle':
				return 'bg-[var(--base-200)] text-[var(--base-700)]';
			default:
				return 'bg-[var(--base-200)] text-[var(--base-700)]';
		}
	};

	const getStatusText = (status: string) => {
		switch (status) {
			case 'initializing': return 'Setting up...';
			case 'checking': return 'Checking conflicts...';
			case 'running': return 'Resolving...';
			case 'completed': return 'Completed';
			case 'failed': return 'Failed';
			default: return status;
		}
	};

	const handleAddPrompt = (canvasId: string, prompt: string) => {
		if (onAddPrompt) {
			onAddPrompt(canvasId, prompt);
		}
		setPromptInputs(prev => ({...prev, [canvasId]: ''}));
		setShowPromptInput(prev => ({...prev, [canvasId]: false}));
	};

	// Drag and drop handlers for prompt reordering
	const handleDragStart = (e: React.DragEvent, taskId: string, canvasId: string) => {
		e.stopPropagation();
		e.dataTransfer.setData('text/plain', taskId);
		e.dataTransfer.effectAllowed = 'move';
		
		const newState = {
			draggedTaskId: taskId,
			draggedCanvasId: canvasId,
			dragOverIndex: null,
			dragOverCanvasId: null,
			isDragging: true
		};
		
		setDragState(newState);
	};

	const handleDragEnd = (e: React.DragEvent) => {
		e.stopPropagation();
		
		// Only reset if we didn't successfully drop (dropEffect would be 'move' if successful)
		if (e.dataTransfer.dropEffect !== 'move') {
			setDragState({
				draggedTaskId: null,
				draggedCanvasId: null,
				dragOverIndex: null,
				dragOverCanvasId: null,
				isDragging: false
			});
		}
	};

	const handleDragOver = (e: React.DragEvent, index: number, canvasId: string) => {
		e.preventDefault();
		e.stopPropagation();
		
		if (e.dataTransfer.effectAllowed === 'move') {
			e.dataTransfer.dropEffect = 'move';
		} else {
			e.dataTransfer.dropEffect = 'copy';
		}
		
		if (dragStateRef.current.isDragging) {
			const newState = {
				...dragStateRef.current,
				dragOverIndex: index,
				dragOverCanvasId: canvasId
			};
			
			setDragState(newState);
		}
	};

	const handleDragLeave = (e: React.DragEvent) => {
		setDragState(prev => ({
			...prev,
			dragOverIndex: null,
			dragOverCanvasId: null
		}));
	};

	const handleDrop = (e: React.DragEvent, targetIndex: number, targetCanvasId: string) => {
		e.preventDefault();
		e.stopPropagation();

		const { draggedTaskId, draggedCanvasId } = dragStateRef.current;
		
		if (!draggedTaskId || !draggedCanvasId) {
			return;
		}

		// Set successful drop effect
		e.dataTransfer.dropEffect = 'move';

		// If dropping within the same canvas, reorder tasks
		if (draggedCanvasId === targetCanvasId) {
			const canvas = canvases.find(c => c.id === targetCanvasId);
			
			if (canvas && canvas.taskManager) {
				const draggedIndex = canvas.taskManager.getTaskIndex(draggedTaskId);
				
				if (draggedIndex !== -1) {
					const success = canvas.taskManager.moveTask(draggedTaskId, targetIndex);
					
					if (success && onProjectUpdate) {
						onProjectUpdate();
					}
				}
			}
		} else {
			const sourceCanvas = canvases.find(c => c.id === draggedCanvasId);
			const targetCanvas = canvases.find(c => c.id === targetCanvasId);
			
			if (sourceCanvas && targetCanvas && sourceCanvas.taskManager && targetCanvas.taskManager) {
				const task = sourceCanvas.taskManager.getTask(draggedTaskId);
				
				if (task && task.status === 'prompting') {
					const deleteSuccess = sourceCanvas.taskManager.deleteTask(draggedTaskId);
					
					if (deleteSuccess) {
						const newTaskId = targetCanvas.taskManager.createPromptingTask(task.prompt);
						const newIndex = Math.min(targetIndex, targetCanvas.taskManager.getTasks().length - 1);
						const moveSuccess = targetCanvas.taskManager.moveTask(newTaskId, newIndex);
						
						if (onProjectUpdate) {
							onProjectUpdate();
						}
					}
				}
			}
		}

		// Reset drag state
		setDragState({
			draggedTaskId: null,
			draggedCanvasId: null,
			dragOverIndex: null,
			dragOverCanvasId: null,
			isDragging: false
		});
	};

	const handleRunStopCanvas = (canvasId: string) => {
		const canvas = canvases.find(c => c.id === canvasId);
		if (!canvas) return;
		
		const status = getCanvasStatus(canvas);
		
		if (status === 'Running' && onPauseCanvas) {
			onPauseCanvas(canvasId);
		} else if (onPlayCanvas) {
			onPlayCanvas(canvasId);
		}
	};

	const generateCanvasName = (canvas: GitProjectCanvas, canvasIndex: number): string => {
		try {
			const tasks = canvas.taskManager.getTasks();
			
			// Check for in-progress prompts first
			if (canvas.inProgressPrompts && canvas.inProgressPrompts.size > 0) {
				for (const prompt of canvas.inProgressPrompts.values()) {
					if (prompt.trim()) {
						let cleanPrompt = prompt.trim();
						cleanPrompt = cleanPrompt.replace(/\([^)]*\)/g, '').trim();
						const words = cleanPrompt.split(/\s+/).filter(word => word.length > 0);
						const firstThreeWords = words.slice(0, 3).join(' ');
						if (firstThreeWords) {
							return firstThreeWords;
						}
					}
				}
			}
			
			// Fall back to completed tasks
			if (tasks.length === 0) {
				return `Agent ${canvasIndex + 1}`;
			}

			// Get the last task's prompt
			const lastTask = tasks[tasks.length - 1];
			let prompt = lastTask.prompt.trim();

			// Remove content in parentheses
			prompt = prompt.replace(/\([^)]*\)/g, '').trim();

			// Take first 3 words
			const words = prompt.split(/\s+/).filter(word => word.length > 0);
			const firstThreeWords = words.slice(0, 3).join(' ');

			return firstThreeWords || `Agent ${canvasIndex + 1}`;
		} catch (error) {
			console.error('Error generating canvas name:', error);
			return `Agent ${canvasIndex + 1}`;
		}
	};

	return (
		<div className="w-full h-full bg-[var(--base-50)] overflow-y-auto">
			{/* Header */}
			<div className="sticky top-0 bg-[var(--base-100)] border-b border-[var(--base-300)] p-4">
				<div>
					<h1 className="text-xl font-semibold text-[var(--base-800)]">Agent Overview</h1>
					<p className="text-sm text-[var(--base-600)] mt-1">
						Manage your agents and their tasks
					</p>
				</div>
			</div>

			<div className="p-4 space-y-6">
				{/* Agents Table */}
				<div className="bg-[var(--base-100)] rounded-lg p-4 border border-[var(--base-300)]">
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-medium text-[var(--base-800)]">Agents</h3>
						<div className="flex items-center gap-4">
							{(selectedCanvases.size > 0 || selectedBackgroundAgents.size > 0) && (
								<div className="flex items-center gap-2">
									<span className="text-sm text-[var(--base-600)]">
										{selectedCanvases.size + selectedBackgroundAgents.size} selected
									</span>
									<button
										onClick={clearSelection}
										className="text-xs px-2 py-1 bg-[var(--base-200)] text-[var(--base-700)] rounded hover:bg-[var(--base-300)] transition-colors"
									>
										Clear
									</button>
									<div className="flex gap-1">
										{selectedCanvases.size > 0 && (
											<>
												<button
													onClick={() => {
														selectedCanvases.forEach(id => onPlayCanvas?.(id));
														clearSelection();
													}}
													className="text-xs px-2 py-1 bg-[var(--positive-500)] text-white rounded hover:bg-[var(--positive-600)] transition-colors"
												>
													▶ Start ({selectedCanvases.size})
												</button>
												<button
													onClick={() => {
														selectedCanvases.forEach(id => onPauseCanvas?.(id));
														clearSelection();
													}}
													className="text-xs px-2 py-1 bg-[var(--base-500)] text-white rounded hover:bg-[var(--base-600)] transition-colors"
												>
													⏸ Pause ({selectedCanvases.size})
												</button>
												<button
													onClick={() => {
														selectedCanvases.forEach(id => onDeleteCanvas?.(id));
														clearSelection();
													}}
													className="text-xs px-2 py-1 bg-[var(--negative-500)] text-white rounded hover:bg-[var(--negative-600)] transition-colors"
												>
													🗑 Delete ({selectedCanvases.size})
												</button>
											</>
										)}
									</div>
								</div>
							)}
							<span className="text-sm text-[var(--base-600)]">
								{canvases.length} agent{canvases.length !== 1 ? 's' : ''}
								{backgroundAgents.length > 0 && ` • ${backgroundAgents.length} background`}
							</span>
						</div>
					</div>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead className="border-b border-[var(--base-300)]">
								<tr className="text-left">
									<th className="pb-2 font-medium text-[var(--base-700)] w-8">
										<input
											type="checkbox"
											checked={canvases.length > 0 && selectedCanvases.size === canvases.length}
											onChange={toggleAllCanvases}
											className="rounded border-[var(--base-400)]"
										/>
									</th>
									<th className="pb-2 font-medium text-[var(--base-700)] w-32">Agent Name</th>
									<th className="pb-2 font-medium text-[var(--base-700)] w-auto">Prompts</th>
									<th className="pb-2 font-medium text-[var(--base-700)] w-24">Status</th>
									<th className="pb-2 font-medium text-[var(--base-700)] w-32">Actions</th>
									<th className="pb-2 font-medium text-[var(--base-700)] w-20">Test</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--base-200)]">
								{/* Canvas Agents */}
								{canvases.map((canvas, index) => {
									const activeTasks = getCanvasActiveTasks(canvas.id);
									const status = getCanvasStatus(canvas);
									const agentName = generateCanvasName(canvas, index);
									
									return (
										<tr key={canvas.id} className={`hover:bg-[var(--base-50)] ${selectedCanvases.has(canvas.id) ? 'bg-[var(--acc-100)]' : ''}`}>
											<td className="py-3 pr-4">
												<input
													type="checkbox"
													checked={selectedCanvases.has(canvas.id)}
													onChange={() => toggleCanvasSelection(canvas.id)}
													className="rounded border-[var(--base-400)]"
												/>
											</td>
											<td className="py-3 pr-4">
												<div className="flex items-center gap-2">
													<div className="w-2 h-2 rounded-full bg-[var(--acc-500)]"></div>
													<div className="font-medium text-[var(--base-800)]">
														{agentName}
													</div>
												</div>
											</td>
											<td className="py-3 pr-4">
												<div className="w-full">
													{/* Active Tasks */}
													{activeTasks.length > 0 && (
														<div className="space-y-1 mb-2">
															<div className="text-xs font-medium text-[var(--base-700)]">Active:</div>
															{activeTasks.slice(0, 10).map((task, i) => (
																<React.Fragment key={i}>
																	{/* Drop zone above each task */}
																	<div 
																		className={`h-2 transition-all ${
																			dragState.dragOverIndex === i && dragState.dragOverCanvasId === canvas.id 
																				? 'border-t-2 border-[var(--acc-500)] bg-[var(--acc-50)]' 
																				: 'hover:bg-[var(--base-100)]'
																		}`}
																		onDragEnter={(e) => {
																			e.preventDefault();
																			e.stopPropagation();
																		}}
																		onDragOver={(e) => {
																			handleDragOver(e, i, canvas.id);
																		}}
																		onDragLeave={(e) => {
																			handleDragLeave(e);
																		}}
																		onDrop={(e) => {
																			handleDrop(e, i, canvas.id);
																		}}
																		onMouseEnter={() => {
																			if (dragStateRef.current.isDragging) {
																				setDragState(prev => ({
																					...prev,
																					dragOverIndex: i,
																					dragOverCanvasId: canvas.id
																				}));
																			}
																		}}
																		onClick={() => {
																			if (dragStateRef.current.isDragging) {
																				const mockEvent = { 
																					preventDefault: () => {}, 
																					stopPropagation: () => {},
																					dataTransfer: { getData: () => dragStateRef.current.draggedTaskId }
																				} as any;
																				handleDrop(mockEvent, i, canvas.id);
																			}
																		}}
																	></div>
																	
																	{/* Task content (draggable if prompting) */}
																	<div 
																		className="text-xs text-[var(--base-600)] flex items-start gap-1 group transition-all min-h-[20px] hover:bg-[var(--base-50)]"
																		draggable={task.status === 'prompting'}
																		onDragStart={(e) => {
																			if (task.status === 'prompting') {
																				handleDragStart(e, task.id, canvas.id);
																			}
																		}}
																		onDragEnd={handleDragEnd}
																	>
																		{/* Drag handle for prompting tasks */}
																		{task.status === 'prompting' && (
																			<span 
																				className="text-xs text-[var(--base-400)] cursor-move opacity-0 group-hover:opacity-100 transition-opacity select-none"
																				title="Drag to reorder or move to another agent"
																			>
																				⋮⋮
																			</span>
																		)}
																		<span className={`w-1.5 h-1.5 rounded-full mt-0.5 flex-shrink-0 ${
																			task.status === 'in_progress' ? 'bg-[var(--acc-500)]' :
																			task.status === 'completed' ? 'bg-[var(--positive-500)]' :
																			'bg-[var(--base-400)]'
																		}`}></span>
																		<span className="break-words flex-1">{task.prompt}</span>
																		{/* Delete button for prompting tasks */}
																		{task.status === 'prompting' && onPromptDeleted && (
																			<button
																				onClick={() => onPromptDeleted(task.id, canvas.id)}
																				className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--negative-500)] hover:text-[var(--negative-600)] text-xs px-1"
																				title="Delete this prompt"
																			>
																				×
																			</button>
																		)}
																	</div>
																</React.Fragment>
															))}
															{activeTasks.length > 10 && (
																<div className="text-xs text-[var(--base-500)]">
																	+{activeTasks.length - 10} more
																</div>
															)}
															
															{/* Drop zone at the end of the list */}
															<div 
																className={`h-4 transition-all bg-transparent hover:bg-[var(--base-100)] ${
																	dragState.dragOverIndex === activeTasks.length && dragState.dragOverCanvasId === canvas.id 
																		? 'border-b-2 border-[var(--acc-500)] bg-[var(--acc-50)]' 
																		: ''
																}`}
																onMouseEnter={() => {
																	if (dragStateRef.current.isDragging) {
																		setDragState(prev => ({
																			...prev,
																			dragOverIndex: activeTasks.length,
																			dragOverCanvasId: canvas.id
																		}));
																	}
																}}
																onClick={() => {
																	if (dragStateRef.current.isDragging) {
																		const mockEvent = { 
																			preventDefault: () => {}, 
																			stopPropagation: () => {},
																			dataTransfer: { getData: () => dragStateRef.current.draggedTaskId }
																		} as any;
																		handleDrop(mockEvent, activeTasks.length, canvas.id);
																	}
																}}
																onDragEnter={(e) => {
																	e.preventDefault();
																	e.stopPropagation();
																}}
																onDragOver={(e) => {
																	handleDragOver(e, activeTasks.length, canvas.id);
																}}
																onDragLeave={(e) => {
																	handleDragLeave(e);
																}}
																onDrop={(e) => {
																	handleDrop(e, activeTasks.length, canvas.id);
																}}
															></div>
														</div>
													)}

													{/* No tasks message */}
													{activeTasks.length === 0 && (
														<div className="text-xs text-[var(--base-500)] mb-2">No prompts yet</div>
													)}
													
													{/* Inline prompt input */}
													{showPromptInput[canvas.id] ? (
														<div className="flex gap-2 items-center">
															<input
																type="text"
																value={promptInputs[canvas.id] || ''}
																onChange={(e) => setPromptInputs(prev => ({...prev, [canvas.id]: e.target.value}))}
																placeholder="Enter prompt..."
																className="flex-1 px-2 py-1 text-xs border border-[var(--base-300)] rounded focus:outline-none focus:border-[var(--acc-500)]"
																onKeyPress={(e) => {
																	if (e.key === 'Enter') {
																		handleAddPrompt(canvas.id, promptInputs[canvas.id] || '');
																	}
																}}
															/>
															<button
																onClick={() => handleAddPrompt(canvas.id, promptInputs[canvas.id] || '')}
																className="px-2 py-1 text-xs bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] transition-colors"
															>
																Execute
															</button>
															<button
																onClick={() => setShowPromptInput(prev => ({...prev, [canvas.id]: false}))}
																className="px-1 py-1 text-xs bg-[var(--base-400)] text-white rounded hover:bg-[var(--base-500)] transition-colors"
															>
																×
															</button>
														</div>
													) : (
														<button
															onClick={() => setShowPromptInput(prev => ({...prev, [canvas.id]: !prev[canvas.id]}))}
															className="text-xs text-[var(--acc-600)] hover:text-[var(--acc-700)] font-medium"
														>
															+ Add Prompt
														</button>
													)}
												</div>
											</td>
											<td className="py-3 pr-4">
												<span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(status)}`}>
													{status}
												</span>
											</td>
											<td className="py-3 pr-4">
												<div className="flex items-center gap-2">
													<div className="relative group">
														<button
															onClick={() => handleRunStopCanvas(canvas.id)}
															className="p-2 text-xs bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] transition-colors flex items-center justify-center"
															title={status === 'Running' ? 'Stop agent' : 'Run agent'}
														>
															{status === 'Running' ? (
																<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																	<path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 9 14H7a1.5 1.5 0 0 1-1.5-1.5v-9z"/>
																</svg>
															) : (
																<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																	<path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z"/>
																</svg>
															)}
														</button>
														<div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-[var(--base-900)] text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 pointer-events-none">
															{status === 'Running' ? 'Stop' : 'Run'}
														</div>
													</div>
													<div className="relative group">
														<button
															onClick={() => onMergeCanvas && onMergeCanvas(canvas.id)}
															className="p-2 text-xs bg-[var(--positive-500)] text-white rounded hover:bg-[var(--positive-600)] transition-colors flex items-center justify-center"
															title="Merge to main"
															disabled={status === 'Merged' || status === 'Merging'}
														>
															<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																<path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022Z"/>
															</svg>
														</button>
														<div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-[var(--base-900)] text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 pointer-events-none">
															Merge
														</div>
													</div>
													<div className="relative group">
														<button
															onClick={() => onDeleteCanvas && onDeleteCanvas(canvas.id)}
															className="p-2 text-xs bg-[var(--negative-500)] text-white rounded hover:bg-[var(--negative-600)] transition-colors flex items-center justify-center"
															title="Delete agent"
															disabled={canvases.length <= 1}
														>
															<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
																<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
															</svg>
														</button>
														<div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-[var(--base-900)] text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 pointer-events-none">
															Delete
														</div>
													</div>
												</div>
											</td>
											<td className="py-3">
												<button
													onClick={() => onRunTest && onRunTest(canvas.id)}
													className="px-2 py-1 text-xs bg-[var(--base-500)] text-white rounded hover:bg-[var(--base-600)] transition-colors"
													title="Test branch"
												>
													Test
												</button>
											</td>
										</tr>
									);
								})}
								
								{/* Background Agents */}
								{backgroundAgents.map((agent) => (
									<tr key={agent.id} className={`hover:bg-[var(--base-50)] ${selectedBackgroundAgents.has(agent.id) ? 'bg-[var(--acc-100)]' : ''}`}>
										<td className="py-3 pr-4">
											<input
												type="checkbox"
												checked={selectedBackgroundAgents.has(agent.id)}
												onChange={() => toggleBackgroundAgentSelection(agent.id)}
												className="rounded border-[var(--base-400)]"
											/>
										</td>
										<td className="py-3 pr-4">
											<div className="flex items-center gap-2">
												<div className={`w-2 h-2 rounded-full ${
													agent.status === 'running' || agent.status === 'preparation' ? 'bg-[var(--acc-500)]' :
													agent.status === 'completed' ? 'bg-[var(--positive-600)]' :
													agent.status === 'failed' ? 'bg-[var(--negative-600)]' :
													'bg-[var(--base-400)]'
												}`}></div>
												<div className="font-medium text-[var(--base-800)]">
													{agent.type} Agent
												</div>
											</div>
										</td>
										<td className="py-3 pr-4">
											<div className="max-w-xs">
												{agent.progress ? (
													<div className="text-xs text-[var(--base-600)] truncate">
														{agent.progress}
													</div>
												) : (
													<span className="text-xs text-[var(--base-500)]">Autonomous operation</span>
												)}
											</div>
										</td>
										<td className="py-3 pr-4">
											<span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(agent.status)}`}>
												{getStatusText(agent.status)}
											</span>
										</td>
										<td className="py-3 pr-4">
											<div className="flex items-center gap-2">
												<div className="relative group">
													<button
														className="p-2 text-xs bg-[var(--base-400)] text-white rounded cursor-not-allowed flex items-center justify-center"
														title="Background agents run autonomously"
														disabled
													>
														<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
															<path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 9 14H7a1.5 1.5 0 0 1-1.5-1.5v-9z"/>
														</svg>
													</button>
													<div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-[var(--base-900)] text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 pointer-events-none">
														Auto-running
													</div>
												</div>
												<div className="relative group">
													<button
														className="p-2 text-xs bg-[var(--negative-500)] text-white rounded hover:bg-[var(--negative-600)] transition-colors flex items-center justify-center"
														title="Delete agent"
													>
														<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
															<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
														</svg>
													</button>
													<div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-[var(--base-900)] text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 pointer-events-none">
														Delete
													</div>
												</div>
											</div>
										</td>
										<td className="py-3">
											<span className="text-xs text-[var(--base-500)]">
												N/A
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
				
				{/* Action Buttons */}
				<div className="flex justify-end items-center">
					<button
						onClick={onCreateAgent}
						className="flex items-center gap-2 px-4 py-2 bg-[var(--positive-500)] hover:bg-[var(--positive-600)] text-white rounded transition-colors text-sm font-medium"
						title="Create a new agent"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
							<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
							<path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
						</svg>
						Create New Agent
					</button>
				</div>
				

				
				{/* Collective Backlog Management - Hidden during drag to prevent re-renders */}
				{!dragState.isDragging && (
					<div className="mt-6">
						<CollectiveBacklogManagement 
							project={project}
							onCreateAgent={onCreateAgent}
							onAddPrompt={onAddPrompt}
							selectedAgents={selectedAgentIds}
							canvases={canvases.map(c => ({ id: c.id, lockState: c.lockState }))}
							onPromptDeleted={onPromptDeleted}
						/>
					</div>
				)}
			</div>
		</div>
	);
};