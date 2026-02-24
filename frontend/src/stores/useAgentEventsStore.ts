import { create } from 'zustand';
import { ChatEvent, PromptEvent } from '@/bindings/types';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

const DEFAULT_LIMIT = 80;
const LOAD_MORE_INCREMENT = 100;
const MAX_LIMIT = 500;

// Module-level state for the current WS subscription
let currentUnsubscribe: (() => void) | null = null;
let currentHandler: ((message: ServerMessage) => void) | null = null;
let currentLimit = DEFAULT_LIMIT;

interface AgentEventsState {
  focusedAgentId: string | null;
  eventsCache: Map<string, ChatEvent[]>;
  eventsVersionCache: Map<string, number>;
  hasMoreCache: Map<string, boolean>;
  isLoadingMore: Map<string, boolean>;
  frontendOnlyPrompts: Map<string, PromptEvent[]>;
  lastPrompts: Map<string, string | null>;

  setFocusedAgent: (agentId: string | null) => void;
  loadOlderEvents: (agentId: string) => void;
  addFrontendOnlyPrompt: (agentId: string, prompt: PromptEvent) => void;
  updatePromptStatus: (agentId: string, promptId: string, status: 'sending' | 'queued' | 'failed') => void;
  removeFrontendOnlyPrompt: (agentId: string, promptId: string) => void;
  cleanup: () => void;
}

function applySnapshotToStore(
  agentId: string,
  data: any,
  get: () => AgentEventsState,
  set: (partial: Partial<AgentEventsState>) => void
) {
  const t0 = performance.now();
  if (!data || !data.events) return;

  const state = get();
  const serverEvents: ChatEvent[] = data.events;
  const frontendPrompts = state.frontendOnlyPrompts.get(agentId) || [];

  // Filter out frontend prompts confirmed by server
  const remainingFrontendPrompts = frontendPrompts.filter(
    fp => !serverEvents.some(
      (e: ChatEvent) => e.type === 'prompt' && e.data.prompt === fp.data.prompt
    )
  );

  const merged = [...serverEvents, ...remainingFrontendPrompts];
  merged.sort((a, b) => a.timestamp - b.timestamp);

  const promptEvents = merged.filter((e: ChatEvent) => e.type === 'prompt');
  const lastPrompt = promptEvents.length > 0
    ? promptEvents[promptEvents.length - 1].data.prompt
    : null;

  const newCache = new Map(state.eventsCache);
  newCache.set(agentId, merged);

  const newFrontendPrompts = new Map(state.frontendOnlyPrompts);
  newFrontendPrompts.set(agentId, remainingFrontendPrompts);

  const newLastPrompts = new Map(state.lastPrompts);
  newLastPrompts.set(agentId, lastPrompt);

  const newVersionCache = new Map(state.eventsVersionCache);
  if (data.eventsVersion !== undefined) {
    newVersionCache.set(agentId, data.eventsVersion);
  }

  const newHasMore = new Map(state.hasMoreCache);
  if (data.hasMore !== undefined) {
    newHasMore.set(agentId, data.hasMore);
  }

  // Clear isLoadingMore on snapshot arrival (covers loadMore re-subscribe)
  const newIsLoadingMore = new Map(state.isLoadingMore);
  if (newIsLoadingMore.get(agentId)) {
    newIsLoadingMore.set(agentId, false);
  }

  set({
    eventsCache: newCache,
    eventsVersionCache: newVersionCache,
    hasMoreCache: newHasMore,
    isLoadingMore: newIsLoadingMore,
    frontendOnlyPrompts: newFrontendPrompts,
    lastPrompts: newLastPrompts,
  });

  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] snapshot applied agent=${agentId.slice(0, 8)} events=${serverEvents.length} merge=${merged.length} took=${(performance.now() - t0).toFixed(1)}ms`);
}

function applyAddBatch(
  agentId: string,
  newEvents: ChatEvent[],
  version: number | undefined,
  get: () => AgentEventsState,
  set: (partial: Partial<AgentEventsState>) => void
) {
  const t0 = performance.now();
  const state = get();
  const existing = state.eventsCache.get(agentId) || [];
  const existingIds = new Set(existing.map(e => e.id));

  const toAdd = newEvents.filter(e => !existingIds.has(e.id));
  if (toAdd.length === 0) return;

  // Filter out frontend-only prompts confirmed by new server events
  const frontendPrompts = state.frontendOnlyPrompts.get(agentId) || [];
  const remainingFrontendPrompts = frontendPrompts.filter(
    fp => !toAdd.some(
      (e: ChatEvent) => e.type === 'prompt' && e.data.prompt === fp.data.prompt
    )
  );

  const matchedFpIds = new Set(
    frontendPrompts
      .filter(fp => !remainingFrontendPrompts.includes(fp))
      .map(fp => fp.id)
  );

  // Also collect taskIds of incoming prompt events so we can replace older
  // representations of the same prompt (e.g. qp-{id} replaced by message-based event)
  const incomingPromptTaskIds = new Set(
    toAdd.filter(e => e.type === 'prompt' && e.taskId).map(e => e.taskId)
  );

  const cleanedExisting = existing.filter(e => {
    // Remove matched frontend-only prompts
    if (matchedFpIds.size > 0 && matchedFpIds.has(e.id)) return false;
    // Remove older prompt events superseded by incoming ones with same taskId
    if (e.type === 'prompt' && e.taskId && incomingPromptTaskIds.has(e.taskId)) return false;
    return true;
  });

  const merged = [...cleanedExisting, ...toAdd];
  merged.sort((a, b) => a.timestamp - b.timestamp);

  const allPrompts = merged.filter((e: ChatEvent) => e.type === 'prompt');
  const lastPrompt = allPrompts.length > 0
    ? allPrompts[allPrompts.length - 1].data.prompt
    : state.lastPrompts.get(agentId) ?? null;

  const newCache = new Map(state.eventsCache);
  newCache.set(agentId, merged);

  const newFrontendPrompts = new Map(state.frontendOnlyPrompts);
  newFrontendPrompts.set(agentId, remainingFrontendPrompts);

  const newLastPrompts = new Map(state.lastPrompts);
  newLastPrompts.set(agentId, lastPrompt);

  const updates: Partial<AgentEventsState> = {
    eventsCache: newCache,
    frontendOnlyPrompts: newFrontendPrompts,
    lastPrompts: newLastPrompts,
  };

  if (version !== undefined) {
    const newVersionCache = new Map(state.eventsVersionCache);
    newVersionCache.set(agentId, version);
    updates.eventsVersionCache = newVersionCache;
  }

  set(updates);

  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] delta add-batch agent=${agentId.slice(0, 8)} added=${toAdd.length} total=${merged.length} took=${(performance.now() - t0).toFixed(1)}ms`);
}

function applyModify(
  agentId: string,
  eventId: string,
  updatedEvent: ChatEvent,
  version: number | undefined,
  get: () => AgentEventsState,
  set: (partial: Partial<AgentEventsState>) => void
) {
  const t0 = performance.now();
  const state = get();
  const existing = state.eventsCache.get(agentId) || [];

  let idx = existing.findIndex(e => e.id === eventId);
  // Fallback: for prompt events, match by taskId if id changed (qp-{id} → message id)
  if (idx === -1 && updatedEvent.type === 'prompt' && updatedEvent.taskId) {
    idx = existing.findIndex(e => e.type === 'prompt' && e.taskId === updatedEvent.taskId);
  }
  if (idx === -1) return;

  const newEvents = [...existing];
  newEvents[idx] = updatedEvent;

  const newCache = new Map(state.eventsCache);
  newCache.set(agentId, newEvents);

  const updates: Partial<AgentEventsState> = {
    eventsCache: newCache,
  };

  if (version !== undefined) {
    const newVersionCache = new Map(state.eventsVersionCache);
    newVersionCache.set(agentId, version);
    updates.eventsVersionCache = newVersionCache;
  }

  set(updates);

  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] delta modify agent=${agentId.slice(0, 8)} event=${eventId.slice(0, 8)} type=${updatedEvent.type} took=${(performance.now() - t0).toFixed(1)}ms`);
}

function makeHandler(
  agentId: string,
  get: () => AgentEventsState,
  set: (partial: Partial<AgentEventsState>) => void
): (message: ServerMessage) => void {
  return (message: ServerMessage) => {
    if (message.type === 'snapshot') {
      const snapshotMsg = message as SnapshotMessage;
      applySnapshotToStore(agentId, snapshotMsg.data, get, set);
    } else if (message.type === 'delta') {
      const deltaMsg = message as DeltaMessage;
      const { op } = deltaMsg.data;

      if (op === 'add-batch' && deltaMsg.data.items) {
        applyAddBatch(agentId, deltaMsg.data.items as ChatEvent[], deltaMsg.data.version, get, set);
      } else if (op === 'add' && deltaMsg.data.item) {
        applyAddBatch(agentId, [deltaMsg.data.item as ChatEvent], deltaMsg.data.version, get, set);
      } else if (op === 'modify' && deltaMsg.data.item && deltaMsg.data.itemId) {
        applyModify(agentId, deltaMsg.data.itemId, deltaMsg.data.item as ChatEvent, deltaMsg.data.version, get, set);
      } else if (op === 'replace' && deltaMsg.data.item) {
        applySnapshotToStore(agentId, deltaMsg.data.item, get, set);
      }
    }
  };
}

export const useAgentEventsStore = create<AgentEventsState>((set, get) => ({
  focusedAgentId: null,
  eventsCache: new Map(),
  eventsVersionCache: new Map(),
  hasMoreCache: new Map(),
  isLoadingMore: new Map(),
  frontendOnlyPrompts: new Map(),
  lastPrompts: new Map(),

  setFocusedAgent: (agentId: string | null) => {
    const state = get();
    if (state.focusedAgentId === agentId) return;

    const t0 = performance.now();

    // Clear old subscription (but NOT the cache — cached events stay for instant display on return)
    if (currentUnsubscribe) {
      currentUnsubscribe();
      currentUnsubscribe = null;
      currentHandler = null;
    }

    set({ focusedAgentId: agentId });

    if (agentId) {
      currentLimit = DEFAULT_LIMIT;
      currentHandler = makeHandler(agentId, get, set);
      currentUnsubscribe = wsService.subscribe(
        'agent-events',
        { agentId, limit: currentLimit },
        currentHandler
      );

      const cached = state.eventsCache.get(agentId);
      console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] setFocusedAgent agent=${agentId.slice(0, 8)} cachedEvents=${cached?.length ?? 0} subscribeTime=${(performance.now() - t0).toFixed(1)}ms`);
    } else {
      console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] setFocusedAgent agent=null unsubTime=${(performance.now() - t0).toFixed(1)}ms`);
    }
  },

  loadOlderEvents: (agentId: string) => {
    const state = get();
    if (state.isLoadingMore.get(agentId)) return;
    if (!state.hasMoreCache.get(agentId)) return;
    if (!currentHandler || !currentUnsubscribe) {
      console.warn('[AgentEventsStore] loadOlderEvents: no active WS subscription, skipping');
      return;
    }
    if (currentLimit >= MAX_LIMIT) return;

    // Mark loading
    set({ isLoadingMore: new Map(state.isLoadingMore).set(agentId, true) });

    // Unsub old, resub with higher limit — triggers fresh snapshot
    currentUnsubscribe();
    currentLimit = Math.min(currentLimit + LOAD_MORE_INCREMENT, MAX_LIMIT);
    currentUnsubscribe = wsService.subscribe(
      'agent-events',
      { agentId, limit: currentLimit },
      currentHandler
    );

    // Safety net: clear isLoadingMore if snapshot doesn't arrive within 15s
    const limitAtRequest = currentLimit;
    setTimeout(() => {
      const s = get();
      if (s.isLoadingMore.get(agentId) && currentLimit === limitAtRequest) {
        console.warn('[AgentEventsStore] loadOlderEvents: timed out waiting for snapshot, clearing loading state');
        set({ isLoadingMore: new Map(s.isLoadingMore).set(agentId, false) });
      }
    }, 15000);
  },

  addFrontendOnlyPrompt: (agentId: string, prompt: PromptEvent) => {
    const state = get();
    const newFrontendPrompts = new Map(state.frontendOnlyPrompts);
    const existing = newFrontendPrompts.get(agentId) || [];
    newFrontendPrompts.set(agentId, [...existing, prompt]);

    const newCache = new Map(state.eventsCache);
    const existingEvents = newCache.get(agentId) || [];
    newCache.set(agentId, [...existingEvents, prompt]);

    set({ frontendOnlyPrompts: newFrontendPrompts, eventsCache: newCache });
  },

  updatePromptStatus: (agentId: string, promptId: string, status: 'sending' | 'queued' | 'failed') => {
    const state = get();

    const updateStatus = <T extends ChatEvent>(event: T): T => {
      return event.id === promptId && event.type === 'prompt'
        ? ({ ...event, data: { ...event.data, status } } as T)
        : event;
    };

    const newFrontendPrompts = new Map(state.frontendOnlyPrompts);
    const prompts = newFrontendPrompts.get(agentId) || [];
    newFrontendPrompts.set(agentId, prompts.map(updateStatus));

    const newCache = new Map(state.eventsCache);
    const events = newCache.get(agentId) || [];
    newCache.set(agentId, events.map(updateStatus));

    set({ frontendOnlyPrompts: newFrontendPrompts, eventsCache: newCache });
  },

  removeFrontendOnlyPrompt: (agentId: string, promptId: string) => {
    const state = get();
    const newFrontendPrompts = new Map(state.frontendOnlyPrompts);
    const prompts = newFrontendPrompts.get(agentId) || [];
    newFrontendPrompts.set(agentId, prompts.filter(p => p.id !== promptId));

    const newCache = new Map(state.eventsCache);
    const events = newCache.get(agentId) || [];
    newCache.set(agentId, events.filter(e => e.id !== promptId));

    set({ frontendOnlyPrompts: newFrontendPrompts, eventsCache: newCache });
  },

  cleanup: () => {
    if (currentUnsubscribe) {
      currentUnsubscribe();
      currentUnsubscribe = null;
      currentHandler = null;
    }
    currentLimit = DEFAULT_LIMIT;
    set({
      focusedAgentId: null,
      eventsCache: new Map(),
      eventsVersionCache: new Map(),
      hasMoreCache: new Map(),
      isLoadingMore: new Map(),
      frontendOnlyPrompts: new Map(),
      lastPrompts: new Map(),
    });
  },
}));
