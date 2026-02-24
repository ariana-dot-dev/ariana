import { useEffect } from 'react';
import { Agent } from '@/bindings/types';
import { useAppStore } from '@/stores/useAppStore';
import { usePollingTrackerStore } from '@/stores/usePollingTrackerStore';
import { create } from 'zustand';

interface PeremptionInfo {
  isWarning: boolean;
  timeLeft: string;
  msLeft: number;
}

interface AgentPeremptionData {
  isWarning: boolean;
  timeLeft: string;
  msLeft: number;
  subscriberCount: number;
  intervalId: number | null;
  // Store latest agent data for interval to use
  agent: Agent;
  lifetimeUnitMinutes: number | null;
}

interface AgentPeremptionStore {
  agents: Map<string, AgentPeremptionData>;

  // Actions
  subscribe: (agentId: string, agent: Agent, lifetimeUnitMinutes: number | null) => void;
  unsubscribe: (agentId: string) => void;
  updateAgent: (agentId: string, agent: Agent, lifetimeUnitMinutes: number | null) => void;
}

function formatTimeLeft(ms: number): string {
  if (ms <= 0) return 'expired';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const remainingHours = hours % 24;
  const remainingMinutes = minutes % 60;
  const remainingSeconds = seconds % 60;

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }
}

function calculateTimeLeft(agent: Agent, lifetimeUnitMinutes: number | null): PeremptionInfo {
  const defaultTime = `${lifetimeUnitMinutes || '?'} minutes`;

  // Custom machines run indefinitely - no time limit
  if (agent.machineType === 'custom') {
    return {
      isWarning: false,
      timeLeft: 'unlimited',
      msLeft: Infinity,
    };
  }

  if (!agent.provisionedAt || !lifetimeUnitMinutes) {
    return {
      isWarning: false,
      timeLeft: defaultTime,
      msLeft: 0,
    };
  }

  const now = new Date().getTime();
  const provisionedTime = new Date(agent.provisionedAt).getTime();
  const lifetimeUnits = agent.lifetimeUnits || 1;

  // Calculate total lifetime in milliseconds
  const totalLifetimeMs = lifetimeUnits * lifetimeUnitMinutes * 60 * 1000;

  // Calculate expiration time
  const expiresAt = provisionedTime + totalLifetimeMs;

  // Calculate time left
  const msLeftValue = expiresAt - now;

  // Warning should show when less than 1/3 lifetime remains (at 2/3 mark)
  const warningThreshold = totalLifetimeMs / 3;
  const shouldWarn = msLeftValue > 0 && msLeftValue < warningThreshold;

  return {
    isWarning: shouldWarn,
    timeLeft: formatTimeLeft(msLeftValue),
    msLeft: msLeftValue,
  };
}

const useAgentPeremptionStore = create<AgentPeremptionStore>((set, get) => ({
  agents: new Map(),

  subscribe: (agentId: string, agent: Agent, lifetimeUnitMinutes: number | null) => {
    const agents = new Map(get().agents);
    const existing = agents.get(agentId);

    if (existing) {
      // Increment subscriber count and update agent data
      const newData = calculateTimeLeft(agent, lifetimeUnitMinutes);
      const newCount = existing.subscriberCount + 1;

      agents.set(agentId, {
        ...existing,
        ...newData,
        subscriberCount: newCount,
        agent,
        lifetimeUnitMinutes,
      });
      set({ agents });

      // Note: Don't start new interval - already polling for this agent
      return;
    }

    // First subscriber for this agent - create new entry with initial calculation
    const initialData = calculateTimeLeft(agent, lifetimeUnitMinutes);

    // Register polling
    usePollingTrackerStore.getState().registerPoll(`agent-preemption-${agentId}`, `Agent Lifetime (${agentId.slice(0, 8)})`);

    // Initial calculation
    usePollingTrackerStore.getState().recordPollAttempt(`agent-preemption-${agentId}`);

    // Start polling - read latest agent data from store (every 1 second)
    const intervalId = window.setInterval(() => {
      usePollingTrackerStore.getState().recordPollAttempt(`agent-preemption-${agentId}`);
      const state = get();
      const agentData = state.agents.get(agentId);
      if (agentData) {
        get().updateAgent(agentId, agentData.agent, agentData.lifetimeUnitMinutes);
      }
    }, 1000);

    agents.set(agentId, {
      ...initialData,
      subscriberCount: 1, // First subscriber
      intervalId,
      agent,
      lifetimeUnitMinutes,
    });

    set({ agents });
  },

  unsubscribe: (agentId: string) => {
    const agents = new Map(get().agents);
    const existing = agents.get(agentId);

    if (!existing) return;

    const newCount = existing.subscriberCount - 1;

    if (newCount <= 0) {
      // Last subscriber, clean up
      if (existing.intervalId !== null) {
        clearInterval(existing.intervalId);
      }
      usePollingTrackerStore.getState().unregisterPoll(`agent-preemption-${agentId}`);
      agents.delete(agentId);
    } else {
      // Still have subscribers
      agents.set(agentId, { ...existing, subscriberCount: newCount });
    }

    set({ agents });
  },

  updateAgent: (agentId: string, agent: Agent, lifetimeUnitMinutes: number | null) => {
    const agents = new Map(get().agents);
    const existing = agents.get(agentId);

    if (!existing) return;

    const newData = calculateTimeLeft(agent, lifetimeUnitMinutes);
    agents.set(agentId, {
      ...existing,
      ...newData,
      agent,
      lifetimeUnitMinutes,
    });

    set({ agents });
  },
}));

export function useAgentPeremption(agent: Agent): PeremptionInfo {
  const lifetimeUnitMinutes = useAppStore(state => state.agentLifetimeUnitMinutes);

  // Subscribe on mount
  useEffect(() => {
    useAgentPeremptionStore.getState().subscribe(agent.id, agent, lifetimeUnitMinutes);
    return () => useAgentPeremptionStore.getState().unsubscribe(agent.id);
  }, [agent.id, lifetimeUnitMinutes]);

  // Update agent data when agent or lifetimeUnitMinutes changes
  useEffect(() => {
    useAgentPeremptionStore.getState().updateAgent(agent.id, agent, lifetimeUnitMinutes);
  }, [agent.provisionedAt, agent.lifetimeUnits, lifetimeUnitMinutes, agent.id]);

  // Get current data from store
  const data = useAgentPeremptionStore(state => state.agents.get(agent.id));

  // Return current data or default
  if (!data) {
    return {
      isWarning: false,
      timeLeft: `${lifetimeUnitMinutes || '?'} minutes`,
      msLeft: 0,
    };
  }

  return {
    isWarning: data.isWarning,
    timeLeft: data.timeLeft,
    msLeft: data.msLeft,
  };
}
