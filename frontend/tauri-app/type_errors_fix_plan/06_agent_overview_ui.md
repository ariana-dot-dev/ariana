# Agent Overview UI - Type Errors Fix Plan

## Feature Overview
The Agent Overview UI provides a unified interface for managing both canvases and background agents, showing their status, tasks, and allowing control operations.

## Affected Files
- `src/components/AgentOverview.tsx` (13 errors)
- `src/components/UnifiedCanvasAgentList.tsx` (7 errors)
- `src/components/BackgroundAgentsList.tsx` (7 errors)
- `src/types/BackgroundAgent.ts` (5 errors)

## Root Cause Analysis

### 1. **Optional Props with `exactOptionalPropertyTypes`**
The strictest TypeScript setting causes issues with optional props:
```typescript
// GitProjectView.tsx line 544
Type '{ canvases: ...; taskManager: TaskManager | undefined }' 
is not assignable to type 'AgentOverviewProps'
// taskManager is optional but can't be undefined with exactOptionalPropertyTypes
```

### 2. **Missing Override Modifiers in BackgroundAgent**
BackgroundAgent base class has methods that override but lack the `override` keyword:
```typescript
// BackgroundAgent.ts
class MergeAgent extends BackgroundAgent {
  // Missing override modifier
  async execute() { ... }
}
```

### 3. **Unused Component Props**
All three components receive many props they don't use, suggesting either:
- Over-specification in parent components
- Incomplete implementation
- Props that should be removed

### 4. **Component Prop Type Mismatches**
The component interfaces don't align with how they're actually used:
```typescript
// Props passed don't match interface expectations
// "Type not assignable" errors for component props
```

## Fixes Required

### Phase 1: Fix Optional Props Handling
```typescript
// AgentOverview.tsx
interface AgentOverviewProps {
  canvases: GitProjectCanvas[];
  backgroundAgents: BackgroundAgent<any>[];
  project: GitProject;
  taskManager: TaskManager; // Make required
  // ... other props
}

// Or handle undefined properly
interface AgentOverviewProps {
  canvases: GitProjectCanvas[];
  backgroundAgents: BackgroundAgent<any>[];
  project: GitProject;
  taskManager?: TaskManager; // Explicitly optional
  // ... other props
}

// In component
const AgentOverview: React.FC<AgentOverviewProps> = ({
  taskManager,
  ...props
}) => {
  if (!taskManager) {
    return <div>Loading task manager...</div>;
  }
  
  // Now taskManager is guaranteed to exist
  const tasks = taskManager.getTasks();
  // ...
};
```

### Phase 2: Add Override Modifiers
```typescript
// BackgroundAgent.ts
abstract class BackgroundAgent<T = any> {
  abstract execute(): Promise<void>;
}

class MergeAgent extends BackgroundAgent<MergeAgentContext> {
  override async execute(): Promise<void> {
    // implementation
  }
}
```

### Phase 3: Clean Up Component Props
Review each component and either:

**Option A: Remove unused props**
```typescript
// UnifiedCanvasAgentList.tsx
interface UnifiedCanvasAgentListProps {
  // Keep only what's actually used
  canvases: GitProjectCanvas[];
  agents: BackgroundAgent[];
  onSelectCanvas: (canvas: GitProjectCanvas) => void;
  onSelectAgent: (agent: BackgroundAgent) => void;
  
  // Remove unused props like:
  // - isSelected
  // - isDragTarget
  // - onDrag
  // - etc.
}
```

**Option B: Implement missing functionality**
```typescript
// If props should be used, implement them
const UnifiedCanvasAgentList: React.FC<Props> = ({
  canvases,
  agents,
  isSelected,
  onDrag,
  ...props
}) => {
  const handleDrag = useCallback((e: React.DragEvent) => {
    if (onDrag) {
      onDrag(e);
    }
  }, [onDrag]);
  
  return (
    <div 
      draggable
      onDrag={handleDrag}
      className={isSelected ? 'selected' : ''}
    >
      {/* content */}
    </div>
  );
};
```

### Phase 4: Align Component Interfaces
```typescript
// Ensure parent passes correct props
// GitProjectView.tsx
<AgentOverview
  canvases={canvases}
  backgroundAgents={backgroundAgents}
  project={project}
  taskManager={taskManager!} // Assert non-null or handle properly
  onAddPrompt={handleAddPrompt}
  onStartTask={handleStartTask}
  // ... other required props
/>
```

## UI Architecture Issues

The agent overview components show signs of architectural complexity:
1. **Three separate components** for similar functionality (AgentOverview, UnifiedCanvasAgentList, BackgroundAgentsList)
2. **Overlapping responsibilities** between components
3. **Inconsistent prop patterns** across the three components

Consider consolidating or clarifying responsibilities:
```typescript
// Simplified architecture
interface AgentOverviewProps {
  data: {
    canvases: GitProjectCanvas[];
    agents: BackgroundAgent[];
    tasks: Task[];
  };
  actions: {
    onSelectCanvas: (canvas: GitProjectCanvas) => void;
    onSelectAgent: (agent: BackgroundAgent) => void;
    onStartTask: (task: Task) => void;
  };
  ui: {
    selectedCanvas?: string;
    selectedAgent?: string;
    viewMode: 'grid' | 'list';
  };
}
```

## Impact
- 32 total errors across agent UI components
- Affects user's ability to manage background agents
- Critical for understanding system status
- May prevent proper agent control operations

## Testing Strategy
1. Test with no agents running
2. Test with multiple agents in different states
3. Test canvas selection and switching
4. Test agent creation and deletion
5. Test task assignment to agents
6. Test UI updates during agent state changes
7. Test error states and recovery