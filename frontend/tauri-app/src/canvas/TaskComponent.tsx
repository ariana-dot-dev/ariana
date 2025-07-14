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
      const oldHeight = textareaRef.current.style.height;
      textareaRef.current.style.height = 'auto';
      const newHeight = Math.max(24, textareaRef.current.scrollHeight) + 'px';
      textareaRef.current.style.height = newHeight;
      
      if (oldHeight !== newHeight) {
        console.log(`[TaskComponent] R3: Auto-resized textarea for task ${task.id} - height: ${oldHeight} -> ${newHeight} (no scrollbar)`);
      }
    }
  }, [localPrompt, task.status]);

  // Update local prompt when task prompt changes
  useEffect(() => {
    if (task.status === 'prompting') {
      setLocalPrompt(task.prompt);
    }
  }, [task.prompt, task.status]);

  const handlePromptChange = (value: string) => {
    console.log(`[TaskComponent] R3: Prompt changed for task ${task.id} - length: ${value.length}, auto-resizing textarea`);
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
    if (task.status === 'running') return '🔄';
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
      case 'running':
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
            "overflow-hidden", // No scrollbar - auto-resize instead
            getTaskStatusColor(),
            !isEditable && "cursor-default",
            !canEdit && "opacity-60",
            "whitespace-pre-wrap break-words overflow-wrap-anywhere"
          )}
          style={{ minHeight: '24px', height: '24px' }}
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
              onClick={() => {
                console.log(`[TaskComponent] R4: Start button clicked for task ${task.id} - launching terminal or queuing in existing`);
                onStart();
              }}
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
              onClick={() => {
                console.log(`[TaskComponent] R12: Stop/Commit/Start button clicked for task ${task.id} - will interrupt, commit running tasks, then start this one`);
                onStopCommitStart();
              }}
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