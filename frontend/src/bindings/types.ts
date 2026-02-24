// Export only the types that frontend actually needs
export type {
  // Prisma database types
  User as BackendUser,
  Agent,
  Repository,
  Project,

  // API types
  AgentAPI,
  ProjectAPI,

  // Event and tool types
  ChatEvent,
  PromptEvent,
  ToolResult,
  ToolUse,

  // Tool result format types
  FileContentResult,
  FileEditResult,
  FileWriteResult,
  BashOutputResult,
  GrepResult,
  GlobResult,
  WebSearchResult,
  WebFetchResult,
  TodoWriteResult,
  TaskResult,
  GenericToolResult,

  // Machine types
  MachineType,
  MachineSource,
  MachineConfig,
  MachineSpec,

  // GitHub access types
  AccessLevel,
  CheckAccessResult,

  // Installation types
  InstallationRepository,
  Installation,
  InstallationsResponse,

  // Enriched agent types
  CreatorInfo,
  AgentWithCreator,
  AgentWithProject,
  AgentWithCreatorAndProject,
} from '../../../backend/shared/types';

// Export enums that are used as values
export { AgentState, ProjectRole, InstallationType } from '../../../backend/shared/types';

// Export machine specs as a value
export { MACHINE_SPECS } from '../../../backend/shared/types';

// Frontend User type with optional GitHub profile data
export interface User {
  id: string;
  githubProfileId: string | null;
  creationMachinePublicSshKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  isAnonymous?: boolean;
  // Optional GitHub profile data (populated when linked)
  name?: string;
  email?: string;
  image?: string | null;
}

// BackendUser is already exported above


// AgentState is exported directly above - use that instead of AllAgentStates

export interface AuthState {
  user: User | null;
  sessionToken: string | null;
  isAuthenticated: boolean;
  lastSync: string | null;
}