import type { PanInfo } from "framer-motion";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../utils";
import CustomTerminalOnCanvas from "./CustomTerminalOnCanvas";
import type { FileTreeCanvas } from "./FileTreeCanvas";
import FileTreeOnCanvas from "./FileTreeOnCanvas";
import {
	createGridWorker,
	type WorkerMessage,
	type WorkerResponse,
} from "./gridWorker";
import type { Rectangle } from "./Rectangle";
import RectangleOnCanvas from "./RectangleOnCanvas";
import TerminalOnCanvas from "./TerminalOnCanvas";
import TextAreaOnCanvas from "./TextAreaOnCanvas";
import type { CanvasElement, ElementLayout, ElementTargets } from "./types";
import { useOsSession } from "../contexts/GitProjectContext";

interface CanvasProps {
	elements: CanvasElement[];
	stabilityWeight?: number;
	onElementsChange: (elements: CanvasElement[]) => void;
}

// Simple string hash function
const simpleHash = (str: string): number => {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash |= 0; // Convert to 32bit integer
	}
	return Math.abs(hash);
};

// Generate a stable color based on element ID
const _getColorForId = (id: string): string => {
	const hash = simpleHash(id);
	const hue = (hash % 120) + 180; // Blueish colors (180-300)
	const saturation = 60 + (hash % 20); // 60-80%
	const lightness = 50 + (hash % 20); // 50-70%
	return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.3)`;
};

const Canvas: React.FC<CanvasProps> = ({
	elements,
	stabilityWeight = 0.1,
	onElementsChange,
}) => {
	const osSession = useOsSession();
	const [layouts, setLayouts] = useState<ElementLayout[]>([]);
	const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
	const [draggedElement, setDraggedElement] = useState<CanvasElement | null>(
		null,
	);
	const [dragTarget, setDragTarget] = useState<CanvasElement | null>(null);
	const canvasRef = useRef<HTMLDivElement>(null);
	const workerRef = useRef<Worker | null>(null);
	const previousLayoutsRef = useRef<ElementLayout[]>([]);
	const elementsRef = useRef<CanvasElement[]>(elements);

	// Update canvas size when window resizes
	const updateCanvasSize = useCallback(() => {
		if (canvasRef.current) {
			const rect = canvasRef.current.getBoundingClientRect();
			setCanvasSize({ width: rect.width, height: rect.height });
		}
	}, []);

	// Initialize worker and resize observer
	useEffect(() => {
		workerRef.current = createGridWorker();

		const handleWorkerMessage = (event: MessageEvent<WorkerResponse>) => {
			if (event.data.type === "GRID_OPTIMIZED") {
				const newWorkerLayouts = event.data.payload.layouts;
				console.log(
					"Canvas: Worker returned layouts for elements:",
					newWorkerLayouts.map((l) => l.element.id),
				);

				// Use a function to get the current elements to avoid stale closure
				setLayouts((_currentLayouts) => {
					// Get the current elements array from ref
					const currentElements = elementsRef.current;
					console.log(
						"Canvas: Current elements array has IDs:",
						currentElements.map((e) => e.id),
					);

					const newLayouts = newWorkerLayouts
						.map((layout) => {
							const element = currentElements.find(
								(e) => e.id === layout.element.id,
							);
							if (!element) {
								console.warn(
									"Canvas: Could not find element for layout:",
									layout.element.id,
								);
								return null;
							}
							console.log(
								"Canvas: Found element for layout:",
								layout.element.id,
								Object.keys(element.kind)[0],
							);
							return {
								element,
								cell: layout.cell,
								score: layout.score,
								previousCell: layout.previousCell,
							} satisfies ElementLayout;
						})
						.filter((l) => l !== null);

					console.log("Canvas: Setting new layouts count:", newLayouts.length);
					previousLayoutsRef.current = newLayouts;
					return newLayouts;
				});
			}
		};

		workerRef.current.onmessage = handleWorkerMessage;

		// Set up resize observer
		const resizeObserver = new ResizeObserver(updateCanvasSize);
		if (canvasRef.current) {
			resizeObserver.observe(canvasRef.current);
		}

		// Initial size update
		updateCanvasSize();

		return () => {
			if (workerRef.current) {
				workerRef.current.terminate();
			}
			resizeObserver.disconnect();
		};
	}, [updateCanvasSize]);

	function optimizeElements() {
		if (
			elements.length > 0 &&
			canvasSize.width > 0 &&
			canvasSize.height > 0 &&
			workerRef.current
		) {
			const message: WorkerMessage = {
				type: "OPTIMIZE_GRID",
				payload: {
					elements: elements.map((e) => {
						try {
							return {
								id: e.id,
								targets: e.targets,
								weight: e.weight,
							};
						} catch (error) {
							console.warn("Failed to get targets for element:", e.id, error);
							return {
								id: e.id,
								targets: {
									size: "medium" as const,
									aspectRatio: 16 / 9,
									area: "center" as const,
								},
								weight: e.weight,
							};
						}
					}),
					canvasWidth: canvasSize.width,
					canvasHeight: canvasSize.height,
					previousLayouts: previousLayoutsRef.current,
					options: { stabilityWeight },
				},
			};

			workerRef.current.postMessage(message);
		}
	}

	// Update elements ref whenever elements change
	useEffect(() => {
		elementsRef.current = elements;
	}, [elements]);

	// Optimize grid when elements or canvas size changes
	useEffect(() => {
		optimizeElements();
	}, [elements, canvasSize, stabilityWeight]);

	// Drag and drop handlers
	const handleDragStart = useCallback((element: CanvasElement) => {
		setDraggedElement(element);
	}, []);

	const handleDrag = useCallback(
		(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
			const canvasRect = canvasRef.current?.getBoundingClientRect();
			if (!canvasRect || !draggedElement) return;

			const localX = info.point.x - canvasRect.left;
			const localY = info.point.y - canvasRect.top;

			const targetLayout = layouts.find((layout) => {
				if (layout.element.id === draggedElement.id) return false; // Can't drop on itself

				const { x, y, width, height } = layout.cell;
				return (
					localX >= x &&
					localX <= x + width &&
					localY >= y &&
					localY <= y + height
				);
			});

			const newTarget = targetLayout ? targetLayout.element : null;
			if (newTarget?.id !== dragTarget?.id) {
				setDragTarget(newTarget);
			}
		},
		[layouts, draggedElement, dragTarget],
	);

	const handleDragEnd = useCallback(() => {
		if (draggedElement && dragTarget && draggedElement.id !== dragTarget.id) {
			// Swap the elements
			const newElements = [...elements];
			const draggedIndex = newElements.findIndex(
				(el) => el.id === draggedElement.id,
			);
			const targetIndex = newElements.findIndex(
				(el) => el.id === dragTarget.id,
			);

			if (draggedIndex !== -1 && targetIndex !== -1) {
				[newElements[draggedIndex], newElements[targetIndex]] = [
					newElements[targetIndex],
					newElements[draggedIndex],
				];
				// onElementsChange(newElements);
				setLayouts(
					layouts.map((layout) => {
						if (layout.element.id === draggedElement.id) {
							return {
								...layout,
								element: newElements[draggedIndex],
							};
						} else if (layout.element.id === dragTarget.id) {
							return {
								...layout,
								element: newElements[targetIndex],
							};
						}
						return layout;
					}),
				);
			}
		}
		setDraggedElement(null);
		setDragTarget(null);
	}, [draggedElement, dragTarget, elements, onElementsChange]);

	// Element update handlers
	const handleRectangleUpdate = useCallback(
		(element: Rectangle, newTargets: ElementTargets) => {
			element.updateTargets(newTargets);
			// Trigger re-optimization by updating the elements array
			onElementsChange([...elements]);
		},
		[elements, onElementsChange],
	);

	const handleFileTreeUpdate = useCallback(
		(element: FileTreeCanvas, newTargets: ElementTargets) => {
			element.updateTargets(newTargets);
			// Trigger re-optimization by updating the elements array
			onElementsChange([...elements]);
		},
		[elements, onElementsChange],
	);

	const handleCustomTerminalUpdate = useCallback(
		() => {
			// Force re-optimization by calling optimizeElements directly
			// This bypasses the React dependency system to ensure immediate re-calculation
			console.log("CustomTerminal layout changed, forcing grid re-optimization");
			optimizeElements();
		},
		[elements, canvasSize, stabilityWeight],
	);

	const handleRemoveElement = useCallback(
		(elementId: string) => {
			const newElements = elements.filter((el) => el.id !== elementId);
			onElementsChange(newElements);
		},
		[elements, onElementsChange],
	);

	return (
		<div ref={canvasRef} className={cn("relative flex w-full h-full")}>
			{layouts.map((layout) => {
				if ("rectangle" in layout.element.kind) {
					return (
						<RectangleOnCanvas
							key={`${layout.element.id}`}
							layout={layout}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							onDrag={layout.element === draggedElement ? handleDrag : () => {}}
							onRectangleUpdate={handleRectangleUpdate}
							onRemoveElement={handleRemoveElement}
							isDragTarget={layout.element === dragTarget}
							isDragging={layout.element === draggedElement}
						/>
					);
				} else if ("terminal" in layout.element.kind) {
					return (
						<TerminalOnCanvas
							key={`${layout.element.id}`}
							layout={layout}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							onDrag={layout.element === draggedElement ? handleDrag : () => {}}
							onRemoveElement={handleRemoveElement}
							isDragTarget={layout.element === dragTarget}
							isDragging={layout.element === draggedElement}
						/>
					);
				} else if ("customTerminal" in layout.element.kind) {
					return (
						<CustomTerminalOnCanvas
							key={`${layout.element.id}`}
							layout={layout}
							osSession={layout.element.kind.customTerminal.osSession}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							onDrag={layout.element === draggedElement ? handleDrag : () => {}}
							onRemoveElement={handleRemoveElement}
							onCustomTerminalUpdate={handleCustomTerminalUpdate}
							isDragTarget={layout.element === dragTarget}
							isDragging={layout.element === draggedElement}
						/>
					);
				} else if ("fileTree" in layout.element.kind) {
					console.log(
						"Canvas: Rendering FileTreeOnCanvas for element:",
						layout.element.id,
					);
					return (
						<FileTreeOnCanvas
							key={`${layout.element.id}`}
							layout={layout}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							onDrag={layout.element === draggedElement ? handleDrag : () => {}}
							onFileTreeUpdate={handleFileTreeUpdate}
							onRemoveElement={handleRemoveElement}
							isDragTarget={layout.element === dragTarget}
							isDragging={layout.element === draggedElement}
						/>
					);
				} else if ("textArea" in layout.element.kind) {
					return (
						<TextAreaOnCanvas
							key={`${layout.element.id}`}
							layout={layout}
							onDragStart={handleDragStart}
							onDragEnd={handleDragEnd}
							onDrag={layout.element === draggedElement ? handleDrag : () => {}}
							isDragTarget={layout.element === dragTarget}
							isDragging={layout.element === draggedElement}
						/>
					);
				}
				return (
					<div key={`${layout.element.id}`}>
						None: {JSON.stringify(layout.element)}
					</div>
				);
			})}
		</div>
	);
};

export default Canvas;
