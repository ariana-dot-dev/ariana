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
				className={`whitespace-nowrap ${
					shouldAnimate ? 'animate-marquee' : ''
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
	onCancelAgent?: (agentId: string) => void;
	onForceRemoveAgent?: (agentId: string) => Promise<void>;
	onMergeCanvas?: (canvasId: string) => void;
	onShowInExplorer?: (itemId: string) => void;
	onOpenTerminal?: (canvasId: string) => void;
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
	return `Canvas ${canvasIndex + 1}`;
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
	onCancelAgent,
	onForceRemoveAgent,
	onMergeCanvas,
	onShowInExplorer,
	onOpenTerminal
}) => {
	const [contextMenu, setContextMenu] = useState<{x: number, y: number, item: UnifiedListItem} | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const [hoveredCanvasId, setHoveredCanvasId] = useState<string | null>(null);

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
					<SingleChoiceList
						className="!w-full"
						buttonProps={{
							className: '!w-full !max-w-full'
						}}
						items={canvasItems.reverse()}
						selectedItemId={selectedItemId}
						onSelectItem={onSelectItem}
						getItemId={(item) => item.id}
						onContextMenu={handleContextMenu}
						renderItem={(item, isSelected) => {
							if (isCanvasItem(item)) {
								const canvas = item.data;
								const canvasIndex = canvases.indexOf(canvas);
								const canvasName = generateCanvasName(canvas, canvasIndex);

								const taskInfo = getCanvasTaskInfo(canvas);
								const isHovered = hoveredCanvasId === item.id;
								const shouldShowMarquee = !!(taskInfo.prompt && (taskInfo.isLoading || taskInfo.isPrompting || isHovered));
								
								return (
									<div 
										className="flex items-center gap-2 w-full"
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
													<path d="M2 4L6 8L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
													<path d="M8 12H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
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
								);
							}
							return null;
						}}
					/>
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