import React, { useState, useRef, useEffect } from 'react';
import { SingleChoiceList } from './ChoiceList';
import { UnifiedListItem, isCanvasItem, isBackgroundAgentItem, createCanvasItem, createBackgroundAgentItem } from '../types/UnifiedListTypes';
import { GitProjectCanvas, CanvasLockState } from '../types/GitProject';
import { BackgroundAgent, BackgroundAgentStatus } from '../types/BackgroundAgent';
import { BackgroundAgentsList } from './BackgroundAgentsList';

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
	try {
		const tasks = canvas.taskManager.getTasks();
		
		// Check for in-progress prompts first
		if (canvas.inProgressPrompts && canvas.inProgressPrompts.size > 0) {
			// Get the most recent in-progress prompt (first non-empty one)
			for (const prompt of canvas.inProgressPrompts.values()) {
				if (prompt.trim()) {
					let cleanPrompt = prompt.trim();
					// Remove content in parentheses
					cleanPrompt = cleanPrompt.replace(/\([^)]*\)/g, '').trim();
					// Take first 3 words
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
	onShowInExplorer
}) => {
	const [contextMenu, setContextMenu] = useState<{x: number, y: number, item: UnifiedListItem} | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);

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
		<div className="flex flex-col w-full max-w-full gap-4">
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

								return (
									<div className="flex flex-col gap-1 w-full max-w-full">
										<div className="flex items-center justify-between w-full max-w-full overflow-ellipsis">
											<div className="overflow-ellipsis text-xs max-w-full text-[var(--base-600)]">
												{canvasName.length > 22 ? canvasName.substring(0, 19) + '...' : canvasName}
											</div>
											<LockStateIndicator lockState={canvas.lockState} />
										</div>
										
										{canvas.copyProgress && canvas.copyProgress.percentage < 100 && (
											<div className="text-xs text-[var(--base-500-70)]">
												{canvas.copyProgress.percentage}% ready
											</div>
										)}
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