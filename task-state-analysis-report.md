# Task State Inconsistency Analysis Report

## Executive Summary

This report analyzes the task state inconsistencies between two parallel implementations in the codebase:
- **Anicet's Agent System**: Uses states `prompting`, `queued`, `running`, `paused`, `completed`, `failed`
- **Isaline's Backlog System**: Uses states `open`, `in_progress`, `completed`

The two systems currently operate independently but will need to communicate when tasks start running on the agent side and are reported on the backlog side. This creates potential for state synchronization issues.

## Current State Analysis

### 1. Anicet's Implementation (Agent/Canvas System)

**Location**: `/frontend/tauri-app/src/types/Task.ts`

**States**:
```typescript
export type TaskStatus = 'prompting' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';
```

**Characteristics**:
- Focused on execution lifecycle of AI agent tasks
- Tracks detailed execution states (queued, running, paused)
- Includes failure state for error handling
- Managed by `TaskManager` class with state transitions
- Stored in canvas-specific task managers
- Has complex state machine logic for transitions

### 2. Isaline's Implementation (Collective Backlog System)

**Location**: `/frontend/tauri-app/src/services/BacklogService.ts` and `/frontend/tauri-app/src/components/CollectiveBacklogManagement.tsx`

**States**:
```typescript
status: 'open' | 'in_progress' | 'completed'
```

**Characteristics**:
- Focused on high-level project management view
- Simpler state model for task tracking
- Integrated with backend database
- Uses task-prompt mappings to calculate status
- Persisted in localStorage and backend database

### 3. Integration Points

The systems interact through:

1. **Task-Prompt Mappings** (`CollectiveBacklogManagement.tsx:59`):
   ```typescript
   Record<number, Record<string, { agentId: string, status: 'in_progress' | 'merged' }>>
   ```
   - Maps backlog task IDs to agent prompts
   - Tracks whether prompts are in progress or merged

2. **Status Calculation Logic** (`CollectiveBacklogManagement.tsx:89`):
   - `open`: No prompts linked to the task
   - `in_progress`: Some prompts exist but not all are merged
   - `completed`: All linked prompts are merged

## Identified Issues

### 1. State Mapping Inconsistency
- Agent states (`queued`, `running`, `paused`) all map to backlog `in_progress`
- No representation of `failed` state in backlog system
- `prompting` state has no clear mapping

### 2. Synchronization Gaps
- Agent task state changes don't automatically update backlog status
- No clear mechanism to handle agent task failures in backlog
- Canvas merge operations update prompt status but not agent task status

### 3. Data Model Mismatch
- Agent tasks have detailed lifecycle (start time, pause time, etc.)
- Backlog items have simpler structure focused on ownership and priority
- No shared identifier between agent tasks and backlog items

### 4. Persistence Issues
- Agent tasks stored in canvas-specific TaskManagers (ephemeral)
- Backlog items stored in backend database (persistent)
- Task-prompt mappings stored in localStorage (semi-persistent)

## Recommendations

### Short-Term Solutions (Minimum Impact)

1. **Create State Mapping Function**
   ```typescript
   function mapAgentStateToBacklogState(agentState: TaskStatus): 'open' | 'in_progress' | 'completed' {
     switch(agentState) {
       case 'prompting':
         return 'open';
       case 'queued':
       case 'running':
       case 'paused':
         return 'in_progress';
       case 'completed':
         return 'completed';
       case 'failed':
         return 'in_progress'; // Or consider adding 'failed' to backlog
     }
   }
   ```

2. **Add Event Listeners**
   - Subscribe to TaskManager state changes
   - Update backlog status when agent task status changes
   - Maintain existing task-prompt mapping structure

3. **Handle Failed State**
   - Option A: Map `failed` to `in_progress` with a flag
   - Option B: Add visual indicator for failed tasks in backlog UI
   - Store failure reason in task-prompt mappings

### Long-Term Solutions (Maximum Benefit)

1. **Unified Task Model**
   ```typescript
   interface UnifiedTask {
     id: string;
     backlogId?: number;
     agentTaskId?: string;
     status: UnifiedTaskStatus;
     // ... common fields
   }
   ```

2. **State Machine Abstraction**
   - Create a shared state machine library
   - Define allowed transitions for both systems
   - Implement state change notifications

3. **Persistent Task Store**
   - Move agent tasks to backend storage
   - Create proper relationships between entities
   - Implement proper event sourcing

4. **Add Missing States**
   - Consider adding `failed` state to backlog
   - Consider adding `blocked` or `waiting` states
   - Align terminology between systems

## Implementation Priority

1. **Immediate**: Add state mapping function and update `CollectiveBacklogManagement` to listen for agent task state changes
2. **Short-term**: Implement proper failed state handling
3. **Medium-term**: Create unified event system for state synchronization
4. **Long-term**: Refactor to unified task model with shared state machine

## Risk Assessment

- **High Risk**: Tasks showing incorrect status when agent executes
- **Medium Risk**: Failed tasks not properly represented in backlog
- **Low Risk**: Performance impact from additional state synchronization

## Conclusion

The current dual-state system works independently but will break when integration begins. The recommended approach is to implement the short-term mapping solution immediately while planning for the long-term unified model. This ensures system stability while maintaining flexibility for future improvements.