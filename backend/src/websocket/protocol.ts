// WebSocket protocol types shared between client and server

// ── Client → Server Messages ──────────────────────────────────────────

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
  requestId?: string;
}

export interface RequestMessage {
  type: 'request';
  channel: ChannelName;
  params: Record<string, any>;
  requestId: string;
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
  | RequestMessage
  | AuthenticateMessage
  | PongMessage
  | KeepAliveMessage;

// ── Server → Client Messages ──────────────────────────────────────────

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

// ── Delta Operations ──────────────────────────────────────────────────

export interface DeltaUpdate {
  op: 'add' | 'add-batch' | 'modify' | 'delete' | 'replace';
  version?: number;
  item?: any;
  items?: any[];
  itemId?: string;
  changes?: Record<string, any>;
}

// ── Channel Names ─────────────────────────────────────────────────────

export type ChannelName =
  | 'agent-events'
  | 'agent-summaries'
  | 'agents-list'
  | 'agent-accesses'
  | 'project-collaborators'
  | 'project-issues'
  | 'github-token-health'
  | 'projects-list';

// ── Subscription Key ──────────────────────────────────────────────────

export function getSubscriptionKey(channel: string, params: Record<string, any>): string {
  // Create a stable key from channel + relevant params
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {} as Record<string, any>);
  return `${channel}:${JSON.stringify(sortedParams)}`;
}
