import { ClaudeService } from "./claudeService";
import type { AutomationWithId } from "./automationService";


export interface AgentGlobalState {
  claudeService: ClaudeService | null;
  projectDir?: string;
  claudeReadyForPrompt: boolean;
  conversationStarted: boolean;
  githubToken?: string;
  githubRepository?: string;
  startCommitSha?: string; // Set once at agent startup, never changes
  branchRenamed: boolean; // Track if we've already renamed the branch
  automations: AutomationWithId[]; // Loaded automations for this agent
  // Generation counter to prevent stale prompt handlers from corrupting state after interrupt.
  // Incremented when a new prompt starts or when interrupt is called.
  // Prompt handlers only update claudeReadyForPrompt if generation matches.
  promptGeneration: number;
  // SHAs of commits currently being renamed via git commit --amend.
  // git-history filters these out so polling never stores the pre-amend SHA.
  pendingRenames: Set<string>;
}

export const globalState: AgentGlobalState = {
  claudeService: null,
  claudeReadyForPrompt: false,
  conversationStarted: false,
  branchRenamed: false,
  automations: [],
  promptGeneration: 0,
  pendingRenames: new Set(),
};