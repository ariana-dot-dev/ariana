# **Ultra-Precise Implementation Plan: Multi-Task Terminal System**

## **Core Requirements Summary**

Based on all specifications, here's what we're implementing:

1. **Multi-task support** with individual Start buttons per task
2. **Persistent terminal** that never auto-closes (only manual commit)
3. **Task fusion** on commit (running tasks → single fused task)
4. **Auto-task creation** when no empty tasks exist
5. **Enhanced terminal controls** (hide/maximize/pause/resume/commit)
6. **Reliable escape interruption** with "Interrupted by user" detection
7. **Cross-canvas terminal persistence** (already works, preserve it)
8. **Canvas locking only for merging** (not task execution)

---

## **Detailed Requirements Analysis**

### **Current Behavior vs New Behavior**

| Aspect | Current | New |
|--------|---------|-----|
| **Task Model** | Single task per canvas | Multiple tasks per canvas |
| **Terminal Lifecycle** | Auto-closes after 5s inactivity | Persistent until manual commit |
| **Task Completion** | Automatic timeout detection | Manual commit button |
| **Canvas Locking** | Locked during task execution | Only locked during merging |
| **Prompt Input** | Single text area | Multiple task text areas |
| **Terminal Controls** | Basic visibility | Hide/maximize/pause/resume/commit |

### **Key User Experience Flow**

1. **Empty Canvas**: Auto-creates one empty task
2. **Typing Prompt**: Text area auto-resizes, "Start" button appears
3. **Starting Task**: Terminal launches, Claude Code starts, task marked as running
4. **Adding More Tasks**: New empty task auto-created below
5. **Multiple Running Tasks**: All queued in same Claude Code instance
6. **Manual Control**: Pause/resume/hide terminal as needed
7. **Commit**: Fusion all running tasks → single commit → clear running tasks
8. **Persistence**: Terminal survives canvas switches and app restarts

---

## **Step-by-Step Implementation Plan**

### **PHASE 1: Data Model Updates**

#### **Step 1.1: Extend Task States**
**File:** `frontend/tauri-app/src/types/Task.ts`

**Current Task States:**
```typescript
export type TaskStatus = 'prompting' | 'in_progress' | 'completed';
```

**New Task States:**
```typescript
export type TaskStatus = 'prompting' | 'queued' | 'running' | 'paused' | 'completed' | 'failed';

export interface QueuedTask extends TaskBase {
  status: 'queued';
  queuedAt: number;
}

export interface PausedTask extends TaskBase {
  status: 'paused';
  startedAt: number;
  pausedAt: number;
}

export type Task = PromptingTask | QueuedTask | InProgressTask | PausedTask | CompletedTask;
```

**State Transitions:**
- `prompting` → `queued` (when Start button clicked)
- `queued` → `running` (when prompt sent to Claude Code)
- `running` → `paused` (when pause button clicked)
- `paused` → `running` (when resume button clicked)
- `running` → `completed` (when commit button clicked)

#### **Step 1.2: Add TaskManager Methods**
**File:** `frontend/tauri-app/src/types/Task.ts` (TaskManager class)

**New Methods to Add:**
```typescript
// Add to TaskManager class
queueTask(taskId: string): boolean {
  const taskIndex = this.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1 || this.tasks[taskIndex].status !== 'prompting') return false;
  
  const task = this.tasks[taskIndex] as PromptingTask;
  const queuedTask: QueuedTask = {
    ...task,
    status: 'queued',
    queuedAt: Date.now()
  };
  
  this.tasks[taskIndex] = queuedTask;
  this.notifyListeners();
  return true;
}

pauseTask(taskId: string): boolean {
  const taskIndex = this.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1 || this.tasks[taskIndex].status !== 'in_progress') return false;
  
  const task = this.tasks[taskIndex] as InProgressTask;
  const pausedTask: PausedTask = {
    ...task,
    status: 'paused',
    pausedAt: Date.now()
  };
  
  this.tasks[taskIndex] = pausedTask;
  this.notifyListeners();
  return true;
}

resumeTask(taskId: string): boolean {
  const taskIndex = this.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1 || this.tasks[taskIndex].status !== 'paused') return false;
  
  const task = this.tasks[taskIndex] as PausedTask;
  const runningTask: InProgressTask = {
    ...task,
    status: 'in_progress'
  };
  
  this.tasks[taskIndex] = runningTask;
  this.notifyListeners();
  return true;
}

getRunningTasks(): (InProgressTask | QueuedTask)[] {
  return this.tasks.filter(t => 
    t.status === 'in_progress' || t.status === 'queued'
  ) as (InProgressTask | QueuedTask)[];
}

fuseRunningTasks(): CompletedTask {
  const runningTasks = this.getRunningTasks();
  if (runningTasks.length === 0) {
    throw new Error('No running tasks to fuse');
  }
  
  const firstTask = runningTasks[0];
  
  // Concatenate all running task prompts
  const fusedPrompt = runningTasks.map(t => t.prompt).join('\n\n---\n\n');
  
  const fusedTask: CompletedTask = {
    id: firstTask.id,
    prompt: fusedPrompt,
    createdAt: firstTask.createdAt,
    status: 'completed',
    startedAt: (firstTask as InProgressTask).startedAt || Date.now(),
    completedAt: Date.now(),
    commitHash: '', // Will be set after commit
    isReverted: false
  };
  
  // Remove all running tasks from the list
  this.tasks = this.tasks.filter(t => !runningTasks.includes(t as any));
  
  // Insert fused task at the position of the first running task
  const insertIndex = this.tasks.findIndex(t => t.createdAt > firstTask.createdAt);
  this.tasks.splice(insertIndex >= 0 ? insertIndex : this.tasks.length, 0, fusedTask);
  
  this.notifyListeners();
  return fusedTask;
}
```

#### **Step 1.3: Update TextArea for Multi-Task**
**File:** `frontend/tauri-app/src/canvas/TextArea.ts`

**Changes to Make:**
```typescript
export class TextArea {
  // REMOVE single content properties
  // public content: string; // REMOVE
  // public currentPrompt: string; // REMOVE
  
  // Keep existing task-related properties
  public completedTasks: CompletedTask[]; // Keep for compatibility
  
  // ADD: Auto-task creation method
  ensureEmptyTask(taskManager: TaskManager): void {
    const tasks = taskManager.getTasks();
    const hasEmptyPromptingTask = tasks.some(t => 
      (t.status === 'prompting') && 
      (!t.prompt || t.prompt.trim() === '')
    );
    
    if (!hasEmptyPromptingTask) {
      taskManager.createPromptingTask('');
    }
  }
  
  // UPDATE: Remove shouldTriggerAutoGo - no longer needed
  // public shouldTriggerAutoGo: boolean = false; // REMOVE
}
```

### **PHASE 2: ClaudeCodeAgent Updates**

#### **Step 2.1: Remove Auto-Completion Logic**
**File:** `frontend/tauri-app/src/services/ClaudeCodeAgent.ts`

**Lines to Remove/Modify:**
```typescript
// REMOVE: Auto-completion timeout logic
// private completionTimeoutId: NodeJS.Timeout | null = null; // REMOVE LINE 53
// private resetCompletionTimeout(): void { ... } // REMOVE METHOD at lines 435-446
// private handleTaskCompletion(): Promise<void> { ... } // REMOVE METHOD at lines 448-551

// MODIFY: handleTerminalEvents method to remove timeout trigger
private async handleTerminalEvents(events: TerminalEvent[]): Promise<void> {
  // ... existing event processing ...
  
  // Update last activity time but DON'T trigger completion
  this.lastActivityTime = Date.now();
  // REMOVE: this.resetCompletionTimeout(); // REMOVE THIS LINE
  
  // Get current TUI lines for CLI agents library
  const tuiLines = this.getCurrentTuiLines();
  // Emit screen update event
  this.emit("screenUpdate", tuiLines);

  // Process TUI interactions based on new lines
  await this.processTuiInteraction(tuiLines);
}
```

**New Properties to Add:**
```typescript
export class ClaudeCodeAgent extends CustomTerminalAPI {
  // ADD: Manual control state
  private isPaused: boolean = false;
  private isManuallyControlled: boolean = false;
  
  // ... existing properties ...
}
```

#### **Step 2.2: Add Manual Control Methods**
**File:** `frontend/tauri-app/src/services/ClaudeCodeAgent.ts`

**New Methods to Add:**
```typescript
// ADD: Manual pause method
async pauseAgent(): Promise<void> {
  if (!this.terminalId || this.isPaused) return;
  
  console.log(`${this.logPrefix} Pausing agent...`);
  await this.sendEscapeUntilInterrupted();
  this.isPaused = true;
  this.emit('agentPaused');
}

// ADD: Manual resume method
async resumeAgent(): Promise<void> {
  if (!this.terminalId || !this.isPaused) return;
  
  console.log(`${this.logPrefix} Resuming agent...`);
  await this.sendRawInput(this.terminalId, "continue\r");
  this.isPaused = false;
  this.emit('agentResumed');
}

// ADD: Queue prompt method (for multiple tasks)
async queuePrompt(prompt: string): Promise<void> {
  if (!this.terminalId) {
    throw new Error('No terminal available for queuing prompt');
  }
  
  console.log(`${this.logPrefix} Queuing prompt: ${prompt.substring(0, 50)}...`);
  
  // Send prompt to Claude Code (will be queued if busy)
  for (const char of prompt) {
    if (char === "\n") {
      await this.sendRawInput(this.terminalId, "\\");
      await this.delay(Math.random() * 5 + 5);
      await this.sendRawInput(this.terminalId, "\r\n");
    } else {
      await this.sendRawInput(this.terminalId, char);
    }
    await this.delay(Math.random() * 5 + 5);
  }
  await this.delay(1000);
  await this.sendRawInput(this.terminalId, "\x0d");
  
  this.emit('promptQueued', { prompt });
}

// ADD: Manual commit preparation
async prepareManualCommit(): Promise<void> {
  console.log(`${this.logPrefix} Preparing for manual commit...`);
  // Don't send Ctrl+D - keep terminal alive
  // Just indicate ready for commit
  this.emit('readyForCommit');
}

// ADD: Enhanced escape sequence with "Interrupted by user" detection
private async sendEscapeUntilInterrupted(): Promise<void> {
  console.log(`${this.logPrefix} Sending escape sequences until interrupted...`);
  let attempts = 0;
  
  while (true) {
    await this.sendRawInput(this.terminalId!, "\x1b"); // ESC
    await this.delay(500);
    
    const currentLines = this.getCurrentTuiLines();
    const hasInterrupted = currentLines.some(line => 
      line.content.includes("⎿  Interrupted by user")
    );
    const hasPrompt = currentLines.some(line => 
      line.content.includes("| >")
    );
    
    if (hasInterrupted && hasPrompt) {
      console.log(`${this.logPrefix} Successfully interrupted after ${attempts + 1} attempts`);
      break;
    }
    
    attempts++;
    if (attempts % 10 === 0) {
      console.log(`${this.logPrefix} Escape attempt ${attempts}, still trying...`);
    }
    
    // No timeout - keep trying indefinitely as specified
  }
}

// ADD: Get agent status
getAgentStatus(): { isRunning: boolean; isPaused: boolean; terminalId: string | null } {
  return {
    isRunning: this.isRunning,
    isPaused: this.isPaused,
    terminalId: this.terminalId
  };
}
```

#### **Step 2.3: Update Cleanup Method**
**File:** `frontend/tauri-app/src/services/ClaudeCodeAgent.ts`

**Modify cleanup method to preserve terminal:**
```typescript
// MODIFY: cleanup method (lines 228-261)
async cleanup(preserveTerminal: boolean = false): Promise<void> {
  console.log(`${this.logPrefix} Starting cleanup (preserveTerminal: ${preserveTerminal})...`);
  
  // Clear timeouts
  if (this.completionTimeoutId) {
    clearTimeout(this.completionTimeoutId);
    this.completionTimeoutId = null;
  }
  
  // Only kill terminal if not preserving
  if (this.terminalId && !preserveTerminal) {
    try {
      console.log(`${this.logPrefix} Killing terminal ${this.terminalId}`);
      await this.killTerminal(this.terminalId);
    } catch (error) {
      console.error(`${this.logPrefix} Error killing terminal:`, error);
    }
  }

  console.log(`${this.logPrefix} Calling super.cleanup()`);
  super.cleanup();
  
  // Reset state
  this.isRunning = false;
  this.currentTask = null;
  this.currentPrompt = null;
  this.screenLines = [];
  this.hasSeenTryPrompt = false;
  this.hasSeenTrustPrompt = false;
  this.isProcessingEvents = false;
  this.eventQueue = [];
  this.lastActivityTime = 0;
  this.isCompletingTask = false;
  this.isPaused = false; // ADD this line
  
  this.removeAllListeners();
  console.log(`${this.logPrefix} Cleanup completed`);
}
```

### **PHASE 3: UI Component Updates**

#### **Step 3.1: Create Terminal Control Components**
**File:** `frontend/tauri-app/src/canvas/TerminalControls.tsx` (NEW FILE)

**Create this new component:**
```typescript
import React from 'react';
import { cn } from '../utils';

interface TerminalControlsProps {
  isTerminalMaximized: boolean;
  isTerminalVisible: boolean;
  isAgentPaused: boolean;
  isAgentRunning: boolean;
  hasRunningTasks: boolean;
  canControlTerminal: boolean;
  onToggleVisibility: () => void;
  onToggleMaximize: () => void;
  onPause: () => void;
  onResume: () => void;
  onCommit: () => void;
}

export const TerminalControls: React.FC<TerminalControlsProps> = ({
  isTerminalMaximized,
  isTerminalVisible,
  isAgentPaused,
  isAgentRunning,
  hasRunningTasks,
  canControlTerminal,
  onToggleVisibility,
  onToggleMaximize,
  onPause,
  onResume,
  onCommit
}) => {
  return (
    <>
      {/* Hide/Show Toggle - At intersection of terminal and canvas */}
      <button
        onClick={onToggleVisibility}
        className={cn(
          "absolute left-0 top-1/2 -translate-y-1/2 z-20",
          "bg-[var(--base-300)] hover:bg-[var(--base-400)]",
          "w-6 h-12 rounded-r-lg transition-all",
          "flex items-center justify-center text-[var(--base-600)]"
        )}
        style={{ left: isTerminalVisible ? '-12px' : '-6px' }}
        title={isTerminalVisible ? 'Hide Terminal' : 'Show Terminal'}
      >
        {isTerminalVisible ? '◀' : '▶'}
      </button>

      {isTerminalVisible && (
        <>
          {/* Maximize Button - Floating top-right */}
          <button
            onClick={onToggleMaximize}
            className={cn(
              "absolute top-2 right-2 z-20",
              "bg-[var(--base-300)] hover:bg-[var(--base-400)]",
              "w-8 h-8 rounded transition-all",
              "flex items-center justify-center text-[var(--base-600)]"
            )}
            title={isTerminalMaximized ? 'Restore Terminal' : 'Maximize Terminal'}
          >
            {isTerminalMaximized ? '❐' : '⛶'}
          </button>

          {/* Control Panel - Floating bottom-right */}
          {isAgentRunning && canControlTerminal && (
            <div className={cn(
              "absolute bottom-4 right-4 z-20",
              "bg-[var(--base-200)] border border-[var(--base-300)]",
              "rounded-lg p-2 flex gap-2 shadow-lg"
            )}>
              {/* Pause/Resume Button */}
              <button
                onClick={isAgentPaused ? onResume : onPause}
                className={cn(
                  "px-3 py-1 rounded text-sm transition-all",
                  "flex items-center gap-1",
                  isAgentPaused
                    ? "bg-[var(--positive-400)] text-[var(--blackest)] hover:bg-[var(--positive-300)]"
                    : "bg-[var(--base-400)] text-[var(--whitest)] hover:bg-[var(--base-500)]"
                )}
                title={isAgentPaused ? 'Resume Claude Code' : 'Pause Claude Code'}
              >
                {isAgentPaused ? '▶ Resume' : '⏸ Pause'}
              </button>

              {/* Commit Button - Only when tasks are running */}
              {hasRunningTasks && (
                <button
                  onClick={onCommit}
                  className={cn(
                    "px-3 py-1 rounded text-sm transition-all",
                    "bg-[var(--positive-500)] text-[var(--whitest)]",
                    "hover:bg-[var(--positive-400)]",
                    "flex items-center gap-1"
                  )}
                  title="Commit all running tasks"
                >
                  ✓ Commit
                </button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
};
```

#### **Step 3.2: Create TaskComponent**
**File:** `frontend/tauri-app/src/canvas/TaskComponent.tsx` (NEW FILE)

**Create this new component:**
```typescript
import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../utils';
import { Task } from '../types/Task';

interface TaskComponentProps {
  task: Task;
  isRunning: boolean;
  hasOtherRunningTasks: boolean;
  canEdit: boolean;
  canStartTasks: boolean;
  onStart: () => void;
  onStopCommitStart: () => void;
  onUpdatePrompt: (prompt: string) => void;
  onRevert?: (taskId: string) => void;
  onRestore?: (taskId: string) => void;
}

export const TaskComponent: React.FC<TaskComponentProps> = ({
  task,
  isRunning,
  hasOtherRunningTasks,
  canEdit,
  canStartTasks,
  onStart,
  onStopCommitStart,
  onUpdatePrompt,
  onRevert,
  onRestore
}) => {
  const [localPrompt, setLocalPrompt] = useState(task.prompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current && task.status === 'prompting') {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.max(24, textareaRef.current.scrollHeight) + 'px';
    }
  }, [localPrompt, task.status]);

  // Update local prompt when task prompt changes
  useEffect(() => {
    if (task.status === 'prompting') {
      setLocalPrompt(task.prompt);
    }
  }, [task.prompt, task.status]);

  const handlePromptChange = (value: string) => {
    setLocalPrompt(value);
    onUpdatePrompt(value);
  };

  const getTaskStatusEmoji = () => {
    if (task.status === 'completed') {
      if (task.isReverted) return '❌';
      if (task.commitHash === "NO_CHANGES") return '⚠️';
      if (task.commitHash) return '✅';
      return '❌';
    }
    if (task.status === 'failed') return '❌';
    if (task.status === 'in_progress') return '🔄';
    if (task.status === 'paused') return '⏸️';
    if (task.status === 'queued') return '⏳';
    return '';
  };

  const getTaskStatusColor = () => {
    switch (task.status) {
      case 'completed':
        if (task.isReverted) return "text-[var(--base-500-50)] line-through";
        if (task.commitHash) return "text-[var(--positive-500-50)]";
        return "text-[var(--base-600-50)]";
      case 'in_progress':
        return "text-[var(--base-500-50)] animate-pulse";
      case 'paused':
        return "text-[var(--base-500-50)]";
      case 'queued':
        return "text-[var(--acc-500-50)]";
      case 'failed':
        return "text-[var(--negative-500-50)]";
      case 'prompting':
      default:
        return "text-[var(--base-500)]";
    }
  };

  const showStartButton = task.status === 'prompting' && 
                          localPrompt.trim().length > 0 && 
                          canStartTasks;
                          
  const showStopCommitStartButton = hasOtherRunningTasks && 
                                   task.status === 'prompting' && 
                                   localPrompt.trim().length > 0 && 
                                   canStartTasks;

  const showRevertRestoreButton = task.status === 'completed' &&
                                 task.commitHash &&
                                 task.commitHash !== "NO_CHANGES" &&
                                 task.commitHash !== "GIT_ERROR" &&
                                 task.commitHash.length > 0 &&
                                 canEdit;

  const isEditable = task.status === 'prompting' && canEdit;

  return (
    <div className="relative mb-2 group">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={isEditable ? localPrompt : task.prompt}
          onChange={(e) => isEditable && handlePromptChange(e.target.value)}
          disabled={!isEditable}
          placeholder={
            !canEdit ? "Canvas locked during merge operations" : 
            task.status === 'prompting' ? "Describe what you want the agent to do..." : 
            ""
          }
          className={cn(
            "w-[calc(100%-120px)] font-mono border-none text-base resize-none bg-transparent",
            "overflow: hidden", // No scrollbar - auto-resize instead
            getTaskStatusColor(),
            !isEditable && "cursor-default",
            !canEdit && "opacity-60",
            "whitespace-pre-wrap break-words overflow-wrap-anywhere",
            "scrollbar-none", // Ensure no scrollbar appears
            "min-h-[24px]" // Minimum height
          )}
          spellCheck={false}
          rows={1} // Start with single row
        />
        
        {/* Status emoji and buttons container */}
        <div className="absolute flex items-center gap-1" style={{
          right: '8px',
          top: '2px'
        }}>
          {/* Status emoji */}
          <span className="text-base min-w-[16px] text-center">
            {getTaskStatusEmoji()}
          </span>
          
          {/* Start button */}
          {showStartButton && (
            <button
              onClick={onStart}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-all",
                "bg-[var(--positive-400)] text-[var(--blackest)]",
                "hover:bg-[var(--positive-300)]",
                "opacity-0 group-hover:opacity-100"
              )}
              title="Start this task"
            >
              Start
            </button>
          )}
          
          {/* Stop, commit and start button */}
          {showStopCommitStartButton && (
            <button
              onClick={onStopCommitStart}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-all whitespace-nowrap",
                "bg-[var(--acc-400)] text-[var(--blackest)]",
                "hover:bg-[var(--acc-300)]",
                "opacity-0 group-hover:opacity-100"
              )}
              title="Stop current tasks, commit them, and start this task"
            >
              Stop, Commit & Start
            </button>
          )}

          {/* Revert/Restore button for completed tasks */}
          {showRevertRestoreButton && (
            <button
              onClick={() => task.isReverted ? onRestore?.(task.id) : onRevert?.(task.id)}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-all",
                "opacity-0 group-hover:opacity-100",
                task.isReverted
                  ? "bg-[var(--positive-400)] text-[var(--blackest)] hover:bg-[var(--positive-300)]"
                  : "bg-[var(--base-400)] text-[var(--blackest)] hover:bg-[var(--base-300)]"
              )}
              title={task.isReverted ? 'Restore this task' : 'Revert this task'}
            >
              {task.isReverted ? 'Restore' : 'Revert'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
```

#### **Step 3.3: Update TextAreaOnCanvas for Multi-Task**
**File:** `frontend/tauri-app/src/canvas/TextAreaOnCanvas.tsx`

**Major changes to make:**

**Add new imports:**
```typescript
import { TerminalControls } from './TerminalControls';
import { TaskComponent } from './TaskComponent';
```

**Add new state variables:**
```typescript
// ADD: New state for terminal controls
const [isTerminalMaximized, setIsTerminalMaximized] = useState(false);
const [isAgentPaused, setIsAgentPaused] = useState(false);

// MODIFY: Replace single task logic with multi-task
// const [text, setText] = useState((layout.element.kind as TextAreaKind).textArea.content); // REMOVE
// const [currentPrompt, setCurrentPrompt] = useState(""); // REMOVE

// ADD: Multi-task state
const allTasks = taskManager?.getTasks() || [];
const runningTasks = taskManager?.getRunningTasks() || [];
const hasRunningTasks = runningTasks.length > 0;
const canControlTerminal = currentCanvas ? canEditCanvas(currentCanvas.id) : false;
```

**Replace task handling logic:**
```typescript
// REMOVE: Single task effects (lines around 169-200)
// REPLACE WITH: Multi-task auto-creation
useEffect(() => {
  if (taskManager && currentCanvas) {
    const textAreaObj = (layout.element.kind as TextAreaKind).textArea;
    textAreaObj.ensureEmptyTask(taskManager);
  }
}, [allTasks.length, taskManager, currentCanvas]);
```

**Add new task control handlers:**
```typescript
// ADD: Multi-task control handlers
const handleStartTask = async (taskId: string) => {
  const task = taskManager?.getTask(taskId);
  if (!task || !task.prompt.trim() || !canEdit) return;
  
  try {
    if (!claudeAgent || !claudeAgent.isTaskRunning()) {
      // Start new agent if none exists
      console.log(`[TextAreaOnCanvas] Starting new agent for task ${taskId}`);
      const success = await startTaskWithPrompt(task.prompt);
      if (success) {
        taskManager?.startTask(taskId);
      }
    } else {
      // Queue prompt in existing agent
      console.log(`[TextAreaOnCanvas] Queuing prompt in existing agent for task ${taskId}`);
      await claudeAgent.queuePrompt(task.prompt);
      taskManager?.startTask(taskId);
    }
  } catch (error) {
    console.error('Failed to start task:', error);
  }
};

const handleStopCommitStart = async (taskId: string) => {
  if (!claudeAgent || !taskManager || !canEdit) return;
  
  try {
    console.log(`[TextAreaOnCanvas] Stop, commit and start for task ${taskId}`);
    
    // 1. Send escape until interrupted
    await claudeAgent.pauseAgent();
    
    // 2. Fusion and commit running tasks
    if (hasRunningTasks) {
      const fusedTask = taskManager.fuseRunningTasks();
      const { GitService } = await import('../services/GitService');
      const commitHash = await GitService.createCommit(
        textAreaOsSession || { Local: "." }, 
        fusedTask.prompt
      );
      
      // Update fused task with commit hash
      fusedTask.commitHash = commitHash;
      taskManager.completeTask(fusedTask.id, commitHash);
    }
    
    // 3. Start new task
    await handleStartTask(taskId);
  } catch (error) {
    console.error('Stop, commit and start failed:', error);
  }
};

const handleCommit = async () => {
  if (!claudeAgent || !taskManager || !hasRunningTasks) return;
  
  try {
    console.log(`[TextAreaOnCanvas] Manual commit of ${runningTasks.length} running tasks`);
    
    const fusedTask = taskManager.fuseRunningTasks();
    const { GitService } = await import('../services/GitService');
    const commitHash = await GitService.createCommit(
      textAreaOsSession || { Local: "." }, 
      fusedTask.prompt
    );
    
    fusedTask.commitHash = commitHash;
    taskManager.completeTask(fusedTask.id, commitHash);
    
    console.log(`[TextAreaOnCanvas] Successfully committed fused task with hash: ${commitHash}`);
    // Keep agent and terminal running - don't cleanup
  } catch (error) {
    console.error('Manual commit failed:', error);
  }
};

const handleTaskPromptUpdate = (taskId: string, prompt: string) => {
  taskManager?.updateTaskPrompt(taskId, prompt);
  
  // Persist to GitProject immediately
  if (currentCanvas) {
    setInProgressPrompt(currentCanvas.id, elementId, prompt);
  }
};
```

**Update agent event handlers:**
```typescript
// ADD: New agent event handlers for pause/resume
useEffect(() => {
  if (!claudeAgent) return;

  const handleAgentPaused = () => {
    console.log(`[TextAreaOnCanvas] Agent paused`);
    setIsAgentPaused(true);
  };
  
  const handleAgentResumed = () => {
    console.log(`[TextAreaOnCanvas] Agent resumed`);
    setIsAgentPaused(false);
  };

  const handlePromptQueued = (data: { prompt: string }) => {
    console.log(`[TextAreaOnCanvas] Prompt queued:`, data.prompt.substring(0, 50));
  };

  claudeAgent.on("agentPaused", handleAgentPaused);
  claudeAgent.on("agentResumed", handleAgentResumed);
  claudeAgent.on("promptQueued", handlePromptQueued);

  return () => {
    claudeAgent.off("agentPaused", handleAgentPaused);
    claudeAgent.off("agentResumed", handleAgentResumed);
    claudeAgent.off("promptQueued", handlePromptQueued);
  };
}, [claudeAgent]);
```

**Replace render logic:**
```typescript
// REPLACE: Single task rendering with multi-task rendering
return (
  <motion.div /* ... existing motion props ... */>
    <div className={cn("w-full h-full flex p-3")}>
      {/* Task Area */}
      <div
        className={cn(
          "relative flex flex-col rounded-md gap-0 h-full",
          showTerminal && !isTerminalMaximized ? "w-2/5" : "w-full",
          isTerminalMaximized && "hidden"
        )}
        style={{
          backgroundImage: "radial-gradient(circle at 3px 3px, var(--base-400-30) 1px, transparent 0)",
          backgroundSize: "24px 24px",
          backgroundPosition: "10px 20px",
        }}
      >
        <div className="h-full overflow-y-auto">
          {/* Render all tasks */}
          {allTasks.map((task) => (
            <TaskComponent
              key={task.id}
              task={task}
              isRunning={runningTasks.some(rt => rt.id === task.id)}
              hasOtherRunningTasks={hasRunningTasks && !runningTasks.some(rt => rt.id === task.id)}
              canEdit={canEdit}
              canStartTasks={canEdit && canvasLockState === 'normal'}
              onStart={() => handleStartTask(task.id)}
              onStopCommitStart={() => handleStopCommitStart(task.id)}
              onUpdatePrompt={(prompt) => handleTaskPromptUpdate(task.id, prompt)}
              onRevert={handleRevertTask}
              onRestore={handleRestoreTask}
            />
          ))}
        </div>
      </div>

      {/* Terminal with controls */}
      {showTerminal && terminalId && (
        <div className={cn(
          "relative h-full mt-2",
          isTerminalMaximized ? "w-full" : "w-3/5"
        )}>
          <TerminalControls
            isTerminalMaximized={isTerminalMaximized}
            isTerminalVisible={showTerminal}
            isAgentPaused={isAgentPaused}
            isAgentRunning={!!claudeAgent && claudeAgent.isTaskRunning()}
            hasRunningTasks={hasRunningTasks}
            canControlTerminal={canControlTerminal}
            onToggleVisibility={() => setShowTerminal(!showTerminal)}
            onToggleMaximize={() => setIsTerminalMaximized(!isTerminalMaximized)}
            onPause={() => claudeAgent?.pauseAgent()}
            onResume={() => claudeAgent?.resumeAgent()}
            onCommit={handleCommit}
          />
          
          <div className="w-full h-full opacity-70">
            <CustomTerminalRenderer
              elementId={`claude-terminal-${terminalId}`}
              existingTerminalId={terminalId}
              terminalAPI={claudeAgent || undefined}
              onTerminalReady={(id) => console.log("Claude terminal ready:", id)}
              onTerminalError={(error) => console.error("Claude terminal error:", error)}
              fontSize="xs"
            />
          </div>
        </div>
      )}
    </div>
  </motion.div>
);
```

### **PHASE 4: Canvas Locking Updates**

#### **Step 4.1: Update Canvas Lock Logic**
**File:** `frontend/tauri-app/src/types/GitProject.ts`

**Modify existing methods:**
```typescript
// MODIFY: canEditCanvas to allow task creation during normal state
canEditCanvas(canvasId: string): boolean {
  const canvas = this.canvases.find(c => c.id === canvasId);
  if (!canvas) return false;
  
  // Allow editing during normal and loading states
  // Only lock for merging operations, not task execution
  return canvas.lockState === 'normal' || canvas.lockState === 'loading';
}

// ADD: New method to check if terminal should be locked
canControlTerminal(canvasId: string): boolean {
  const canvas = this.canvases.find(c => c.id === canvasId);
  if (!canvas) return false;
  
  // Allow terminal control during normal state only
  return canvas.lockState === 'normal';
}

// ADD: Method to check if tasks can be started
canStartTasks(canvasId: string): boolean {
  const canvas = this.canvases.find(c => c.id === canvasId);
  if (!canvas) return false;
  
  // Allow starting tasks only during normal state
  return canvas.lockState === 'normal';
}
```

#### **Step 4.2: Update Canvas Lock Checks**
**File:** `frontend/tauri-app/src/canvas/TextAreaOnCanvas.tsx`

**Update lock state checking:**
```typescript
// MODIFY: Lock state variables
const canvasLockState = currentCanvas ? getCanvasLockState(currentCanvas.id) : 'normal';
const isCanvasLocked = canvasLockState !== 'normal';
const canEdit = currentCanvas ? canEditCanvas(currentCanvas.id) : false;
const canControlTerminal = currentCanvas ? canControlTerminal(currentCanvas.id) : false; // ADD
const canStartTasks = currentCanvas ? canStartTasks(currentCanvas.id) : false; // ADD
```

### **PHASE 5: Process Manager Updates**

#### **Step 5.1: Enhance Process Tracking**
**File:** `frontend/tauri-app/src/services/ProcessManager.ts`

**Add methods for multi-task tracking:**
```typescript
export class ProcessManager {
  // ADD: Map to track multiple tasks per process
  private static processTaskMappings = new Map<string, string[]>(); // processId -> taskIds[]

  // ADD: Method to associate multiple tasks with a process
  static setProcessTasks(processId: string, taskIds: string[]): void {
    console.log('[ProcessManager] Setting process tasks:', processId, '→', taskIds);
    this.processTaskMappings.set(processId, taskIds);
  }

  // ADD: Method to get tasks for a process
  static getProcessTasks(processId: string): string[] {
    return this.processTaskMappings.get(processId) || [];
  }

  // ADD: Method to add task to existing process
  static addTaskToProcess(processId: string, taskId: string): void {
    const existingTasks = this.getProcessTasks(processId);
    if (!existingTasks.includes(taskId)) {
      this.setProcessTasks(processId, [...existingTasks, taskId]);
    }
  }

  // MODIFY: Cleanup method to clean task mappings
  static cleanup(): void {
    const toRemove: string[] = [];
    
    for (const [processId, process] of this.activeProcesses.entries()) {
      if (!this.isProcessRunning(processId)) {
        console.log('[ProcessManager] Marking dead process for cleanup:', processId);
        toRemove.push(processId);
      }
    }
    
    toRemove.forEach(processId => {
      this.unregisterProcess(processId);
      this.processTaskMappings.delete(processId); // ADD this line
    });
    
    console.log('[ProcessManager] Cleanup complete. Removed', toRemove.length, 'dead processes');
  }
}
```

### **PHASE 6: Error Handling and Edge Cases**

#### **Step 6.1: Add Git Stash for Failed Tasks**
**File:** `frontend/tauri-app/src/services/GitService.ts`

**Add git stash method:**
```typescript
// ADD: Git stash method for failed tasks
static async stashChanges(osSession: OsSession, message?: string): Promise<void> {
  try {
    const stashMessage = message || `Auto-stash on task failure - ${new Date().toISOString()}`;
    
    await invoke('execute_command_with_os_session', {
      command: 'git',
      args: ['stash', 'push', '-m', stashMessage],
      directory: osSessionGetWorkingDirectory(osSession),
      osSession
    });
    
    console.log(`[GitService] Successfully stashed changes: ${stashMessage}`);
  } catch (error) {
    console.error('[GitService] Failed to stash changes:', error);
    // Don't throw - stashing is best effort
  }
}
```

#### **Step 6.2: Update Terminal Failure Detection**
**File:** `frontend/tauri-app/src/canvas/TextAreaOnCanvas.tsx`

**Enhance process restoration logic:**
```typescript
// MODIFY: Process restoration logic (around lines 212-234)
useEffect(() => {
  const existingProcess = getProcessByElementId(elementId);
  
  if (existingProcess) {
    if (existingProcess.status === 'running') {
      setShowTerminal(true);
      setTerminalId(existingProcess.terminalId);
      
      const restoredAgent = ProcessManager.getProcess(existingProcess.processId);
      if (restoredAgent) {
        console.log(`[TextAreaOnCanvas] Restored agent for element ${elementId}`);
        setClaudeAgent(restoredAgent);
        
        // Check if agent is actually still running
        if (!restoredAgent.isTaskRunning()) {
          console.log(`[TextAreaOnCanvas] Agent exists but not running, marking tasks as failed`);
          handleAgentFailure(existingProcess.processId);
        }
      } else {
        console.log(`[TextAreaOnCanvas] No agent found, marking tasks as failed`);
        handleAgentFailure(existingProcess.processId);
      }
    } else if (existingProcess.status === 'finished' || existingProcess.status === 'completed') {
      removeProcess(existingProcess.processId);
    }
  }
}, [elementId, getProcessByElementId, updateProcess]);

// ADD: Agent failure handler
const handleAgentFailure = async (processId: string) => {
  if (!taskManager) return;
  
  try {
    // Get all tasks associated with this process
    const taskIds = ProcessManager.getProcessTasks(processId);
    const runningTasks = taskManager.getRunningTasks().filter(task => 
      taskIds.includes(task.id)
    );
    
    if (runningTasks.length > 0) {
      // Stash any uncommitted changes
      await GitService.stashChanges(
        textAreaOsSession || { Local: "." },
        `Failed tasks: ${runningTasks.map(t => t.prompt.substring(0, 30)).join(', ')}`
      );
      
      // Mark all running tasks as failed
      runningTasks.forEach(task => {
        completeTask(task.id, ""); // Empty commit hash shows as failed (❌)
      });
    }
    
    // Clean up process
    updateProcess(processId, { status: 'error' });
    ProcessManager.unregisterProcess(processId);
    removeProcess(processId);
    
  } catch (error) {
    console.error('[TextAreaOnCanvas] Error handling agent failure:', error);
  }
};
```

## **Implementation Order**

### **Phase 1: Foundation (1-2 days)**
1. Extend Task types and TaskManager methods
2. Update TextArea class for multi-task support
3. Remove auto-completion from ClaudeCodeAgent

### **Phase 2: Agent Controls (1-2 days)**
4. Add manual control methods to ClaudeCodeAgent
5. Implement escape sequence detection
6. Update agent cleanup logic

### **Phase 3: UI Components (2-3 days)**
7. Create TerminalControls component
8. Create TaskComponent with auto-resize
9. Update TextAreaOnCanvas for multi-task rendering

### **Phase 4: Integration (1-2 days)**
10. Update canvas locking logic
11. Enhance ProcessManager for multi-task tracking
12. Add error handling and git stash

### **Phase 5: Testing & Polish (1-2 days)**
13. End-to-end testing of all features
14. Edge case handling
15. Performance optimization

## **Testing Checklist**

### **Core Functionality**
- [ ] Multiple tasks can be created and started independently
- [ ] Terminal persists across canvas switches and app restarts
- [ ] Task fusion works correctly on manual commit
- [ ] Auto-task creation maintains at least one empty task
- [ ] Escape interruption detects "Interrupted by user" reliably

### **UI/UX**
- [ ] Text areas auto-resize without scrollbars
- [ ] Start/Stop buttons appear appropriately
- [ ] Terminal controls work in all states (hide/maximize/pause/resume/commit)
- [ ] Canvas locking only prevents actions during merging

### **Edge Cases**
- [ ] Agent crash marks all running tasks as failed
- [ ] App restart with orphaned processes handled correctly
- [ ] Git stash works when tasks fail
- [ ] Multiple task prompts fusion into single commit
- [ ] Terminal working directory sync across canvases

### **Performance**
- [ ] No memory leaks from persistent terminals
- [ ] Smooth UI updates with many tasks
- [ ] Efficient event handling in multi-task scenarios

## **Migration Strategy**

### **Backward Compatibility**
- Existing single-task canvases will work with one task
- Existing TaskManager data structures remain compatible
- Terminal persistence mechanisms stay the same
- Canvas switching and project management unchanged

### **Data Migration**
- No database schema changes required
- Task data structures are extended, not replaced
- ProcessManager mappings are additive

This implementation plan maintains the robust architecture while adding comprehensive multi-task support with precise attention to all specified requirements.