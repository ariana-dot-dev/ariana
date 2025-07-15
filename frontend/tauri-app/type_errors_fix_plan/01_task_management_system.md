# Task Management System - Type Errors Fix Plan

## Feature Overview
The Task Management System handles prompts/tasks that can be queued, run, and completed by Claude Code. It's a core feature with complex state management and type unions.

## Affected Files
- `src/types/Task.ts` (41 errors - HIGHEST)
- `src/canvas/TaskComponent.tsx` (0 errors but uses Task types)
- `src/components/TaskLinkDisplay.tsx`
- `src/components/TaskLinkingActions.tsx`

## Root Cause Analysis

### 1. **Incomplete Type Guards and Unsafe Access**
The Task type is a discriminated union with 7 different states (prompting, queued, running, paused, completed, failed, interrupted), but the code frequently accesses properties without proper type narrowing.

```typescript
// Current problematic pattern in Task.ts
const task = tasks.find(t => t.id === taskId);
task.status = 'completed'; // Error: task is possibly undefined
```

### 2. **Unsafe Array Operations with `noUncheckedIndexedAccess`**
Many errors stem from array access without bounds checking:
- `firstTask` is possibly 'undefined' (5 instances)
- `lastTask` is possibly 'undefined' (3 instances)
- `task` is possibly 'undefined' (22 instances)

### 3. **Incomplete Object Spreads**
Creating tasks with spread operator missing required properties:
```typescript
// Line 536: Type '{ prompt: string; }' is not assignable to type 'Task'
// Missing status, id, createdAt, etc.
```

### 4. **Set Iteration Issues**
Line 592: Can't iterate over Set<string> due to target/iteration settings

## Fixes Required

### Phase 1: Add Proper Type Guards
```typescript
// Add type guard functions
function isCompletedTask(task: Task): task is CompletedTask {
  return task.status === 'completed';
}

function isRunningTask(task: Task): task is RunningTask {
  return task.status === 'running';
}
```

### Phase 2: Safe Array Access
```typescript
// Before
const firstTask = tasks[0];
firstTask.status = 'running'; // Error: possibly undefined

// After
const firstTask = tasks[0];
if (firstTask) {
  firstTask.status = 'running';
}
// Or use optional chaining
tasks[0]?.status === 'running'
```

### Phase 3: Complete Task Creation
```typescript
// Create proper factory functions for each task type
function createPromptingTask(prompt: string): PromptingTask {
  return {
    status: 'prompting',
    prompt,
    id: generateId(),
    createdAt: Date.now()
  };
}
```

### Phase 4: Fix Set Iteration
```typescript
// Line 592 fix
for (const agentId of Array.from(linkedAgents)) {
  // ...
}
```

## Impact
- This is the most error-prone module with 41 errors
- Core to the application's task execution functionality
- Fixing this will likely resolve type issues in dependent components
- Many errors are repetitive patterns that can be fixed systematically

## Testing Strategy
After fixes:
1. Verify all task state transitions work correctly
2. Test task creation, modification, and deletion
3. Ensure UI components properly handle all task states
4. Check that task persistence/restoration works