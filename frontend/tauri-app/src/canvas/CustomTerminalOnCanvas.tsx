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
	isDragTarget: boolean;
	isDragging: boolean;
	onTerminalReady?: (terminalId: string) => void;
	onTerminalError?: (error: string) => void;
}

const CustomTerminalOnCanvas: React.FC<CustomTerminalOnCanvasProps> = ({
	layout,
	onDragStart: propOnDragStart,
	onDragEnd: propOnDragEnd,
	onDrag: propOnDrag,
	isDragTarget,
	isDragging,
	onTerminalReady,
	onTerminalError,
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
					"w-full h-full rounded-md bg-gradient-to-b from-bg-[var(--acc-900)]/30 to-bg-[var(--base-400)]/30 backdrop-blur-md relative overflow-hidden",
				)}
			>
				{/* Connection status indicator */}
				<div className="absolute top-2 right-2 z-10">
					<div
						className={cn(
							"w-2 h-2 rounded-full",
							isConnected
								? "bg-[var(--positive-400)]"
								: "bg-[var(--negative-400)]",
						)}
					/>
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
