// Claude-specific configuration and credential types
export interface ContextUsage {
  usedPercent: number;
  remainingPercent: number;
  totalTokens: number;
}

export interface ClaudeStateResponse {
  isReady: boolean;
  hasBlockingAutomation: boolean;
  blockingAutomationIds: string[];
  contextUsage: ContextUsage | null;
}