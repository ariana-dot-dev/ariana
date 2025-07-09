import React, { useState, useEffect } from "react";
import Canvas from "./canvas/Canvas";
import type { CanvasElement } from "./canvas/types";

interface CanvasViewProps {
	elements: CanvasElement[];
	onElementsChange: (elements: CanvasElement[]) => void;
	onAddElementRef?: React.RefObject<((element: CanvasElement) => void) | null>;
}

const CanvasView: React.FC<CanvasViewProps> = ({ elements, onElementsChange }) => {
	const [stabilityWeight, _setStabilityWeight] = useState(0.3);

	return (
		<div className="w-full h-full">
			<Canvas
				elements={elements}
				stabilityWeight={stabilityWeight}
				onElementsChange={onElementsChange}
			/>
		</div>
	);
};

export default CanvasView;
