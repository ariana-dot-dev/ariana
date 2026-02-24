import type { ServerWebSocket } from 'bun';
import type { ServiceContainer } from '@/services';
import type { ClientMessage, ChannelName } from './protocol';
import { BaseChannel } from './channels/base';
import { AgentEventsChannel } from './channels/agent-events';
import { AgentSummariesChannel } from './channels/agent-summaries';
import { AgentsListChannel } from './channels/agents-list';
import { AgentAccessesChannel } from './channels/agent-accesses';
import { ProjectCollaboratorsChannel } from './channels/project-collaborators';
import { ProjectIssuesChannel } from './channels/project-issues';
import { GitHubTokenHealthChannel } from './channels/github-token-health';
import { ProjectsListChannel } from './channels/projects-list';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['websocket']);

export interface WSData {
  connectionId: string;
  userId: string | null;
  authenticated: boolean;
  lastPong: number;
}

export class WebSocketManager {
  private services: ServiceContainer;
  private channels: Map<ChannelName, BaseChannel> = new Map();
  private connections: Map<string, ServerWebSocket<WSData>> = new Map();
  private connectionCounter = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  constructor(services: ServiceContainer) {
    this.services = services;

    // Initialize all channels
    this.channels.set('agent-events', new AgentEventsChannel(services));
    this.channels.set('agent-summaries', new AgentSummariesChannel(services));
    this.channels.set('agents-list', new AgentsListChannel(services));
    this.channels.set('agent-accesses', new AgentAccessesChannel(services));
    this.channels.set('project-collaborators', new ProjectCollaboratorsChannel(services));
    this.channels.set('project-issues', new ProjectIssuesChannel(services));
    this.channels.set('github-token-health', new GitHubTokenHealthChannel(services));
    this.channels.set('projects-list', new ProjectsListChannel(services));

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeats();
    }, 30000);

    logger.info`WebSocket manager initialized with ${this.channels.size} channels`;
  }

  generateConnectionId(): string {
    return `ws-${++this.connectionCounter}-${Date.now()}`;
  }

  onOpen(ws: ServerWebSocket<WSData>): void {
    const { connectionId } = ws.data;
    this.connections.set(connectionId, ws);
    ws.data.lastPong = Date.now();
    logger.debug`WebSocket connection opened: ${connectionId}`;
  }

  async onMessage(ws: ServerWebSocket<WSData>, rawMessage: string | Buffer): Promise<void> {
    const { connectionId } = ws.data;
    let message: ClientMessage;

    try {
      message = JSON.parse(typeof rawMessage === 'string' ? rawMessage : rawMessage.toString());
    } catch {
      this.sendError(ws, undefined, 'INVALID_MESSAGE', 'Failed to parse message');
      return;
    }

    try {
      switch (message.type) {
        case 'authenticate':
          await this.handleAuthenticate(ws, message.token);
          break;

        case 'subscribe':
          await this.handleSubscribe(ws, message.channel, message.params, message.requestId);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(ws, message.channel, message.params);
          break;

        case 'request':
          await this.handleRequest(ws, message.channel, message.params, message.requestId);
          break;

        case 'pong':
          ws.data.lastPong = Date.now();
          break;

        case 'keep-alive':
          await this.handleKeepAlive(ws, message.agentIds, message.requestId);
          break;

        default:
          this.sendError(ws, undefined, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${(message as any).type}`);
      }
    } catch (err) {
      const requestId = 'requestId' in message ? (message as any).requestId : undefined;
      logger.error`WebSocket message handler error for ${connectionId}: ${err}`;
      this.sendError(ws, requestId, 'INTERNAL_ERROR', err instanceof Error ? err.message : 'Internal error');
    }
  }

  onClose(ws: ServerWebSocket<WSData>): void {
    const { connectionId } = ws.data;
    this.connections.delete(connectionId);

    // Remove from all channels
    for (const channel of this.channels.values()) {
      channel.removeConnection(connectionId);
    }

    logger.debug`WebSocket connection closed: ${connectionId}`;
  }

  onError(ws: ServerWebSocket<WSData>, error: Error): void {
    logger.error`WebSocket error for ${ws.data.connectionId}: ${error}`;
  }

  private async handleAuthenticate(ws: ServerWebSocket<WSData>, token: string): Promise<void> {
    try {
      const result = await this.services.auth.validateJwtToken(token);
      if (!result) {
        this.sendError(ws, undefined, 'AUTHENTICATION_FAILED', 'Invalid or expired token');
        return;
      }

      ws.data.userId = result.jwt.sub;
      ws.data.authenticated = true;

      ws.send(JSON.stringify({
        type: 'authenticated',
        userId: result.jwt.sub,
      }));

      logger.debug`WebSocket authenticated: ${ws.data.connectionId} as user ${result.jwt.sub}`;
    } catch (err) {
      this.sendError(ws, undefined, 'AUTHENTICATION_FAILED', 'Token validation failed');
    }
  }

  private async handleSubscribe(
    ws: ServerWebSocket<WSData>,
    channelName: ChannelName,
    params: Record<string, any>,
    requestId: string
  ): Promise<void> {
    const t0 = performance.now();

    if (!ws.data.authenticated || !ws.data.userId) {
      this.sendError(ws, requestId, 'UNAUTHENTICATED', 'Must authenticate before subscribing');
      return;
    }

    const channel = this.channels.get(channelName);
    if (!channel) {
      this.sendError(ws, requestId, 'UNKNOWN_CHANNEL', `Unknown channel: ${channelName}`);
      return;
    }

    const tAccess0 = performance.now();
    const hasAccess = await channel.checkAccess(ws.data.userId, params);
    const tAccess = performance.now() - tAccess0;

    if (!hasAccess) {
      this.sendError(ws, requestId, 'UNAUTHORIZED', `No access to ${channelName}`);
      return;
    }

    // Register subscription
    const sendFn = (data: string) => {
      try {
        if (ws.readyState === 1) { // OPEN
          ws.send(data);
        }
      } catch {
        // Connection dead
      }
    };

    channel.subscribe(ws.data.connectionId, ws.data.userId, params, sendFn);

    // Get and send initial snapshot
    try {
      const tSnap0 = performance.now();
      const snapshot = await channel.getSnapshot(ws.data.userId, params);
      const tSnap = performance.now() - tSnap0;

      const payload = JSON.stringify({
        type: 'snapshot',
        channel: channelName,
        params,
        requestId,
        data: snapshot,
      });

      ws.send(payload);

      const tTotal = performance.now() - t0;
      const itemCount = Array.isArray(snapshot?.events) ? snapshot.events.length : 0;
      logger.info`[Perf] handleSubscribe channel=${channelName} conn=${ws.data.connectionId.slice(0, 12)} access=${tAccess.toFixed(0)}ms snapshot=${tSnap.toFixed(0)}ms payloadBytes=${payload.length} items=${itemCount} total=${tTotal.toFixed(0)}ms`;
    } catch (err) {
      logger.error`Failed to get snapshot for ${channelName}: ${err}`;
      this.sendError(ws, requestId, 'SNAPSHOT_FAILED', `Failed to load initial data for ${channelName}`);
    }
  }

  private handleUnsubscribe(
    ws: ServerWebSocket<WSData>,
    channelName: ChannelName,
    params: Record<string, any>
  ): void {
    const channel = this.channels.get(channelName);
    if (!channel) return;

    channel.unsubscribe(ws.data.connectionId, params);
  }

  private async handleRequest(
    ws: ServerWebSocket<WSData>,
    channelName: ChannelName,
    params: Record<string, any>,
    requestId: string
  ): Promise<void> {
    if (!ws.data.authenticated || !ws.data.userId) {
      this.sendError(ws, requestId, 'UNAUTHENTICATED', 'Must authenticate first');
      return;
    }

    const channel = this.channels.get(channelName);
    if (!channel) {
      this.sendError(ws, requestId, 'UNKNOWN_CHANNEL', `Unknown channel: ${channelName}`);
      return;
    }

    const hasAccess = await channel.checkAccess(ws.data.userId, params);
    if (!hasAccess) {
      this.sendError(ws, requestId, 'UNAUTHORIZED', `No access to ${channelName}`);
      return;
    }

    try {
      const data = await channel.getSnapshot(ws.data.userId, params);
      ws.send(JSON.stringify({
        type: 'snapshot',
        channel: channelName,
        params,
        requestId,
        data,
      }));
    } catch (err) {
      this.sendError(ws, requestId, 'REQUEST_FAILED', err instanceof Error ? err.message : 'Request failed');
    }
  }

  private async handleKeepAlive(
    ws: ServerWebSocket<WSData>,
    agentIds: string[],
    requestId?: string
  ): Promise<void> {
    if (!ws.data.authenticated || !ws.data.userId) {
      this.sendError(ws, requestId, 'UNAUTHENTICATED', 'Must authenticate first');
      return;
    }

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      return;
    }

    // Limit to 100 agents per request
    const limitedIds = agentIds.slice(0, 100);
    const results: Record<string, { success: boolean; extended?: boolean; error?: string }> = {};

    for (const agentId of limitedIds) {
      try {
        const hasAccess = await this.services.userAgentAccesses.hasWriteAccess(ws.data.userId, agentId);
        if (!hasAccess) {
          results[agentId] = { success: false, error: 'No write access' };
          continue;
        }

        const agent = await this.services.agents.getAgent(agentId);
        if (!agent) {
          results[agentId] = { success: false, error: 'Agent not found' };
          continue;
        }

        const extended = await this.services.agents.autoExtendIfNearExpiration(agent);
        results[agentId] = { success: true, extended };
      } catch (err) {
        results[agentId] = { success: false, error: 'Keep-alive failed' };
      }
    }

    ws.send(JSON.stringify({
      type: 'keep-alive-response',
      requestId,
      results,
    }));
  }

  private sendError(
    ws: ServerWebSocket<WSData>,
    requestId: string | undefined,
    code: string,
    message: string
  ): void {
    try {
      ws.send(JSON.stringify({
        type: 'error',
        requestId,
        error: { code, message },
      }));
    } catch {
      // Connection dead
    }
  }

  private sendHeartbeats(): void {
    const now = Date.now();
    const pingMessage = JSON.stringify({ type: 'ping', timestamp: now });

    for (const [connectionId, ws] of this.connections) {
      try {
        // Check if connection hasn't responded to pings (dead connection)
        if (now - ws.data.lastPong > 90000) { // 90s without pong
          logger.debug`Closing dead WebSocket connection: ${connectionId}`;
          ws.close(1000, 'Heartbeat timeout');
          continue;
        }

        if (ws.readyState === 1) { // OPEN
          ws.send(pingMessage);
        }
      } catch {
        // Connection dead, will be cleaned up
      }
    }
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    for (const ws of this.connections.values()) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch {
        // Ignore
      }
    }
    this.connections.clear();
  }
}

// Singleton instance - initialized in index.ts
let wsManager: WebSocketManager | null = null;

export function initWebSocketManager(services: ServiceContainer): WebSocketManager {
  wsManager = new WebSocketManager(services);
  return wsManager;
}

export function getWebSocketManager(): WebSocketManager | null {
  return wsManager;
}
