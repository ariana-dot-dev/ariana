import { Agent, AgentState } from '@/bindings/types';
import { useTerminalStore } from '@/hooks/useTerminalStore';
import { useAgentAccesses } from '@/hooks/useAgentAccesses';

interface UseAgentStateReturn {
  isLoading: boolean;
  isRunning: boolean;
  canInterrupt: boolean;
  canSendPrompts: boolean;
  canUseTerminals: boolean;
  hasWriteAccess: boolean;
  hasReadAccess: boolean;
  isTerminalOpen: boolean;
  setIsTerminalOpen: (open: boolean) => void;
  handleToggleTerminal: () => void;
}

export function useAgentState(agent: Agent): UseAgentStateReturn {
  const terminalPanelOpen = useTerminalStore(state => state.terminalPanelOpen);
  const setTerminalPanelOpen = useTerminalStore(state => state.setTerminalPanelOpen);
  const { accessMap } = useAgentAccesses();

  const isTerminalOpen = terminalPanelOpen[agent.id] || false;

  // Get user's access level for this agent (reactive - updates when accessMap changes)
  const access = accessMap.get(agent.id);
  const hasWriteAccess = access?.access === 'write';
  const hasReadAccess = access !== undefined; // Has either read or write access

  // Optimistically assume write access for very new agents (<10s old) to show prompt faster
  const isVeryNewAgent = agent.createdAt
    ? (new Date().getTime() - new Date(agent.createdAt).getTime()) < 10000
    : false;
  const optimisticWriteAccess = isVeryNewAgent && access === undefined
    ? true  // Assume write access while loading
    : hasWriteAccess; // Use real value once loaded

  // Terminal access requires agent to be ready, running, idle, or archived (auto-resumes) AND at least read access
  // For new agents, use optimistic access; otherwise require actual hasReadAccess
  const effectiveReadAccess = isVeryNewAgent && access === undefined ? true : hasReadAccess;
  const canUseTerminals = effectiveReadAccess && [
    AgentState.READY,
    AgentState.RUNNING,
    AgentState.IDLE,
    AgentState.ARCHIVED  // ARCHIVED agents auto-resume when needed
  ].includes(agent.state as AgentState);

  // Handle terminal panel toggle
  const handleToggleTerminal = () => {
    setTerminalPanelOpen(agent.id, !isTerminalOpen);
  };

  const setIsTerminalOpen = (open: boolean) => {
    setTerminalPanelOpen(agent.id, open);
  };

  const isLoading = [
    AgentState.PROVISIONING,
    AgentState.PROVISIONED,
    AgentState.CLONING
  ].includes(agent.state as AgentState);

  const isRunning = agent.state === AgentState.RUNNING;

  // Can interrupt only if running AND has write access (use optimistic for new agents)
  const canInterrupt = isRunning && optimisticWriteAccess;

  // Can send prompts only if agent is not in error state AND has write access
  // ARCHIVED agents auto-resume when prompts are sent, so they're allowed
  // Use optimistic access for new agents to show prompt immediately
  const canSendPrompts = optimisticWriteAccess && agent.state !== AgentState.ERROR;

  return {
    isLoading,
    isRunning,
    canInterrupt,
    canSendPrompts,
    canUseTerminals,
    hasWriteAccess,
    hasReadAccess,
    isTerminalOpen,
    setIsTerminalOpen,
    handleToggleTerminal
  };
}