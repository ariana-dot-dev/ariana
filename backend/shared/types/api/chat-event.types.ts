import type { ToolResult, ToolUse } from "../agent/message.types";

// Base event interface
interface BaseEvent {
  id: string;
  timestamp: number;
}

// Prompt event
export interface PromptEvent extends BaseEvent {
  type: 'prompt';
  taskId: string | null;
  data: {
    prompt: string;
    status: 'sending' | 'queued' | 'running' | 'finished' | 'failed';
    is_reverted: boolean;
  };
}

// Response event - can contain multiple tools
export interface ResponseEvent extends BaseEvent {
  type: 'response';
  taskId: string | null;  // NULL for initial hello response
  data: {
    content: string;
    model: string | null;
    tools?: Array<{
      use: ToolUse;
      result?: ToolResult;
    }>;
    is_reverted: boolean;
    is_streaming?: boolean;
  };
}

// Git checkpoint event
export interface GitCheckpointEvent extends BaseEvent {
  type: 'git_checkpoint';
  taskId: string | null;  // NULL for base commit from main branch
  data: {
    commitSha: string;
    commitMessage: string;
    commitUrl: string | null;  // NULL until pushed to GitHub
    branch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    timestamp: number;
    pushed: boolean;
    is_reverted: boolean;
  };
}

// Reset event
export interface ResetEvent extends BaseEvent {
  type: 'reset';
  taskId: string | null;
  data: Record<string, never>;  // Empty data object
}

// Automation event
export interface AutomationEvent extends BaseEvent {
  type: 'automation';
  taskId: string | null;
  data: {
    automationId: string;
    automationName: string;
    trigger: string;               // JSON string with trigger info
    output: string | null;         // stdout/stderr combined
    isStartTruncated: boolean;
    status: 'running' | 'finished' | 'failed' | 'killed';
    exitCode: number | null;
    startedAt: number | null;
    finishedAt: number | null;
    blocking: boolean;             // Whether this is a blocking automation
    feedOutput: boolean;           // Whether output should be fed to agent
  };
}

// Automation output added to context event (synthetic, not in DB)
export interface AutomationOutputAddedEvent extends BaseEvent {
  type: 'automation_output_added';
  taskId: string | null;
  data: {
    automationId: string;
    automationName: string;
  };
}

// Context warning event - shown at 10% thresholds
export interface ContextWarningEvent extends BaseEvent {
  type: 'context_warning';
  taskId: string | null;
  data: {
    contextUsedPercent: number;
    contextRemainingPercent: number;
    inputTokens: number;
    cacheTokens: number;
    contextWindow: number;
  };
}

// Compaction start event
export interface CompactionStartEvent extends BaseEvent {
  type: 'compaction_start';
  taskId: string | null;
  data: {
    triggerReason: 'threshold_exceeded' | 'manual';
    contextUsedPercent: number;
  };
}

// Compaction complete event
// Note: tokensAfter and tokensSaved are only available if the SDK provides them
// The SDK's compact_boundary message only provides pre_tokens, not post-compaction info
export interface CompactionCompleteEvent extends BaseEvent {
  type: 'compaction_complete';
  taskId: string | null;
  data: {
    summary: string;
    tokensBefore: number;
    tokensAfter: number | null;   // null if SDK doesn't provide post-compaction tokens
    tokensSaved: number | null;   // null if SDK doesn't provide post-compaction tokens
  };
}

// Discriminated union of all event types
export type ChatEvent = PromptEvent | ResponseEvent | GitCheckpointEvent | ResetEvent | AutomationEvent | AutomationOutputAddedEvent | ContextWarningEvent | CompactionStartEvent | CompactionCompleteEvent;

// Type guards
export function isPromptEvent(event: ChatEvent): event is PromptEvent {
  return event.type === 'prompt';
}

export function isResponseEvent(event: ChatEvent): event is ResponseEvent {
  return event.type === 'response';
}

export function isGitCheckpointEvent(event: ChatEvent): event is GitCheckpointEvent {
  return event.type === 'git_checkpoint';
}

export function isResetEvent(event: ChatEvent): event is ResetEvent {
  return event.type === 'reset';
}

export function isAutomationEvent(event: ChatEvent): event is AutomationEvent {
  return event.type === 'automation';
}

export function isAutomationOutputAddedEvent(event: ChatEvent): event is AutomationOutputAddedEvent {
  return event.type === 'automation_output_added';
}

export function isContextWarningEvent(event: ChatEvent): event is ContextWarningEvent {
  return event.type === 'context_warning';
}

export function isCompactionStartEvent(event: ChatEvent): event is CompactionStartEvent {
  return event.type === 'compaction_start';
}

export function isCompactionCompleteEvent(event: ChatEvent): event is CompactionCompleteEvent {
  return event.type === 'compaction_complete';
}