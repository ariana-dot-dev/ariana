# Canvas Core System - Type Errors Fix Plan

## Feature Overview
The Canvas is the central feature - a visual workspace where users create and manage different elements (text areas, terminals, file trees) in a grid layout. Each canvas represents a branch/version of the project.

## Affected Files
- `src/canvas/Canvas.tsx` (8 errors)
- `src/canvas/TextAreaOnCanvas.tsx` (18 errors)
- `src/canvas/RectangleOnCanvas.tsx` (7 errors)
- `src/canvas/FileTreeOnCanvas.tsx` (6 errors)
- `src/canvas/gridWorkerCore.ts` (6 errors)
- `src/canvas/types.ts` (type definitions)

## Root Cause Analysis

### 1. **Optional Properties with `exactOptionalPropertyTypes`**
The strictest TypeScript setting is causing issues with optional properties:
```typescript
// Current type
type ElementLayout = {
  element: CanvasElement;
  cell: GridCell;
  previousCell: GridCell; // Not optional but can be undefined
}

// Setting previousCell to undefined fails with exactOptionalPropertyTypes
```

### 2. **Grid Optimization Logic Issues**
The grid optimizer (gridWorkerCore.ts) has unsafe property access:
```typescript
currentGroup.width // Error: possibly undefined
```

### 3. **Navigation State in TextArea**
TextAreaOnCanvas manages complex navigation but doesn't handle all edge cases:
```typescript
prevFile, nextFile // Both possibly undefined
targetPos // Possibly undefined when calculating positions
```

### 4. **Unused Drag-and-Drop Props**
Multiple canvas elements receive drag props they don't use, suggesting incomplete implementation or over-specification.

## Fixes Required

### Phase 1: Fix Type Definitions for Optional Properties
```typescript
// Update ElementLayout type
type ElementLayout = {
  element: CanvasElement;
  cell: GridCell;
  previousCell?: GridCell; // Make explicitly optional
  score?: number;
}

// Or if undefined is valid
type ElementLayout = {
  element: CanvasElement;
  cell: GridCell;
  previousCell: GridCell | undefined;
  score: number;
}
```

### Phase 2: Safe Grid Calculations
```typescript
// gridWorkerCore.ts
function calculateGridPosition(group: GridGroup): GridCell {
  const width = group.width ?? 1; // Default width
  const height = group.height ?? 1; // Default height
  
  // Validate bounds
  if (width <= 0 || height <= 0) {
    throw new Error('Invalid grid dimensions');
  }
  
  return { row, col, width, height };
}
```

### Phase 3: TextArea Navigation Safety
```typescript
// Add navigation helper
interface NavigationState {
  currentFile: string;
  currentCommand: number;
  files: string[];
  commands: string[];
}

function getNavigationTargets(state: NavigationState) {
  const { currentFile, files } = state;
  const currentIndex = files.indexOf(currentFile);
  
  return {
    prevFile: currentIndex > 0 ? files[currentIndex - 1] : null,
    nextFile: currentIndex < files.length - 1 ? files[currentIndex + 1] : null,
    hasPrev: currentIndex > 0,
    hasNext: currentIndex < files.length - 1
  };
}
```

### Phase 4: Complete or Remove Drag Implementation
Either implement drag handling:
```typescript
const DraggableCanvasElement: React.FC<Props> = ({
  element,
  isDragTarget,
  onDrag,
  ...props
}) => {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('elementId', element.id);
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    if (isDragTarget) {
      e.preventDefault();
    }
  };
  
  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      className={isDragTarget ? 'drag-target' : ''}
    >
      {/* content */}
    </div>
  );
};
```

Or simplify interfaces:
```typescript
interface CanvasElementProps {
  element: CanvasElement;
  onUpdate: (element: CanvasElement) => void;
  // Remove drag-related props if not needed
}
```

## Canvas Architecture Issues

The canvas system shows signs of incomplete refactoring:
1. Mixed approaches to drag-and-drop (some elements implement, others don't)
2. Grid optimization runs in a worker but error handling is incomplete
3. Type safety is compromised by trying to handle too many edge cases

Consider architectural improvements:
1. Standardize drag-and-drop across all elements or remove it
2. Add proper error boundaries for grid calculations
3. Use a state machine for element lifecycle

## Impact
- 45 total errors across canvas components
- Core feature of the application
- Affects user's ability to arrange workspace
- Grid calculation errors could cause layout issues

## Testing Strategy
1. Test canvas with empty state
2. Test adding/removing elements
3. Test grid optimization with various layouts
4. Test drag-and-drop if implemented
5. Test canvas persistence and restoration
6. Test performance with many elements