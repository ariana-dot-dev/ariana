import { EventEmitter } from 'events';

// Global event bus for broadcasting data changes to WebSocket connections
// Used by API handlers / services to notify when data is mutated
//
// emitEvent() sends via PostgreSQL NOTIFY so all workers receive the event.
// onEvent() registers a local listener that fires when any worker emits.
// The PgPubSub layer (pg-pubsub.ts) bridges PG notifications to local dispatch.

export interface EventBusEvents {
  // Agent events
  'agent:events:changed': {
    agentId: string;
    addedMessageIds?: string[];
    modifiedMessageIds?: string[];
    addedCommitIds?: string[];
    modifiedCommitIds?: string[];
    addedResetIds?: string[];
    addedAutomationEventIds?: string[];
    modifiedAutomationEventIds?: string[];
    addedContextEventIds?: string[];
    addedPromptIds?: string[];
    modifiedPromptIds?: string[];
    // When none of the ID fields are set, it's a full refresh (bulk ops like reverts)
  };
  'agent:summary:changed': { agentId: string };
  'agent:created': { userId: string; agentId: string };
  'agent:updated': { agentId: string };
  'agent:deleted': { agentId: string; userId: string };

  // Agent accesses
  'agent:accesses:changed': { userId: string };

  // Project events
  'project:created': { userId: string; projectId: string };
  'project:updated': { projectId: string };
  'project:deleted': { projectId: string; userId: string };

  // Collaborator events
  'project:collaborators:changed': { projectId: string };

  // GitHub issues
  'project:issues:changed': { projectId: string };

  // Token health
  'github:token-health:changed': { userId: string };
}

class EventBus extends EventEmitter {
  private pgNotify: (<K extends keyof EventBusEvents>(event: K, data: EventBusEvents[K]) => Promise<void>) | null = null;

  /**
   * Set the PG notify function. Called once at startup after PgPubSub is initialized.
   */
  setPgNotify(fn: <K extends keyof EventBusEvents>(event: K, data: EventBusEvents[K]) => Promise<void>): void {
    this.pgNotify = fn;
  }

  /**
   * Emit an event across all workers via PostgreSQL NOTIFY.
   * Falls back to local-only emit if PG is not connected (e.g. during startup).
   */
  emitEvent<K extends keyof EventBusEvents>(event: K, data: EventBusEvents[K]): void {
    if (this.pgNotify) {
      // Send through PG — all workers (including this one) will receive it
      // via the LISTEN handler which calls eventBus.emit() locally
      this.pgNotify(event, data).catch(() => {
        // PG failed, fall back to local-only delivery
        this.emit(event, data);
      });
    } else {
      // PG not connected yet, local-only (startup phase)
      this.emit(event, data);
    }
  }

  onEvent<K extends keyof EventBusEvents>(event: K, listener: (data: EventBusEvents[K]) => void): void {
    this.on(event, listener);
  }

  offEvent<K extends keyof EventBusEvents>(event: K, listener: (data: EventBusEvents[K]) => void): void {
    this.off(event, listener);
  }
}

export const eventBus = new EventBus();
// Increase max listeners since many channels will subscribe
eventBus.setMaxListeners(100);
