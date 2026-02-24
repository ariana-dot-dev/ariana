// Main export file for all shared types

// Auth types
export * from './auth/jwt.types';
export * from './auth/github.types';
export * from './auth/github-access.types';

// Project types - keep enums and helper types
export { ProjectRole } from './project/project.types';
export * from './project/project.types'; // for ProjectAPI namespace

// Agent types - keep enums and helper types
export * from './agent/agent.types'; // for AgentState enum, AgentPrompt, and enriched agent types
export * from './agent/message.types'; // for ToolResult and helper types
export * from '../../agents-server/src/types/tool-result-formats'; // for structured tool result formats
export * from './agent/commit.types'; // for GitCheckpoint and helper functions
export * from './agent/claude.types';
export * from './agent/mention.types';
export * from './agent/machine.types';
export * from './agent/diff.types';
export * from './agent/agentProviderConfig.types';

// API types
export * from './api/request-response.types';
export * from './api/chat-event.types';

// Installation types
export * from './installation.types';

// PRISMA TYPES - Primary source of truth for all database entities
export type {
  User,
  Agent,
  Project,
  ProjectMember,
  Repository,
  GitHubProfile,
  AgentMessage,
  AgentCommit,
  AgentPrompt,
  GitHubCache,
  GitHubToken,
  PersonalEnvironment
} from '../../generated/prisma';
