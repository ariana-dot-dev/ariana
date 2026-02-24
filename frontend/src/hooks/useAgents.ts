import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Agent, AgentWithCreator } from '@/bindings/types';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

// Callback registries stored outside Zustand to prevent infinite loops
const onAgentUpdatedCallbacks = new Map<string, Set<(agentId: string) => void>>();
const onAgentBecameReadyCallbacks = new Map<string, Set<(agent: Agent) => void>>();
const onAgentBecameArchivedCallbacks = new Map<string, Set<(agent: Agent) => void>>();

interface AgentsStore {
  agentsByProject: Map<string, AgentWithCreator[]>;
  unsubsByProject: Map<string, () => void>;
  previousAgentsByProject: Map<string, Map<string, AgentWithCreator>>;
  agentsSeenAsReadyByProject: Map<string, Set<string>>;

  fetchAgents: (projectId: string) => Promise<AgentWithCreator[]>;
  deleteAgent: (agentId: string, projectId: string) => Promise<void>;
  startSubscription: (projectId: string) => void;
  stopSubscription: (projectId: string) => void;
}

function processAgentCallbacks(
  projectId: string,
  newAgents: AgentWithCreator[],
  get: () => AgentsStore,
  set: (partial: Partial<AgentsStore> | ((state: AgentsStore) => Partial<AgentsStore>)) => void
) {
  const newAgentsMap = new Map(newAgents.map(a => [a.id, a]));
  const previousMap = get().previousAgentsByProject.get(projectId) || new Map();
  const agentsSeenAsReady = get().agentsSeenAsReadyByProject.get(projectId) || new Set();

  const updatedCallbacks = onAgentUpdatedCallbacks.get(projectId) || new Set();
  const readyCallbacks = onAgentBecameReadyCallbacks.get(projectId) || new Set();
  const archivedCallbacks = onAgentBecameArchivedCallbacks.get(projectId) || new Set();

  for (const [agentId, newAgent] of newAgentsMap) {
    const oldAgent = previousMap.get(agentId);

    // Detect agent update
    if (oldAgent && JSON.stringify(oldAgent) !== JSON.stringify(newAgent)) {
      updatedCallbacks.forEach(cb => cb(agentId));
    }

    // Detect agent becoming READY for the first time
    if (newAgent.state === 'ready' && !agentsSeenAsReady.has(agentId)) {
      const newSeenAsReady = new Set(agentsSeenAsReady);
      newSeenAsReady.add(agentId);

      set((state) => {
        const agentsSeenAsReadyByProject = new Map(state.agentsSeenAsReadyByProject);
        agentsSeenAsReadyByProject.set(projectId, newSeenAsReady);
        return { agentsSeenAsReadyByProject };
      });

      readyCallbacks.forEach(cb => cb(newAgent));
    }

    // Detect agent becoming ARCHIVED
    if (oldAgent && oldAgent.state !== 'archived' && newAgent.state === 'archived') {
      archivedCallbacks.forEach(cb => cb(newAgent));
    }
  }

  // Update previous agents map for next comparison
  set((state) => {
    const previousAgentsByProject = new Map(state.previousAgentsByProject);
    previousAgentsByProject.set(projectId, newAgentsMap);
    return { previousAgentsByProject };
  });
}

export const useAgentsStore = create<AgentsStore>()(
  subscribeWithSelector((set, get) => ({
    agentsByProject: new Map(),
    unsubsByProject: new Map(),
    previousAgentsByProject: new Map(),
    agentsSeenAsReadyByProject: new Map(),

    fetchAgents: async (projectId: string) => {
      try {
        const response = await authenticatedFetch(`${API_URL}/api/agents?project=${projectId}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch agents: ${response.status}`);
        }

        const data = await response.json();
        const agents: AgentWithCreator[] = data.agents;

        processAgentCallbacks(projectId, agents, get, set);

        set((state) => {
          const existing = state.agentsByProject.get(projectId) ?? [];
          if (JSON.stringify(agents) === JSON.stringify(existing)) return state;

          const agentsByProject = new Map(state.agentsByProject);
          agentsByProject.set(projectId, agents);
          return { agentsByProject };
        });

        return agents;
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        throw err;
      }
    },

    deleteAgent: async (agentId: string, projectId: string) => {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete agent');
      }

      await get().fetchAgents(projectId);
    },

    startSubscription: (projectId: string) => {
      if (get().unsubsByProject.has(projectId)) return;

      // Subscribe via WebSocket with projectId param
      const unsub = wsService.subscribe(
        'agents-list',
        { projectId },
        (message: ServerMessage) => {
          if (message.type === 'snapshot') {
            const snapshotMsg = message as SnapshotMessage;
            if (snapshotMsg.data?.agents) {
              const agents: AgentWithCreator[] = snapshotMsg.data.agents;

              processAgentCallbacks(projectId, agents, get, set);

              set((state) => {
                const agentsByProject = new Map(state.agentsByProject);
                agentsByProject.set(projectId, agents);
                return { agentsByProject };
              });
            }
          } else if (message.type === 'delta') {
            const deltaMsg = message as DeltaMessage;
            const delta = deltaMsg.data;
            const existing = get().agentsByProject.get(projectId) ?? [];

            let updated: AgentWithCreator[] | null = null;
            switch (delta.op) {
              case 'add': {
                if (delta.item) updated = [delta.item as AgentWithCreator, ...existing];
                break;
              }
              case 'modify': {
                if (delta.itemId && delta.item) {
                  updated = existing.map(a =>
                    a.id === delta.itemId ? delta.item as AgentWithCreator : a
                  );
                }
                break;
              }
              case 'delete': {
                if (delta.itemId) updated = existing.filter(a => a.id !== delta.itemId);
                break;
              }
              case 'replace': {
                if (delta.items) updated = delta.items as AgentWithCreator[];
                break;
              }
            }

            if (updated) {
              processAgentCallbacks(projectId, updated, get, set);

              set((state) => {
                const agentsByProject = new Map(state.agentsByProject);
                agentsByProject.set(projectId, updated!);
                return { agentsByProject };
              });
            }
          }
        }
      );

      set((state) => {
        const unsubsByProject = new Map(state.unsubsByProject);
        unsubsByProject.set(projectId, unsub);
        return { unsubsByProject };
      });
    },

    stopSubscription: (projectId: string) => {
      const unsub = get().unsubsByProject.get(projectId);
      if (!unsub) return;

      unsub();
      set((state) => {
        const unsubsByProject = new Map(state.unsubsByProject);
        unsubsByProject.delete(projectId);
        return { unsubsByProject };
      });
    },
  }))
);

const EMPTY_AGENTS: AgentWithCreator[] = [];

export function useAgents(
  projectId: string,
  onAgentUpdated?: (agentId: string) => void,
  onAgentBecameReady?: (agent: Agent) => void,
  onAgentBecameArchived?: (agent: Agent) => void
) {
  const agents = useAgentsStore(state =>
    state.agentsByProject.get(projectId) ?? EMPTY_AGENTS
  );

  const fetchAgents = useAgentsStore(state => state.fetchAgents);
  const deleteAgent = useAgentsStore(state => state.deleteAgent);

  const onAgentUpdatedRef = useRef(onAgentUpdated);
  const onAgentBecameReadyRef = useRef(onAgentBecameReady);
  const onAgentBecameArchivedRef = useRef(onAgentBecameArchived);

  // Keep refs up to date without triggering re-renders
  useEffect(() => {
    onAgentUpdatedRef.current = onAgentUpdated;
    onAgentBecameReadyRef.current = onAgentBecameReady;
    onAgentBecameArchivedRef.current = onAgentBecameArchived;
  });

  // Register stable wrapper functions that use refs
  useEffect(() => {
    // Create stable wrapper functions that call the latest callback via ref
    const stableOnAgentUpdated = onAgentUpdatedRef.current ? (agentId: string) => {
      onAgentUpdatedRef.current?.(agentId);
    } : null;

    const stableOnAgentBecameReady = onAgentBecameReadyRef.current ? (agent: Agent) => {
      onAgentBecameReadyRef.current?.(agent);
    } : null;

    const stableOnAgentBecameArchived = onAgentBecameArchivedRef.current ? (agent: Agent) => {
      onAgentBecameArchivedRef.current?.(agent);
    } : null;

    // Register stable callbacks in external Maps
    if (stableOnAgentUpdated) {
      if (!onAgentUpdatedCallbacks.has(projectId)) {
        onAgentUpdatedCallbacks.set(projectId, new Set());
      }
      onAgentUpdatedCallbacks.get(projectId)!.add(stableOnAgentUpdated);
    }

    if (stableOnAgentBecameReady) {
      if (!onAgentBecameReadyCallbacks.has(projectId)) {
        onAgentBecameReadyCallbacks.set(projectId, new Set());
      }
      onAgentBecameReadyCallbacks.get(projectId)!.add(stableOnAgentBecameReady);
    }

    if (stableOnAgentBecameArchived) {
      if (!onAgentBecameArchivedCallbacks.has(projectId)) {
        onAgentBecameArchivedCallbacks.set(projectId, new Set());
      }
      onAgentBecameArchivedCallbacks.get(projectId)!.add(stableOnAgentBecameArchived);
    }

    useAgentsStore.getState().startSubscription(projectId);

    return () => {
      useAgentsStore.getState().stopSubscription(projectId);

      // Cleanup callbacks
      if (stableOnAgentUpdated) {
        onAgentUpdatedCallbacks.get(projectId)?.delete(stableOnAgentUpdated);
      }
      if (stableOnAgentBecameReady) {
        onAgentBecameReadyCallbacks.get(projectId)?.delete(stableOnAgentBecameReady);
      }
      if (stableOnAgentBecameArchived) {
        onAgentBecameArchivedCallbacks.get(projectId)?.delete(stableOnAgentBecameArchived);
      }
    };
  }, [projectId]); // Only depend on projectId, not the callbacks!

  return {
    agents,
    fetchAgents: () => fetchAgents(projectId),
    deleteAgent: (agentId: string) => deleteAgent(agentId, projectId)
  };
}
