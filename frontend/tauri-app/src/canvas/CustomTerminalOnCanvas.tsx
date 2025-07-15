import { motion, type PanInfo } from "framer-motion";
import type React from "react";
import { useState } from "react";
import { cn } from "../utils";
import { CustomTerminalRenderer } from "./CustomTerminalRenderer";
import type { CanvasElement, ElementLayout } from "./types";
import { OsSession } from "../bindings/os";

interface CustomTerminalOnCanvasProps {
	layout: ElementLayout;
	osSession: OsSession;
	onDragStart: (element: CanvasElement) => void;
	onDragEnd: (element: CanvasElement) => void;
	onDrag: (
		event: MouseEvent | TouchEvent | PointerEvent,
		info: PanInfo,
	) => void;
	onRemoveElement: (elementId: string) => void;
	isDragTarget: boolean;
	isDragging: boolean;
	onTerminalReady?: (terminalId: string) => void;
	onTerminalError?: (error: string) => void;
	onCustomTerminalUpdate?: () => void;
}

const CustomTerminalOnCanvas: React.FC<CustomTerminalOnCanvasProps> = ({
	layout,
	onDragStart: propOnDragStart,
	onDragEnd: propOnDragEnd,
	onDrag: propOnDrag,
	onRemoveElement,
	isDragTarget,
	isDragging,
	onTerminalReady,
	onTerminalError,
	onCustomTerminalUpdate,
}) => {
	const { cell, element } = layout;
	const [isHovered, setIsHovered] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [isConnected, setIsConnected] = useState(false);

	if (!("customTerminal" in element.kind)) {
		return null
	}

	const handleDragStartInternal = () => {
		propOnDragStart(element);
	};

	const handleDragEndInternal = () => {
		propOnDragEnd(element);
	};

	const handleTerminalReady = (terminalId: string) => {
		setIsConnected(true);
		onTerminalReady?.(terminalId);
	};

	const handleTerminalError = (error: string) => {
		setIsConnected(false);
		onTerminalError?.(error);
	};

	return (
		<motion.div
			className={cn(
				"absolute select-none overflow-hidden",
				isDragging ? "z-30" : "z-10",
			)}
			initial={{
				x: cell.x,
				y: cell.y,
				width: cell.width,
				height: cell.height,
			}}
			animate={
				!dragging
					? {
							x: cell.x,
							y: cell.y,
							width: cell.width,
							height: cell.height,
						}
					: undefined
			}
			transition={{
				type: "tween",
				duration: 0.2,
			}}
			layout
			// drag
			// dragMomentum={false}
			// onMouseDown={() => {
			//   if (!dragging) {
			//     setDragging(true);
			//   }
			// }}
			// onDragStart={() => {
			//   setDragging(true);
			//   handleDragStartInternal();
			// }}
			// onDragEnd={() => {
			//   setDragging(false);
			//   handleDragEndInternal();
			// }}
			// onDrag={(event, info) => {
			//   if (typeof propOnDrag === 'function') {
			//     propOnDrag(event, info);
			//   }
			// }}
			// onMouseEnter={() => setIsHovered(true)}
			// onMouseLeave={() => {
			//   setIsHovered(false);
			// }}
		>
			<div
				className={cn(
					"w-full h-full rounded-md bg-gradient-to-b from-bg-[var(--acc-900)]/30 to-bg-[var(--base-400)]/30 backdrop-blur-md relative overflow-hidden group",
				)}
			>
				{/* Control buttons */}
				<div className="absolute top-2 right-2 z-10 flex items-center gap-2">
					{/* Layout toggle button */}
					<button
						onClick={(e) => {
							e.stopPropagation();
							if ("customTerminal" in element.kind) {
								const terminal = element.kind.customTerminal;
								// Toggle layout orientation
								terminal.isHorizontal = !terminal.isHorizontal;
								// Trigger canvas re-layout
								if (onCustomTerminalUpdate) {
									onCustomTerminalUpdate();
								}
							}
						}}
						className={cn(
							"p-1 rounded transition-all duration-200",
							"hover:bg-[var(--acc-200)] bg-[var(--base-100)]/80",
							"opacity-0 group-hover:opacity-100"
						)}
						title={element.kind && "customTerminal" in element.kind && element.kind.customTerminal.isHorizontal ? "Switch to Vertical" : "Switch to Horizontal"}
					>
						{element.kind && "customTerminal" in element.kind && element.kind.customTerminal.isHorizontal ? (
							// Horizontal layout icon
							<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
								<rect x="2" y="2" width="12" height="5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
								<rect x="2" y="9" width="12" height="5" stroke="currentColor" strokeWidth="1.5" rx="1"/>
							</svg>
						) : (
							// Vertical layout icon
							<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
								<rect x="2" y="2" width="5" height="12" stroke="currentColor" strokeWidth="1.5" rx="1"/>
								<rect x="9" y="2" width="5" height="12" stroke="currentColor" strokeWidth="1.5" rx="1"/>
							</svg>
						)}
					</button>
					
					{/* Connection status indicator */}
					<div
						className={cn(
							"w-2 h-2 rounded-full",
							isConnected
								? "bg-[var(--positive-400)]"
								: "bg-[var(--negative-400)]",
						)}
					/>
					
					{/* Close button */}
					<button
						onClick={(e) => {
							e.stopPropagation();
							onRemoveElement(element.id);
						}}
						className={cn(
							"p-1 rounded transition-all duration-200",
							"hover:bg-[var(--negative-200)] bg-[var(--base-100)]/80",
							"opacity-0 group-hover:opacity-100"
						)}
						title="Close Terminal"
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
						</svg>
					</button>
				</div>

				{/* Custom Terminal Renderer */}
				<div className={cn("w-full h-full pointer-events-auto")}>
					<CustomTerminalRenderer
						elementId={element.id}
						osSession={element.kind.customTerminal.osSession}
						onTerminalReady={handleTerminalReady}
						onTerminalError={handleTerminalError}
						fontSize="sm"
					/>
				</div>
			</div>
		</motion.div>
	);
};

export default CustomTerminalOnCanvas;
