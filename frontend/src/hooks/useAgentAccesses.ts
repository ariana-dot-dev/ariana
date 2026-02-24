import { useMemo, useEffect } from 'react';
import { create } from 'zustand';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

export interface AgentAccess {
  agentId: string;
  access: 'read' | 'write';
  ownerId: string | null;
  ownerUsername: string | null;
}

// Track the current WS unsubscribe function outside the store
let currentWsUnsubscribe: (() => void) | null = null;

// Zustand store for agent accesses (singleton)
interface AgentAccessesStore {
  agentAccesses: AgentAccess[];
  isLoading: boolean;
  subscriptionActive: boolean;
  subscriberCount: number;

  // Actions
  startSubscription: () => void;
  stopSubscription: () => void;
  subscribe: () => void;
  unsubscribe: () => void;
}

const useAgentAccessesStore = create<AgentAccessesStore>((set, get) => ({
  agentAccesses: [],
  isLoading: true,
  subscriptionActive: false,
  subscriberCount: 0,

  startSubscription: () => {
    const state = get();
    if (state.subscriptionActive) return;

    // Subscribe via WebSocket
    currentWsUnsubscribe = wsService.subscribe(
      'agent-accesses',
      {},
      (message: ServerMessage) => {
        if (message.type === 'snapshot') {
          const snapshotMsg = message as SnapshotMessage;
          if (snapshotMsg.data?.accesses) {
            set({ agentAccesses: snapshotMsg.data.accesses, isLoading: false });
          }
        } else if (message.type === 'delta') {
          const deltaMsg = message as DeltaMessage;
          if (deltaMsg.data.op === 'replace' && deltaMsg.data.item?.accesses) {
            set({ agentAccesses: deltaMsg.data.item.accesses, isLoading: false });
          }
        }
      }
    );

    set({ subscriptionActive: true });
  },

  stopSubscription: () => {
    const state = get();
    if (!state.subscriptionActive) return;

    if (currentWsUnsubscribe) {
      currentWsUnsubscribe();
      currentWsUnsubscribe = null;
    }
    set({ subscriptionActive: false });
  },

  subscribe: () => {
    const state = get();
    const newCount = state.subscriberCount + 1;
    set({ subscriberCount: newCount });

    // Start subscribing when first subscriber arrives
    if (newCount === 1) {
      get().startSubscription();
    }
  },

  unsubscribe: () => {
    const state = get();
    const newCount = Math.max(0, state.subscriberCount - 1);
    set({ subscriberCount: newCount });

    // Stop subscribing when last subscriber leaves
    if (newCount === 0) {
      get().stopSubscription();
    }
  },
}));

// Hook that subscribes to the singleton store
export function useAgentAccesses() {
  const agentAccesses = useAgentAccessesStore(state => state.agentAccesses);
  const isLoading = useAgentAccessesStore(state => state.isLoading);
  const subscribe = useAgentAccessesStore(state => state.subscribe);
  const unsubscribe = useAgentAccessesStore(state => state.unsubscribe);

  // Subscribe on mount, unsubscribe on unmount
  useEffect(() => {
    subscribe();
    return () => unsubscribe();
  }, [subscribe, unsubscribe]);

  // Create a reactive Map that updates when agentAccesses changes
  const accessMap = useMemo(() => {
    const map = new Map<string, AgentAccess>();
    agentAccesses.forEach(access => {
      map.set(access.agentId, access);
    });
    return map;
  }, [agentAccesses]);

  return {
    agentAccesses,
    accessMap,
    isLoading
  };
}
