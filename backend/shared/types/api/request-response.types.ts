// API request and response types for all endpoints
import type { Mention } from '../agent/mention.types';
import type { AgentWithCreator, AgentWithCreatorAndProject } from '../agent/agent.types';
import type { ChatEvent } from './chat-event.types';

// Generic API response wrapper
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Auth endpoints
export namespace AuthAPI {
  export interface SignInResponse {
    url: string;
    message: string;
  }
  
  export interface SessionResponse {
    user: {
      id: string;
      name?: string;
      email?: string;
      image?: string;
    } | null;
    authenticated: boolean;
    jwt?: {
      issuedAt: string;
      expiresAt: string;
    };
    error?: string;
  }
  
  export interface RefreshResponse {
    refreshed: boolean;
    token?: string;
    message: string;
  }
}

// Agent endpoints
export namespace AgentAPI {
  export interface CreateRequest {
    // projectId comes from URL path /api/projects/{id}/agents
    baseBranch?: string;  // Required for repository-linked projects
    localCodeZip?: string;  // Base64 encoded zip, required for local projects
    machineType?: 'hetzner' | 'custom';  // Machine source type
    customMachineId?: string | null;  // Required when machineType is 'custom'
  }

  export interface CreateResponse {
    success: boolean;
    agent?: AgentWithCreator;
    error?: string;
    code?: 'MACHINE_POOL_EXHAUSTED' | 'LIMIT_EXCEEDED' | 'VISITOR_ROLE_RESTRICTION';
    details?: {
      currentMachines?: number;
      maxMachines?: number;
    };
  }

  export interface GetAgentsResponse {
    success: boolean;
    agents: AgentWithCreator[] | AgentWithCreatorAndProject[];
  }
  
  export interface SendPromptRequest {
    prompt: string;
    mentions?: Mention[];
    model?: 'opus' | 'sonnet' | 'haiku';
  }
  
  export interface RevertRequest {
    commitSha: string;
  }

  export interface PushCommitsResponse {
    success: boolean;
    pushedCount?: number;
    prUrl?: string;
    branchName?: string;
    error?: string;
    message?: string;
  }
  
  export interface OutputResponse {
    success: boolean;
    output: string[];
  }

  
  export interface EventsResponse {
    success: boolean;
    events?: ChatEvent[];
    eventsVersion?: number;
    unchanged?: true;
    hasMore?: boolean;
    oldestTimestamp?: number;
  }
  
}
