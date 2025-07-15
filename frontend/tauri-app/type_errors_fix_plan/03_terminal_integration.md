# Terminal Integration - Type Errors Fix Plan

## Feature Overview
The Terminal Integration provides embedded terminal functionality within canvases, with both basic terminals and CustomTerminals that integrate with Claude Code for AI-assisted coding.

## Affected Files
- `src/canvas/CustomTerminalRenderer.tsx` (22 errors - HIGH)
- `src/canvas/CustomTerminalOnCanvas.tsx` (8 errors)
- `src/canvas/TerminalOnCanvas.tsx` (5 errors)
- `src/services/CustomTerminalAPI.ts` (2 errors - override modifiers)
- `src/services/ProcessManager.ts` (1 error - iteration)
- `src/services/TerminalService.ts`

## Root Cause Analysis

### 1. **Line Buffer Access Without Bounds Checking**
CustomTerminalRenderer has 14 instances of accessing `line` without checking if it exists:
```typescript
// Current problematic pattern
const line = lines[i];
line.content // Error: line is possibly undefined
```

### 2. **Missing Override Modifiers**
CustomTerminalAPI extends a base class but doesn't use `override` keyword:
```typescript
// Current
async connect() { ... }

// Should be
override async connect() { ... }
```

### 3. **Unused Event Handler Props**
Terminal canvas components receive many props they don't use, suggesting either:
- Props should be removed from interface
- Props should be properly utilized
- Component is over-specified

### 4. **Map Iteration Issues**
ProcessManager uses Map iteration that's incompatible with ES target:
```typescript
// Line 94
for (const [key, value] of processMap) { ... }
```

## Fixes Required

### Phase 1: Safe Line Access in Renderer
```typescript
// Add line access helper
function getLine(lines: Line[], index: number): Line | null {
  return lines[index] ?? null;
}

// Or use optional chaining throughout
const content = lines[i]?.content ?? '';
```

### Phase 2: Add Override Modifiers
```typescript
// CustomTerminalAPI.ts
class CustomTerminalAPI extends BaseTerminalAPI {
  override async connect(): Promise<void> {
    // implementation
  }
  
  override async disconnect(): Promise<void> {
    // implementation
  }
}
```

### Phase 3: Clean Up Component Props
Either:
1. Remove unused props from interfaces:
```typescript
interface TerminalOnCanvasProps {
  // Remove: isSelected, isDragTarget, propOnDrag, etc.
  element: Terminal;
  onUpdate: (element: Terminal) => void;
}
```

Or:
2. Implement the unused functionality:
```typescript
// Add drag handling if needed
const handleDrag = useCallback((e: DragEvent) => {
  if (propOnDrag) {
    propOnDrag(e);
  }
}, [propOnDrag]);
```

### Phase 4: Fix Map Iteration
```typescript
// ProcessManager.ts
// Convert to array before iterating
for (const [key, value] of Array.from(processMap)) {
  // process handling
}

// Or use forEach
processMap.forEach((value, key) => {
  // process handling
});
```

## Terminal Rendering Issues

The CustomTerminalRenderer seems to have architectural issues:
1. It processes terminal output line by line but doesn't handle edge cases
2. Missing null checks suggest the data structure might need revision
3. Consider adding a Line type validator:

```typescript
interface ValidatedLine {
  content: string;
  style?: TerminalStyle;
  timestamp?: number;
}

function validateLine(line: unknown): ValidatedLine {
  if (!line || typeof line !== 'object') {
    return { content: '' };
  }
  return {
    content: (line as any).content ?? '',
    style: (line as any).style,
    timestamp: (line as any).timestamp
  };
}
```

## Impact
- 38 total errors across terminal components
- Critical for developer experience (terminal is core IDE feature)
- Affects both basic terminals and AI-enhanced terminals
- Rendering errors could cause terminal display issues

## Testing Strategy
1. Test terminal rendering with empty output
2. Test with very long output (performance)
3. Test ANSI color codes and special characters
4. Verify CustomTerminal AI integration works
5. Test terminal lifecycle (create, focus, close)