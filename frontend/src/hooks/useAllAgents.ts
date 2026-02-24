import { useState, useEffect, useRef } from 'react';
import { AgentWithCreatorAndProject } from '@/bindings/types';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

// Re-export the proper type for backwards compatibility
export type AgentWithProject = AgentWithCreatorAndProject;

export function useAllAgents() {
  const [agents, setAgents] = useState<AgentWithProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const subscribedRef = useRef(false);

  const fetchAgents = async (): Promise<AgentWithProject[]> => {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents?includeProjects=true`);

      if (!response.ok) {
        throw new Error(`Failed to fetch agents: ${response.status}`);
      }

      const data = await response.json();
      setAgents(data.agents);
      return data.agents;
    } catch (error) {
      console.error('Failed to fetch all agents:', error);
      setAgents(null);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const deleteAgent = async (agentId: string) => {
    const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete agent');
    }

    await fetchAgents();
  };

  useEffect(() => {
    if (subscribedRef.current) {
      return;
    }
    subscribedRef.current = true;

    // Subscribe via WebSocket
    const unsub = wsService.subscribe(
      'agents-list',
      { includeProjects: true },
      (message: ServerMessage) => {
        if (message.type === 'snapshot') {
          const snapshotMsg = message as SnapshotMessage;
          if (snapshotMsg.data?.agents) {
            setAgents(snapshotMsg.data.agents);
            setLoading(false);
          }
        } else if (message.type === 'delta') {
          const deltaMsg = message as DeltaMessage;
          const delta = deltaMsg.data;

          setAgents(prev => {
            if (!prev) return prev;

            switch (delta.op) {
              case 'add': {
                if (!delta.item) return prev;
                // Prepend new agent (most recent first)
                return [delta.item as AgentWithProject, ...prev];
              }
              case 'modify': {
                if (!delta.itemId || !delta.item) return prev;
                return prev.map(a => a.id === delta.itemId ? delta.item as AgentWithProject : a);
              }
              case 'delete': {
                if (!delta.itemId) return prev;
                return prev.filter(a => a.id !== delta.itemId);
              }
              case 'replace': {
                if (!delta.items) return prev;
                return delta.items as AgentWithProject[];
              }
              default:
                return prev;
            }
          });
        }
      }
    );

    return () => {
      unsub();
      subscribedRef.current = false;
    };
  }, []);

  return {
    agents,
    loading,
    fetchAgents,
    deleteAgent
  };
}
