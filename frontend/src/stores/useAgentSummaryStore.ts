import { create } from 'zustand';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

interface AgentSummary {
  agentId: string;
  lastCommitSha: string | null;
  lastCommitUrl: string | null;
  lastCommitAt: string | null;
  additions: number;
  deletions: number;
}

// Track the current WS unsubscribe function outside the store
let currentWsUnsubscribe: (() => void) | null = null;
// Track the currently subscribed agent IDs (sorted, joined) for comparison
let currentSubscriptionKey: string = '';

interface AgentSummaryState {
  // Map of agentId -> summary data
  summaries: Map<string, AgentSummary>;

  // Set of agent IDs currently being subscribed
  subscribedAgentIds: Set<string>;

  // Reference counter to track how many components are using the store
  refCount: number;

  // Actions
  startPolling: (agentIds: string[]) => void;
  stopPolling: () => void;
  updateSummaries: (summaries: AgentSummary[]) => void;
  getSummary: (agentId: string) => AgentSummary | null;
}

function makeSubscriptionKey(ids: string[]): string {
  return [...ids].sort().join(',');
}

function subscribeToSummaries(agentIds: string[], getSummaries: () => AgentSummaryState) {
  if (currentWsUnsubscribe) {
    currentWsUnsubscribe();
    currentWsUnsubscribe = null;
  }

  if (agentIds.length === 0) {
    currentSubscriptionKey = '';
    return;
  }

  currentSubscriptionKey = makeSubscriptionKey(agentIds);

  currentWsUnsubscribe = wsService.subscribe(
    'agent-summaries',
    { agentIds },
    (message: ServerMessage) => {
      if (message.type === 'snapshot') {
        const snapshotMsg = message as SnapshotMessage;
        if (snapshotMsg.data?.summaries) {
          getSummaries().updateSummaries(snapshotMsg.data.summaries);
        }
      } else if (message.type === 'delta') {
        const deltaMsg = message as DeltaMessage;
        if (deltaMsg.data.op === 'modify' && deltaMsg.data.itemId && deltaMsg.data.item) {
          getSummaries().updateSummaries([deltaMsg.data.item]);
        } else if (deltaMsg.data.op === 'replace' && deltaMsg.data.item?.summaries) {
          getSummaries().updateSummaries(deltaMsg.data.item.summaries);
        }
      }
    }
  );
}

export const useAgentSummaryStore = create<AgentSummaryState>((set, get) => ({
  summaries: new Map(),
  subscribedAgentIds: new Set(),
  refCount: 0,

  startPolling: (agentIds: string[]) => {
    const state = get();

    // Increment reference counter
    const newRefCount = state.refCount + 1;

    // Merge the new agent IDs with existing ones
    const mergedAgentIds = new Set([...state.subscribedAgentIds, ...agentIds]);
    const allAgentIds = Array.from(mergedAgentIds);

    set({ refCount: newRefCount, subscribedAgentIds: mergedAgentIds });

    // Check if the subscription key actually changed
    const newKey = makeSubscriptionKey(allAgentIds);
    if (newKey === currentSubscriptionKey) {
      // Agent IDs haven't changed — skip re-subscribe
      return;
    }

    // Agent IDs changed — re-subscribe
    subscribeToSummaries(allAgentIds, get);
  },

  stopPolling: () => {
    const state = get();

    // Decrement reference counter
    const newRefCount = Math.max(0, state.refCount - 1);
    set({ refCount: newRefCount });

    // Only stop if no one is using it anymore
    if (newRefCount === 0) {
      if (currentWsUnsubscribe) {
        currentWsUnsubscribe();
        currentWsUnsubscribe = null;
      }
      currentSubscriptionKey = '';
      set({ subscribedAgentIds: new Set() });
    }
  },

  updateSummaries: (summaries: AgentSummary[]) => {
    const newSummaries = new Map(get().summaries);

    for (const summary of summaries) {
      newSummaries.set(summary.agentId, summary);
    }

    set({ summaries: newSummaries });
  },

  getSummary: (agentId: string) => {
    return get().summaries.get(agentId) || null;
  }
}));
