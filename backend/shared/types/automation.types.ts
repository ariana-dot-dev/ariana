// Automation trigger types
export type AutomationTriggerType =
  | 'manual'
  | 'on_agent_ready'
  | 'on_before_commit'
  | 'on_after_commit'
  | 'on_after_edit_files'
  | 'on_after_read_files'
  | 'on_after_run_command'
  | 'on_before_push_pr'
  | 'on_after_push_pr'
  | 'on_after_reset'
  | 'on_automation_finishes';

export interface AutomationTrigger {
  type: AutomationTriggerType;
  // Optional filters for specific triggers
  fileGlob?: string;        // For on_after_edit_files, on_after_read_files
  commandRegex?: string;    // For on_after_run_command
  automationId?: string;    // For on_automation_finishes
}

// Script languages
export type AutomationScriptLanguage = 'bash' | 'javascript' | 'python';

// Automation configuration (stored in data field as JSON)
export interface AutomationConfig {
  name: string;                          // User-friendly name (unique per user+project)
  trigger: AutomationTrigger;
  scriptLanguage: AutomationScriptLanguage;
  scriptContent: string;                 // The actual script code
  blocking: boolean;                     // Whether to block agent until automation finishes
  feedOutput: boolean;                   // Whether to feed stdout/stderr to agent context
}

// Automation with parsed data
export interface AutomationWithData {
  id: string;
  projectId: string;
  userId: string;
  data: string;                          // JSON string
  createdAt: Date | null;
  updatedAt: Date | null;
  parsedData: AutomationConfig;          // Parsed from data field
}

// Variables available to automation scripts
export interface AutomationVariables {
  inputFilePath?: string;                // For file-related triggers
  inputCommand?: string;                 // For command-related triggers
  currentCommitSha?: string;
  currentCommitChanges?: string;         // Git diff of current commit
  currentPendingChanges?: string;        // Git diff of uncommitted changes
  entireAgentDiff?: string;              // Total diff since agent started
  lastPrompt?: string;                   // Last prompt text
  allLastPrompts?: string[];             // Array of recent prompts
  githubToken?: string;                  // If available
  conversationTranscript?: Array<{       // Full conversation
    role: 'user' | 'assistant';
    content: string;
  }>;
  lastScriptOutput?: string;             // For on_automation_finishes
  // Functions exposed to scripts (these would be bound in the execution environment)
  stopAgent?: () => void;
  queuePrompt?: (prompt: string) => void;
}

// Trigger data stored when automation executes
export interface AutomationTriggerData {
  triggerType: AutomationTriggerType;
  timestamp: number;
  variables: Partial<AutomationVariables>;
}

// Automation event status
export type AutomationEventStatus = 'running' | 'finished' | 'failed' | 'killed';
