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
        onClick={() => {
          console.log(`[TerminalControls] R7: Terminal visibility toggle clicked - current: ${isTerminalVisible}, will become: ${!isTerminalVisible}`);
          onToggleVisibility();
        }}
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
            onClick={() => {
              console.log(`[TerminalControls] R7: Terminal maximize toggle clicked - current: ${isTerminalMaximized}, will become: ${!isTerminalMaximized}`);
              onToggleMaximize();
            }}
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
                onClick={() => {
                  if (isAgentPaused) {
                    console.log(`[TerminalControls] R8: Resume button clicked - agent will be resumed and continue execution`);
                    onResume();
                  } else {
                    console.log(`[TerminalControls] R8: Pause button clicked - agent will be paused with escape sequences`);
                    onPause();
                  }
                }}
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
                  onClick={() => {
                    console.log(`[TerminalControls] R10: Commit button clicked - will fuse running tasks and create manual commit`);
                    onCommit();
                  }}
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