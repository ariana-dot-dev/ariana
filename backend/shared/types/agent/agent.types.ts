export enum AgentState {
  PROVISIONING = 'provisioning',
  PROVISIONED = 'provisioned',
  CLONING = 'cloning',
  READY = 'ready',
  IDLE = 'idle',
  RUNNING = 'running',
  ERROR = 'error',
  ARCHIVING = 'archiving',
  ARCHIVED = 'archived'
}

// Queued prompt type
export interface AgentPrompt {
  id: string;
  prompt: string;
  status: 'queued' | 'running' | 'finished';
  createdAt: Date;
}

// Composed types for enriched agents
import type { Agent, User, Project } from '../../../generated/prisma';

// Minimal creator info extracted from User
export interface CreatorInfo {
  id: string;
  name: string;
  image: string | null;
}

// Agent enriched with creator information
export type AgentWithCreator = Agent & {
  creator: CreatorInfo | null;
  hasSnapshot?: boolean;
};

// Agent enriched with project information
export type AgentWithProject = Agent & {
  project: {
    id: string;
    name: string;
  };
};

// Agent enriched with both creator and project information
export type AgentWithCreatorAndProject = Agent & {
  creator: CreatorInfo | null;
  hasSnapshot?: boolean;
  project: {
    id: string;
    name: string;
  };
};




