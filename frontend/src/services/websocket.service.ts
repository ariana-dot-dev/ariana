import type {
  ChannelName,
  ServerMessage,
  SnapshotMessage,
  KeepAliveResponseMessage,
} from './websocket-protocol';
import { useAppStore } from '@/stores/useAppStore';

type MessageHandler = (message: ServerMessage) => void;

interface SubscriptionState {
  channel: ChannelName;
  params: Record<string, any>;
  requestId: string;
  active: boolean;
}

function getSubscriptionKey(channel: string, params: Record<string, any>): string {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {} as Record<string, any>);
  return `${channel}:${JSON.stringify(sortedParams)}`;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private token: string | null = null;
  private reconnectAttempts = 0;
  private baseReconnectDelay = 1000;
  private maxReconnectDelay = 60000;
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private subscriptions: Map<string, SubscriptionState> = new Map();
  private pendingRequests: Map<string, {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
  }> = new Map();
  private requestIdCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  // Perf: track subscribe timestamps to measure subscribe→snapshot latency
  private subscribeTimestamps: Map<string, number> = new Map();

  // Connection state
  private _connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private stateListeners: Set<(state: 'disconnected' | 'connecting' | 'connected') => void> = new Set();

  private wsLog(action: string, detail?: string): void {
    const ts = new Date().toISOString().slice(11, 23);
    const subs = this.subscriptions.size;
    const extra = detail ? ` | ${detail}` : '';
    console.log(`[WS ${ts}] ${action} (subs=${subs})${extra}`);
  }

  constructor() {
    this.setupBrowserListeners();
  }

  private setupBrowserListeners(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this._connectionState === 'disconnected' && !this.intentionallyClosed) {
          this.wsLog('TAB_VISIBLE', 'triggering reconnect');
          this.reconnectAttempts = 0;
          this.attemptReconnect();
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this._connectionState === 'disconnected' && !this.intentionallyClosed) {
          this.wsLog('ONLINE', 'triggering reconnect');
          this.reconnectAttempts = 0;
          this.attemptReconnect();
        }
      });

      window.addEventListener('offline', () => {
        this.wsLog('OFFLINE', 'pausing reconnect');
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      });
    }
  }

  private getWebSocketUrl(): string {
    // Derive WebSocket URL from API_URL
    const apiUrl = import.meta.env.VITE_API_URL || 'https://ariana.dev';
    const url = new URL(apiUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws`;
  }

  get connectionState() {
    return this._connectionState;
  }

  connect(token: string): void {
    if (this._connectionState === 'connected' || this._connectionState === 'connecting') {
      if (this.token === token) return;
      this.wsLog('RECONNECT', 'token changed');
      this.disconnect();
    }

    this.token = token;
    this.intentionallyClosed = false;
    this.wsLog('CONNECT', 'initiating');
    this.doConnect();
  }

  private doConnect(): void {
    if (!this.token) return;

    this._connectionState = 'connecting';
    this.notifyStateChange();

    try {
      const wsUrl = this.getWebSocketUrl();
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.wsLog('OPEN', 'authenticating...');
        this.send({
          type: 'authenticate',
          token: this.token!,
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (_err) {
          // Silently ignore parse errors
        }
      };

      this.ws.onclose = (event) => {
        const reason = this.intentionallyClosed ? 'intentional' : `code=${event.code}`;
        this.wsLog('CLOSED', reason);
        this._connectionState = 'disconnected';
        this.notifyStateChange();

        if (!this.intentionallyClosed) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = () => {
        // Error details are logged via onclose; no need to spam here
      };
    } catch (_err) {
      this.wsLog('CONNECT_FAILED', 'will retry');
      this._connectionState = 'disconnected';
      this.notifyStateChange();
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (this.intentionallyClosed) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const baseDelay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    const jitter = baseDelay * (0.75 + Math.random() * 0.5);
    const delay = Math.round(jitter);

    this.wsLog('RECONNECTING', `in ${delay}ms (attempt #${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.token && !this.intentionallyClosed) {
        this.doConnect();
      }
    }, delay);
  }

  subscribe(
    channel: ChannelName,
    params: Record<string, any>,
    handler: MessageHandler
  ): () => void {
    const key = getSubscriptionKey(channel, params);

    // Add handler
    if (!this.messageHandlers.has(key)) {
      this.messageHandlers.set(key, new Set());
    }
    this.messageHandlers.get(key)!.add(handler);

    if (!this.subscriptions.has(key)) {
      const requestId = this.generateRequestId();

      this.subscriptions.set(key, {
        channel,
        params,
        requestId,
        active: true,
      });

      this.wsLog('SUB', channel);
      this.subscribeTimestamps.set(key, performance.now());

      if (this._connectionState === 'connected') {
        this.send({
          type: 'subscribe',
          channel,
          params,
          requestId,
        });
      }
    }

    return () => {
      this.messageHandlers.get(key)?.delete(handler);

      if (this.messageHandlers.get(key)?.size === 0) {
        this.wsLog('UNSUB', channel);
        this.unsubscribe(channel, params);
      }
    };
  }

  private unsubscribe(channel: ChannelName, params: Record<string, any>): void {
    const key = getSubscriptionKey(channel, params);

    this.subscriptions.delete(key);
    this.messageHandlers.delete(key);
    this.subscribeTimestamps.delete(key);

    if (this._connectionState === 'connected') {
      this.send({
        type: 'unsubscribe',
        channel,
        params,
      });
    }
  }

  sendKeepAlive(agentIds: string[]): void {
    if (this._connectionState !== 'connected' || agentIds.length === 0) return;

    this.send({
      type: 'keep-alive',
      agentIds,
      requestId: this.generateRequestId(),
    });
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'authenticated': {
        this._connectionState = 'connected';
        this.reconnectAttempts = 0;
        this.notifyStateChange();
        this.wsLog('AUTHENTICATED', 'resuming subscriptions');
        this.resumeSubscriptions();
        break;
      }

      case 'snapshot': {
        const snapshotMsg = message as SnapshotMessage;
        const key = getSubscriptionKey(snapshotMsg.channel, snapshotMsg.params);

        // Perf: measure subscribe→snapshot latency
        const subTs = this.subscribeTimestamps.get(key);
        if (subTs) {
          const latency = performance.now() - subTs;
          this.subscribeTimestamps.delete(key);
          const itemCount = Array.isArray(snapshotMsg.data?.events)
            ? snapshotMsg.data.events.length
            : (snapshotMsg.data ? 1 : 0);
          this.wsLog('SNAPSHOT', `${snapshotMsg.channel} latency=${latency.toFixed(0)}ms items=${itemCount}`);
        }

        const handlers = this.messageHandlers.get(key);
        if (handlers) {
          handlers.forEach(handler => handler(message));
        }
        break;
      }

      case 'delta': {
        const deltaMsg = message;
        const key = getSubscriptionKey(deltaMsg.channel, deltaMsg.params);
        const handlers = this.messageHandlers.get(key);

        if (handlers) {
          const t0 = performance.now();
          handlers.forEach(handler => handler(message));
          const dur = performance.now() - t0;
          if (dur > 5) {
            this.wsLog('DELTA_SLOW', `${deltaMsg.channel} op=${deltaMsg.data?.op} handleTime=${dur.toFixed(1)}ms`);
          }
        }
        break;
      }

      case 'error': {
        if (message.error.code === 'AUTHENTICATION_FAILED') {
          this.wsLog('AUTH_FAILED', 'will not retry');
          this.intentionallyClosed = true;
          this.ws?.close();
          return;
        }
        this.wsLog('SERVER_ERROR', message.error?.code || 'unknown');
        break;
      }

      case 'ping': {
        this.send({ type: 'pong', timestamp: message.timestamp });
        break;
      }

      case 'keep-alive-response': {
        const kaMsg = message as KeepAliveResponseMessage;
        if (kaMsg.results) {
          const failed = Object.entries(kaMsg.results).filter(([, r]) => !r.success);
          if (failed.length > 0) {
            this.wsLog('KEEPALIVE_FAIL', failed.map(([id]) => id.slice(0, 8)).join(', '));
          }
        }
        break;
      }
    }
  }

  private resumeSubscriptions(): void {
    const channels = [];
    for (const [key, sub] of this.subscriptions.entries()) {
      const freshRequestId = this.generateRequestId();
      sub.requestId = freshRequestId;
      channels.push(sub.channel);
      // Perf: track resumed subscriptions too
      this.subscribeTimestamps.set(key, performance.now());
      this.send({
        type: 'subscribe',
        channel: sub.channel,
        params: sub.params,
        requestId: freshRequestId,
      });
    }
    if (channels.length > 0) {
      this.wsLog('RESUMED', channels.join(', '));
    }
  }

  private send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private generateRequestId(): string {
    return `req-${++this.requestIdCounter}-${Date.now()}`;
  }

  private notifyStateChange(): void {
    this.stateListeners.forEach(listener => {
      listener(this._connectionState);
    });
  }

  onStateChange(listener: (state: 'disconnected' | 'connecting' | 'connected') => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  forceReconnect(): void {
    this.wsLog('FORCE_RECONNECT');
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.reconnectAttempts = 0;
    this.intentionallyClosed = false;
    this._connectionState = 'disconnected';
    this.notifyStateChange();
    this.doConnect();
  }

  disconnect(): void {
    this.wsLog('DISCONNECT', 'intentional');
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connectionState = 'disconnected';
    this.notifyStateChange();
  }
}

export const wsService = new WebSocketService();
