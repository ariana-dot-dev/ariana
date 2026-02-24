import { useEffect } from 'react';
import { useDiffsStore } from '@/stores/useDiffsStore';

export function useAgentDiffs(agentId: string, isFocused: boolean = true) {
  // Subscribe to the single diff data in store
  const rawDiffData = useDiffsStore(state => state.diffData);

  // Only use diffData if it belongs to the current agent
  const diffData = rawDiffData?.agentId === agentId ? rawDiffData : null;

  // console.log('[useAgentDiffs] Render - agentId:', agentId, 'isFocused:', isFocused, 'diffData agentId:', rawDiffData?.agentId, 'match:', diffData !== null);

  // Set this agent as focused ONLY when this tab is actually focused (polling auto-starts)
  useEffect(() => {
    if (!isFocused) return;

    // console.log('[useAgentDiffs] Setting focused agent to:', agentId);
    const store = useDiffsStore.getState();
    store.setFocusedAgent(agentId);

    return () => {
      // Clear focus when tab loses focus or unmounts (polling auto-stops)
      // console.log('[useAgentDiffs] Clearing focused agent');
      useDiffsStore.getState().setFocusedAgent(null);
    };
  }, [agentId, isFocused]);

  const hasUncommittedChanges = Boolean(
    diffData?.pendingDiff && diffData.pendingDiff.trim().length > 0
  );

  return {
    diffData,
    hasUncommittedChanges,
  };
}
