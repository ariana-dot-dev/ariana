import React, { useState, useRef, useEffect } from 'react';
import { SingleChoiceList } from './ChoiceList';
import { UnifiedListItem, isCanvasItem, isBackgroundAgentItem, createCanvasItem, createBackgroundAgentItem } from '../types/UnifiedListTypes';
import { GitProjectCanvas, CanvasLockState } from '../types/GitProject';
import { BackgroundAgent, BackgroundAgentStatus } from '../types/BackgroundAgent';
import { BackgroundAgentsList } from './BackgroundAgentsList';
import { Task } from '../types/Task';
import { cn } from '../utils';

// Marquee component for scrolling text
const Marquee: React.FC<{ text: string; isActive: boolean; className?: string }> = ({ text, isActive, className = '' }) => {
	const [shouldAnimate, setShouldAnimate] = useState(false);
	const textRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!textRef.current || !containerRef.current) return;

		const textWidth = textRef.current.scrollWidth;
		const containerWidth = containerRef.current.clientWidth;

		// Only animate if text overflows and marquee is active
		setShouldAnimate(isActive && textWidth > containerWidth);
	}, [text, isActive]);

	return (
		<div ref={containerRef} className={`relative overflow-hidden ${className}`}>
			<div
				ref={textRef}
				className={`whitespace-nowrap ${shouldAnimate ? 'animate-marquee' : ''
					}`}
				style={{
					animationDuration: shouldAnimate ? `${text.length * 0.1}s` : undefined,
				}}
			>
				{text}
				{shouldAnimate && <span className="px-8">{text}</span>}
			</div>
		</div>
	);
};

interface UnifiedCanvasAgentListProps {
	canvases: GitProjectCanvas[];
	backgroundAgents: BackgroundAgent[];
	selectedItemId?: string | null;
	onSelectItem?: (id: string | null) => void;
	onRemoveCanvas?: (canvasId: string) => void;
	onRemoveCanvasNoConfirm?: (canvasId: string) => void;
	onCancelAgent?: (agentId: string) => void;
	onForceRemoveAgent?: (agentId: string) => Promise<void>;
	onMergeCanvas?: (canvasId: string) => void;
	onShowInExplorer?: (itemId: string) => void;
	onOpenTerminal?: (canvasId: string) => void;
	onCreateCanvas?: () => string | undefined;
}

const StatusIndicator: React.FC<{ status: BackgroundAgentStatus }> = ({ status }) => {
	const getStatusDisplay = () => {
		switch (status) {
			case 'queued': return { text: 'Queued', color: 'text-[var(--base-600)]' };
			case 'preparation': return { text: 'Preparing...', color: 'text-[var(--acc-600)]' };
			case 'running': return { text: 'Running...', color: 'text-[var(--positive-600)]' };
			case 'completed': return { text: 'Completed', color: 'text-[var(--positive-600)]' };
			case 'failed': return { text: 'Failed', color: 'text-[var(--negative-600)]' };
			case 'cancelled': return { text: 'Cancelled', color: 'text-[var(--base-500)]' };
			default: return { text: 'Unknown', color: 'text-[var(--base-500)]' };
		}
	};

	const { text, color } = getStatusDisplay();
	return <span className={`text-xs ${color}`}>{text}</span>;
};

const hasCompletedTasks = (canvas: GitProjectCanvas): boolean => {
	const tasks = canvas.taskManager.getTasks();
	return tasks.some(task => task.status === 'completed');
};

const generateCanvasName = (canvas: GitProjectCanvas, canvasIndex: number): string => {
	return `Agent ${canvasIndex + 1}`;
};

const getCanvasTaskInfo = (canvas: GitProjectCanvas): { prompt: string; isLoading: boolean; isCompleted: boolean; isPrompting: boolean } => {
	try {
		const tasks = canvas.taskManager.getTasks();

		// Check if there's an in-progress task (actual running task)
		const inProgressTask = tasks.find(task => task.status === 'running');
		if (inProgressTask) {
			let prompt = inProgressTask.prompt.trim();
			prompt = prompt.replace(/\([^)]*\)/g, '').trim();
			return { prompt, isLoading: true, isCompleted: false, isPrompting: false };
		}

		// Check for in-progress prompts (user typing)
		if (canvas.inProgressPrompts && canvas.inProgressPrompts.size > 0) {
			// Get the most recent in-progress prompt
			for (const prompt of canvas.inProgressPrompts.values()) {
				if (prompt.trim()) {
					console.log("[getCanvasTaskInfo] In-progress prompt: '", prompt, "'");
					let cleanPrompt = prompt.trim();
					// Remove content in parentheses
					cleanPrompt = cleanPrompt.replace(/\([^)]*\)/g, '').trim();
					return { prompt: cleanPrompt, isLoading: false, isCompleted: false, isPrompting: true };
				}
			}
		}

		// Get the last completed task
		const completedTasks = tasks.filter(task => task.status === 'completed');
		if (completedTasks.length > 0) {
			const lastTask = completedTasks[completedTasks.length - 1];
			let prompt = lastTask.prompt.trim();
			prompt = prompt.replace(/\([^)]*\)/g, '').trim();
			return { prompt, isLoading: false, isCompleted: true, isPrompting: false };
		}

		// No tasks
		return { prompt: '', isLoading: false, isCompleted: false, isPrompting: false };
	} catch (error) {
		console.error('Error getting canvas task info:', error);
		return { prompt: '', isLoading: false, isCompleted: false, isPrompting: false };
	}
};

const LockStateIndicator: React.FC<{ lockState: CanvasLockState }> = ({ lockState }) => {
	switch (lockState) {
		case 'loading':
			return <span className="text-xs text-[var(--acc-600)]">Loading...</span>;
		case 'merging':
			return <span className="text-xs text-[var(--acc-600)]">Merging...</span>;
		case 'merged':
			return <span className="text-xs text-[var(--positive-600)]">Merged ✓</span>;
		default:
			return null;
	}
};

export const UnifiedCanvasAgentList: React.FC<UnifiedCanvasAgentListProps> = ({
	canvases,
	backgroundAgents,
	selectedItemId,
	onSelectItem,
	onRemoveCanvas,
	onRemoveCanvasNoConfirm,
	onCancelAgent,
	onForceRemoveAgent,
	onMergeCanvas,
	onShowInExplorer,
	onOpenTerminal,
	onCreateCanvas
}) => {
	const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: UnifiedListItem } | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const [hoveredCanvasId, setHoveredCanvasId] = useState<string | null>(null);
	const [selectedCanvases, setSelectedCanvases] = useState<Set<string>>(new Set());
	const [lastClickedCanvas, setLastClickedCanvas] = useState<string | null>(null);

	// Handle canvas selection
	const handleCanvasClick = (canvasId: string, event: React.MouseEvent) => {
		event.stopPropagation();

		if (event.shiftKey && lastClickedCanvas) {
			// Shift-click: range selection
			const currentIndex = canvases.findIndex(c => c.id === canvasId);
			const lastIndex = canvases.findIndex(c => c.id === lastClickedCanvas);

			if (currentIndex !== -1 && lastIndex !== -1) {
				const startIndex = Math.min(currentIndex, lastIndex);
				const endIndex = Math.max(currentIndex, lastIndex);

				const rangeCanvases = canvases.slice(startIndex, endIndex + 1);

				setSelectedCanvases(prev => {
					const newSet = new Set(prev);
					rangeCanvases.forEach(canvas => newSet.add(canvas.id));
					return newSet;
				});
				// Update last clicked canvas and navigate to the clicked canvas
				setLastClickedCanvas(canvasId);
				onSelectItem?.(canvasId);
			}
		} else {
			// Regular click: select only this canvas and navigate
			setSelectedCanvases(new Set([canvasId]));
			setLastClickedCanvas(canvasId);
			onSelectItem?.(canvasId);
		}
	};

	// Create separate lists
	const canvasItems: UnifiedListItem[] = canvases.map(createCanvasItem);
	const agentItems: UnifiedListItem[] = backgroundAgents.map(createBackgroundAgentItem);

	// Handle clicks outside context menu
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
				setContextMenu(null);
			}
		};

		if (contextMenu) {
			document.addEventListener('mousedown', handleClickOutside);
			return () => {
				document.removeEventListener('mousedown', handleClickOutside);
			};
		}
	}, [contextMenu]);

	const handleContextMenu = (e: React.MouseEvent, itemId: string) => {
		e.preventDefault();
		e.stopPropagation();
		const item = [...canvasItems, ...agentItems].find(i => i.id === itemId);
		if (item) {
			setContextMenu({
				x: e.clientX,
				y: e.clientY,
				item
			});
		}
	};

	const handleShowInExplorer = (itemId: string) => {
		if (onShowInExplorer) {
			onShowInExplorer(itemId);
		}
		setContextMenu(null);
	};

	const handleRemoveCanvas = (canvasId: string) => {
		if (onRemoveCanvas) {
			onRemoveCanvas(canvasId);
		}
		setContextMenu(null);
	};

	const handleRemoveMultipleCanvases = () => {
		setContextMenu(null);

		if (onRemoveCanvasNoConfirm && selectedCanvases.size > 0) {
			const canvasIds = Array.from(selectedCanvases);
			canvasIds.forEach(canvasId => {
				onRemoveCanvasNoConfirm(canvasId);
			});
			setSelectedCanvases(new Set());
		}
	};

	const handleMergeCanvas = (canvasId: string) => {
		if (onMergeCanvas) {
			onMergeCanvas(canvasId);
		}
		setContextMenu(null);
	};

	const handleCancelAgent = (agentId: string) => {
		if (onCancelAgent) {
			onCancelAgent(agentId);
		}
		setContextMenu(null);
	};

	const handleForceRemoveAgent = async (agentId: string) => {
		if (onForceRemoveAgent) {
			await onForceRemoveAgent(agentId);
		}
		setContextMenu(null);
	};

	if (canvasItems.length === 0 && agentItems.length === 0) {
		return null;
	}

	return (
		<div className="flex flex-col w-full h-full max-w-full gap-4">
			{/* Canvases List */}
			{canvasItems.length > 0 && (
				<div className="flex flex-col gap-2">
					{/* Canvas List Container with max height */}
					<div
						className="overflow-y-auto"
						style={{ maxHeight: 'calc(100vh - 16rem)' }}
					>
						<div className="flex flex-col w-full max-w-full">
							{canvasItems.reverse().map((item, index) => {
								if (isCanvasItem(item)) {
									const canvas = item.data;
									const canvasIndex = canvases.indexOf(canvas);
									const canvasName = generateCanvasName(canvas, canvasIndex);
									const isSelected = selectedItemId === item.id;
									const isMultiSelected = selectedCanvases.has(item.id) && !isSelected;

									const taskInfo = getCanvasTaskInfo(canvas);
									const isHovered = hoveredCanvasId === item.id;
									const shouldShowMarquee = !!(taskInfo.prompt && (taskInfo.isLoading || taskInfo.isPrompting || isHovered));

									return (
										<button
											key={item.id}
											onClick={() => {
												const event = window.event as MouseEvent;
												if (event) {
													const syntheticEvent = {
														stopPropagation: () => { },
														preventDefault: () => { },
														shiftKey: event.shiftKey
													} as React.MouseEvent;
													handleCanvasClick(item.id, syntheticEvent);
												}
											}}
											onContextMenu={(e) => handleContextMenu(e, item.id)}
											className={`w-full max-w-full group relative flex flex-col text-left px-4 py-3 text-sm first:rounded-t-xl last:rounded-b-xl transition-colors border-(length:--border) not-last:border-b-transparent not-first:border-t-transparent ${isSelected
													? "bg-[var(--acc-200-30)] opacity-100 border-[var(--acc-300)]"
													: isMultiSelected
														? "bg-[var(--acc-200-30)] opacity-80 border-[var(--acc-300)]"
														: "even:bg-[var(--base-100-40)] odd:bg-[var(--base-100-80)] cursor-pointer border-dashed opacity-50 hover:opacity-100 hover:border-[var(--acc-300)] hover:not-last:border-b-transparent hover:not-first:border-t-transparent hover:bg-[var(--acc-200-40)] border-[var(--base-300)]"
												}`}
										>
											<div
												className="flex items-center gap-2 w-full cursor-pointer"
												onMouseEnter={() => setHoveredCanvasId(item.id)}
												onMouseLeave={() => setHoveredCanvasId(null)}
											>
												<div className="flex-1 min-w-0">
													{taskInfo.prompt ? (
														<Marquee
															text={taskInfo.prompt}
															isActive={shouldShowMarquee}
															className="text-xs text-[var(--base-600)]"
														/>
													) : (
														<div className="text-xs text-[var(--base-600)]">
															{canvasName}
														</div>
													)}
												</div>
												{/* Terminal button (always takes space, visible on hover) */}
												<div className="flex-shrink-0 flex items-center gap-2">
													{/* Terminal button */}
													<button
														onClick={(e) => {
															e.stopPropagation();
															if (onOpenTerminal && canvas.osSession) {
																onOpenTerminal(item.id);
															}
														}}
														className={cn(
															"p-1 rounded transition-all duration-200",
															"hover:bg-[var(--acc-200)]",
															isHovered && canvas.osSession ? "opacity-100" : "opacity-0",
															!canvas.osSession && "cursor-not-allowed"
														)}
														disabled={!canvas.osSession}
														title={canvas.osSession ? "Open Terminal" : "Canvas still loading..."}
													>
														<svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
															<path d="M2 4L6 8L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
															<path d="M8 12H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
														</svg>
													</button>

													{/* Status indicator */}
													{canvas.lockState !== 'normal' ? (
														<LockStateIndicator lockState={canvas.lockState} />
													) : taskInfo.isLoading ? (
														<div className="animate-spin h-3 w-3 border-2 border-[var(--acc-600)] border-t-transparent rounded-full" />
													) : taskInfo.isPrompting ? (
														<span className="text-[var(--acc-600)] text-xs">Prompting...</span>
													) : taskInfo.isCompleted ? (
														<span className="text-[var(--positive-600)] text-xs">✓</span>
													) : null}
												</div>
											</div>
										</button>
									);
								}
								return null;
							})}
						</div>
					</div>

					{/* New Edit Button */}
					{onCreateCanvas && (
						<div className="flex gap-2 mt-2">
							<button
								onClick={onCreateCanvas}
								className="flex-1 px-3 py-2 text-sm bg-[var(--positive-500)] hover:bg-[var(--positive-600)] text-white cursor-pointer rounded-lg transition-colors flex items-center justify-center gap-2 opacity-85 hover:opacity-95"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
									<path d="M12 8v8m-4-4h8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
								</svg>
								<span>Create New Agent</span>
							</button>
						</div>
					)}
				</div>
			)}

			{/* Background Agents List */}
			<BackgroundAgentsList
				agentItems={agentItems}
				onContextMenu={handleContextMenu}
			/>

			{/* Context Menu */}
			{contextMenu && (
				<div
					ref={contextMenuRef}
					className="fixed z-50 bg-[var(--base-100)] border border-[var(--acc-600)]/20 rounded-md shadow-lg py-1 w-fit flex flex-col"
					style={{
						left: contextMenu.x,
						top: contextMenu.y,
					}}
				>
					{isCanvasItem(contextMenu.item) && (
						<>
							<button
								onClick={() => handleShowInExplorer(contextMenu.item.id)}
								className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--acc-200)] transition-colors"
							>
								📁 Show in Explorer
							</button>
							{contextMenu.item.data.lockState === 'normal' && hasCompletedTasks(contextMenu.item.data) && (
								<button
									onClick={() => handleMergeCanvas(contextMenu.item.id)}
									className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--acc-200)] transition-colors"
								>
									🔄 Merge to Root
								</button>
							)}
							{selectedCanvases.size > 1 && (
								<button
									onClick={handleRemoveMultipleCanvases}
									className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--negative-200)] text-[var(--negative-600)] hover:text-[var(--negative-700)] transition-colors"
								>
									🗑️ Remove Selected ({selectedCanvases.size})
								</button>
							)}
							{canvases.length > 1 && (
								<button
									onClick={() => handleRemoveCanvas(contextMenu.item.id)}
									className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--negative-200)] text-[var(--negative-600)] hover:text-[var(--negative-700)] transition-colors"
								>
									🗑️ Remove Canvas
								</button>
							)}
						</>
					)}

					{isBackgroundAgentItem(contextMenu.item) && (
						<>
							<button
								onClick={() => handleShowInExplorer(contextMenu.item.id)}
								className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--acc-200)] transition-colors"
							>
								📁 Show in Explorer
							</button>
							{!['completed', 'failed', 'cancelled'].includes(contextMenu.item.data.status) && (
								<button
									onClick={() => handleCancelAgent(contextMenu.item.id)}
									className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--acc-200)] transition-colors"
								>
									⊗ Cancel Agent
								</button>
							)}
							<button
								onClick={() => handleForceRemoveAgent(contextMenu.item.id)}
								className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--negative-200)] text-[var(--negative-600)] hover:text-[var(--negative-700)] transition-colors"
							>
								{['completed', 'failed', 'cancelled'].includes(contextMenu.item.data.status)
									? '🗑️ Remove'
									: '🗑️ Force Remove'}
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
};