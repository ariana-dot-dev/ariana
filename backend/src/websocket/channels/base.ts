import type { ChannelName, DeltaUpdate } from '../protocol';
import { getSubscriptionKey } from '../protocol';
import type { ServiceContainer } from '@/services';

export interface SubscriptionInfo {
  userId: string;
  params: Record<string, any>;
  requestId: string;
}

export type SendFn = (data: any) => void;

export abstract class BaseChannel {
  abstract channelName: ChannelName;
  protected services: ServiceContainer;

  // Map of subscriptionKey -> Set of { sendFn, userId, params }
  protected subscribers: Map<string, Set<{
    send: SendFn;
    userId: string;
    connectionId: string;
  }>> = new Map();

  constructor(services: ServiceContainer) {
    this.services = services;
    this.setupListeners();
  }

  // Subclasses override to listen for data changes
  protected abstract setupListeners(): void;

  // Called when a client subscribes - return initial snapshot data
  abstract getSnapshot(userId: string, params: Record<string, any>): Promise<any>;

  // Check if user has access to subscribe with these params
  abstract checkAccess(userId: string, params: Record<string, any>): Promise<boolean>;

  subscribe(
    connectionId: string,
    userId: string,
    params: Record<string, any>,
    send: SendFn
  ): void {
    const key = getSubscriptionKey(this.channelName, params);
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    // Remove existing subscription from same connection (if re-subscribing)
    const subs = this.subscribers.get(key)!;
    for (const sub of subs) {
      if (sub.connectionId === connectionId) {
        subs.delete(sub);
        break;
      }
    }
    subs.add({ send, userId, connectionId });
  }

  unsubscribe(connectionId: string, params: Record<string, any>): void {
    const key = getSubscriptionKey(this.channelName, params);
    const subs = this.subscribers.get(key);
    if (subs) {
      for (const sub of subs) {
        if (sub.connectionId === connectionId) {
          subs.delete(sub);
          break;
        }
      }
      if (subs.size === 0) {
        this.subscribers.delete(key);
      }
    }
  }

  // Remove all subscriptions for a connection (on disconnect)
  removeConnection(connectionId: string): void {
    for (const [key, subs] of this.subscribers) {
      for (const sub of subs) {
        if (sub.connectionId === connectionId) {
          subs.delete(sub);
          break;
        }
      }
      if (subs.size === 0) {
        this.subscribers.delete(key);
      }
    }
  }

  // Parse params from a subscription key
  protected parseParamsFromKey(key: string): Record<string, any> | null {
    const colonIdx = key.indexOf(':');
    const paramsStr = key.substring(colonIdx + 1);
    try {
      return JSON.parse(paramsStr);
    } catch {
      return null;
    }
  }

  // Broadcast a delta to all subscribers matching a filter
  protected broadcastDeltaFiltered(
    filter: (userId: string, params: Record<string, any>) => boolean,
    delta: DeltaUpdate
  ): void {
    for (const [key, subs] of this.subscribers) {
      const params = this.parseParamsFromKey(key);
      if (!params) continue;

      for (const sub of subs) {
        if (!filter(sub.userId, params)) continue;

        try {
          sub.send(JSON.stringify({
            type: 'delta',
            channel: this.channelName,
            params,
            data: delta,
          }));
        } catch {
          // Connection might be dead
        }
      }
    }
  }

  // Broadcast a delta to all subscribers of a specific subscription key
  protected broadcastDelta(params: Record<string, any>, delta: DeltaUpdate): void {
    const key = getSubscriptionKey(this.channelName, params);
    const subs = this.subscribers.get(key);
    if (!subs) return;

    const message = JSON.stringify({
      type: 'delta',
      channel: this.channelName,
      params,
      data: delta,
    });

    for (const sub of subs) {
      try {
        sub.send(message);
      } catch (err) {
        // Connection might be dead, will be cleaned up
      }
    }
  }

}
