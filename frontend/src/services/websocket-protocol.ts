// WebSocket protocol types - mirrors backend protocol.ts

export type ChannelName =
  | 'agent-events'
  | 'agent-summaries'
  | 'agents-list'
  | 'agent-accesses'
  | 'project-collaborators'
  | 'project-issues'
  | 'github-token-health'
  | 'projects-list';

// Client → Server
export interface SubscribeMessage {
  type: 'subscribe';
  channel: ChannelName;
  params: Record<string, any>;
  requestId: string;
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  channel: ChannelName;
  params: Record<string, any>;
}

export interface AuthenticateMessage {
  type: 'authenticate';
  token: string;
}

export interface PongMessage {
  type: 'pong';
  timestamp: number;
}

export interface KeepAliveMessage {
  type: 'keep-alive';
  agentIds: string[];
  requestId?: string;
}

export type ClientMessage =
  | SubscribeMessage
  | UnsubscribeMessage
  | AuthenticateMessage
  | PongMessage
  | KeepAliveMessage;

// Server → Client
export interface SnapshotMessage {
  type: 'snapshot';
  channel: ChannelName;
  params: Record<string, any>;
  requestId: string;
  data: any;
}

export interface DeltaMessage {
  type: 'delta';
  channel: ChannelName;
  params: Record<string, any>;
  data: DeltaUpdate;
}

export interface ErrorMessage {
  type: 'error';
  requestId?: string;
  error: {
    code: string;
    message: string;
  };
}

export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

export interface AuthenticatedMessage {
  type: 'authenticated';
  userId: string;
}

export interface KeepAliveResponseMessage {
  type: 'keep-alive-response';
  requestId?: string;
  results: Record<string, { success: boolean; extended?: boolean; error?: string }>;
}

export type ServerMessage =
  | SnapshotMessage
  | DeltaMessage
  | ErrorMessage
  | PingMessage
  | AuthenticatedMessage
  | KeepAliveResponseMessage;

// Delta operations
export interface DeltaUpdate {
  op: 'add' | 'add-batch' | 'modify' | 'delete' | 'replace';
  version?: number;
  item?: any;
  items?: any[];
  itemId?: string;
  changes?: Record<string, any>;
}
