import React, { useState, useRef, useEffect } from 'react';
import { SingleChoiceList } from './ChoiceList';
import { cn } from '../utils';
import { CanvasLockState, GitProjectCanvas } from '../types/GitProject';

interface CanvasesListProps {
	canvases: GitProjectCanvas[];
	currentCanvasId: string | null;
	onCanvasSelect: (index: number) => void;
	onCreateCanvas: () => Promise<void>;
	onMergeCanvas: (canvasId: string) => Promise<void>;
	getCanvasTaskCounts: (canvasId: string) => { running: number; finished: number; error: number; total: number };
	getCanvasLockState: (canvasId: string) => CanvasLockState | null;
	isCreatingCanvas: boolean;
	mergingCanvases: Set<string>;
	onShowInExplorer: (canvasId: string) => Promise<void>;
	onDeleteWorkspace: (canvasId: string) => Promise<void>;
}

export const CanvasesList: React.FC<CanvasesListProps> = ({
	canvases,
	currentCanvasId,
	onCanvasSelect,
	onCreateCanvas,
	onMergeCanvas,
	getCanvasTaskCounts,
	getCanvasLockState,
	isCreatingCanvas,
	mergingCanvases,
	onShowInExplorer,
	onDeleteWorkspace
}) => {
	const [contextMenu, setContextMenu] = useState<{x: number, y: number, canvasId: string} | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);

	// Close context menu when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
				setContextMenu(null);
			}
		};

		if (contextMenu) {
			document.addEventListener('mousedown', handleClickOutside);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [contextMenu]);

	const handleContextMenu = (e: React.MouseEvent, canvasId: string) => {
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({
			x: e.clientX,
			y: e.clientY,
			canvasId
		});
	};

	const handleShowInExplorer = async (canvasId: string) => {
		await onShowInExplorer(canvasId);
		setContextMenu(null);
	};

	const handleDeleteWorkspace = async (canvasId: string) => {
		await onDeleteWorkspace(canvasId);
		setContextMenu(null);
	};

	return (
		<>
			<SingleChoiceList
				items={canvases}
				selectedItemId={currentCanvasId}
				onSelectItem={(canvasId) => {
					if (canvasId) {
						const index = canvases.findIndex(c => c.id === canvasId);
						if (index !== -1) {
							onCanvasSelect(index);
						}
					}
				}}
				getItemId={(canvas) => canvas.id}
				onContextMenu={handleContextMenu}
				renderItem={(canvas, isSelected) => {
					const index = canvases.findIndex(c => c.id === canvas.id);
					const taskCounts = getCanvasTaskCounts(canvas.id);
					const lockState = getCanvasLockState(canvas.id);

					return (
						<>
							<div className="flex w-full items-center justify-between">
								<span className="text-[var(--base-600)]">Agent N°{index + 1}</span>
								<div className="flex items-center gap-2">
									{taskCounts.total > 0 && (
										<div className="flex items-center gap-1 text-xs">
											{taskCounts.running > 0 && (
												<span className="w-5 aspect-square flex items-center justify-center relative text-[var(--whitest)] rounded-md">
													<div className="absolute top-0 left-0 w-full h-full bg-[var(--acc-400)] animate-spin rounded-lg"></div>
													<div className="z-10">
														{taskCounts.running}
													</div>
												</span>
											)}
											{taskCounts.finished > 0 && (
												<span className="w-5 aspect-square flex items-center justify-center bg-[var(--positive-400)] text-[var(--whitest)] rounded-full">
													{taskCounts.finished}
												</span>
											)}
											{taskCounts.error > 0 && (
												<span className="w-5 aspect-square flex items-center justify-center bg-[var(--negative-600)] text-[var(--whitest)] rounded-sm">
													{taskCounts.error}
												</span>
											)}
										</div>
									)}
									
									{/* Lock State Indicator */}
									{lockState === 'merging' && (
										<span className="w-5 aspect-square flex items-center justify-center relative text-[var(--whitest)] rounded-md">
											<div className="absolute top-0 left-0 w-full h-full bg-[var(--acc-400)] animate-spin rounded-lg"></div>
											<div className="z-10 text-xs">⏳</div>
										</span>
									)}

									{/* Merge Button - only show for normal state and if there are completed tasks */}
									{lockState === 'normal' && taskCounts.finished > 0 && (
										<button
											onClick={(e) => {
												e.stopPropagation();
												onMergeCanvas(canvas.id);
											}}
											disabled={mergingCanvases.has(canvas.id)}
											className={cn(
												"w-5 aspect-square flex items-center justify-center text-xs rounded transition-colors",
												mergingCanvases.has(canvas.id)
													? "bg-[var(--base-300)] text-[var(--base-500)] cursor-not-allowed"
													: "bg-[var(--acc-300-20)] text-[var(--acc-600)] hover:bg-[var(--acc-300-40)] cursor-pointer"
											)}
											title="Merge canvas to root"
										>
											{mergingCanvases.has(canvas.id) ? "⏳" : "🔀"}
										</button>
									)}
								</div>
							</div>
							{lockState === 'merged' && (
								<div className="text-xs text-[var(--base-500-50)] mt-0.5">
									merged
								</div>
							)}
						</>
					);
				}}
			/>

			{/* New Canvas Button */}
			<button 
				className={cn(
					"w-full px-4 py-2 border-2 border-dashed bg-[var(--positive-300-10)] hover:bg-[var(--positive-300-20)] border-[var(--positive-500-50)] text-[var(--positive-500-70)] hover:text-[var(--positive-500)] hover:border-solid hover:border-[var(--positive-500)] text-sm text-center rounded-xl mt-2 transition-all",
					isCreatingCanvas 
						? "opacity-50 cursor-not-allowed" 
						: "cursor-pointer"
				)}
				disabled={isCreatingCanvas}
				onClick={onCreateCanvas}
			>
				{isCreatingCanvas ? "Creating..." : "+ New Agent"}
			</button>

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
					<button
						onClick={() => handleShowInExplorer(contextMenu.canvasId)}
						className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--base-200)] text-[var(--blackest)] transition-colors"
					>
						📁 Show in Explorer
					</button>
					<button
						onClick={() => handleDeleteWorkspace(contextMenu.canvasId)}
						className="w-fit min-w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-[var(--negative-200)] text-[var(--negative-800)] transition-colors"
					>
						🗑️ Delete agent & its work
					</button>
				</div>
			)}
		</>
	);
};
