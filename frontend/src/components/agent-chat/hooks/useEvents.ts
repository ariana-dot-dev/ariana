import { useEffect, useMemo, useCallback } from 'react';
import { ChatEvent, PromptEvent, Agent } from '@/bindings/types';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import type { PromptMention } from '@/types/MentionSuggestion';
import { useAgentEventsStore } from '@/stores/useAgentEventsStore';
import { posthog } from '@/lib/posthog';

interface UseEventsReturn {
  events: ChatEvent[];
  lastPrompt: string | null;
  sending: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadOlderEvents: () => void;
  sendPrompt: (prompt: string, selectedMentions: PromptMention[], model?: 'opus' | 'sonnet' | 'haiku') => Promise<boolean>;
  interruptAgent: () => Promise<void>;
  resetAgent: () => Promise<void>;
  refetchEvents: () => Promise<void>;
  cancelPrompt: (promptId: string) => Promise<void>;
  skipQueue: (promptId: string) => Promise<void>;
}

export function useEvents(agent: Agent, isFocused: boolean = true): UseEventsReturn {

  // Subscribe to store maps - only re-render when the map references change
  const eventsCache = useAgentEventsStore(state => state.eventsCache);
  const lastPrompts = useAgentEventsStore(state => state.lastPrompts);
  const hasMoreCache = useAgentEventsStore(state => state.hasMoreCache);
  const isLoadingMoreCache = useAgentEventsStore(state => state.isLoadingMore);

  // Memoize the results to avoid recreating arrays
  const events = useMemo(() => eventsCache.get(agent.id) || [], [eventsCache, agent.id]);
  const lastPrompt = useMemo(() => lastPrompts.get(agent.id) || null, [lastPrompts, agent.id]);
  const hasMore = useMemo(() => hasMoreCache.get(agent.id) || false, [hasMoreCache, agent.id]);
  const isLoadingMore = useMemo(() => isLoadingMoreCache.get(agent.id) || false, [isLoadingMoreCache, agent.id]);

  const loadOlderEvents = useCallback(() => {
    useAgentEventsStore.getState().loadOlderEvents(agent.id);
  }, [agent.id]);

  // Subscribe to this agent's events only when focused
  useEffect(() => {
    if (isFocused) {
      useAgentEventsStore.getState().setFocusedAgent(agent.id);
    }

    return () => {
      // Only clear focus if this agent is still the focused one
      const current = useAgentEventsStore.getState().focusedAgentId;
      if (current === agent.id) {
        useAgentEventsStore.getState().setFocusedAgent(null);
      }
    };
  }, [agent.id, isFocused]);

  const sendPrompt = async (prompt: string, selectedMentions: PromptMention[], model?: 'opus' | 'sonnet' | 'haiku'): Promise<boolean> => {
    if (!prompt.trim()) return false;
    const promptId = Date.now().toString();
    const promptText = prompt.trim();

    const newPromptEvent: PromptEvent = {
      id: promptId,
      type: 'prompt' as const,
      timestamp: Date.now(),
      taskId: 'last',
      data: {
        prompt: promptText,
        status: 'sending' as const,
        is_reverted: false
      }
    };

    // Show immediately in UI
    useAgentEventsStore.getState().addFrontendOnlyPrompt(agent.id, newPromptEvent);

    posthog.capture('prompt_sent', {
      agent_id: agent.id,
      prompt_length: promptText.length,
      has_mentions: selectedMentions.length > 0,
      mention_count: selectedMentions.length
    });

    // Fire and forget — don't block UI on network
    authenticatedFetch(`${API_URL}/api/agents/${agent.id}/prompt`, {
      method: 'POST',
      body: JSON.stringify({ prompt: promptText, mentions: selectedMentions, model: model || 'sonnet' })
    }).then(response => {
      if (response.ok) {
        useAgentEventsStore.getState().updatePromptStatus(agent.id, promptId, 'queued');
        posthog.capture('prompt_sent_success', { agent_id: agent.id });
      } else {
        throw new Error(`Failed to send prompt: ${response.statusText}`);
      }
    }).catch(error => {
      console.error('Failed to send prompt:', error);
      useAgentEventsStore.getState().updatePromptStatus(agent.id, promptId, 'failed');
      posthog.capture('prompt_sent_failed', {
        agent_id: agent.id,
        error: error instanceof Error ? error.message : 'unknown_error'
      });
    });

    return true;
  };

  const interruptAgent = async () => {
    try {
      posthog.capture('agent_interrupted', {
        agent_id: agent.id
      });
      await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/interrupt`, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Failed to interrupt agent:', error);
      posthog.capture('agent_interrupt_failed', {
        agent_id: agent.id,
        error: error instanceof Error ? error.message : 'unknown_error'
      });
    }
  };

  const resetAgent = async () => {
    try {
      await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/reset`, {
        method: 'POST'
      });
    } catch (error) {
      console.error('Failed to reset agent:', error);
    }
  };

  const cancelPrompt = async (promptId: string) => {
    try {
      posthog.capture('prompt_cancelled', {
        agent_id: agent.id,
        prompt_id: promptId
      });
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/prompts/${promptId}`, {
        method: 'DELETE'
      });
      if (!response.ok) {
        throw new Error(`Failed to cancel prompt: ${response.statusText}`);
      }
      useAgentEventsStore.getState().removeFrontendOnlyPrompt(agent.id, promptId);
    } catch (error) {
      console.error('Failed to cancel prompt:', error);
      posthog.capture('prompt_cancel_failed', {
        agent_id: agent.id,
        prompt_id: promptId,
        error: error instanceof Error ? error.message : 'unknown_error'
      });
    }
  };

  const skipQueue = async (promptId: string) => {
    try {
      posthog.capture('prompt_skip_queue', {
        agent_id: agent.id,
        prompt_id: promptId
      });
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/prompts/${promptId}/skip-queue`, {
        method: 'POST'
      });
      if (!response.ok) {
        throw new Error(`Failed to skip queue: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Failed to skip queue:', error);
      posthog.capture('prompt_skip_queue_failed', {
        agent_id: agent.id,
        prompt_id: promptId,
        error: error instanceof Error ? error.message : 'unknown_error'
      });
    }
  };

  return {
    events,
    lastPrompt,
    sending: false,
    hasMore,
    isLoadingMore,
    loadOlderEvents,
    sendPrompt,
    interruptAgent,
    resetAgent,
    refetchEvents: async () => {}, // No-op: WS deltas handle updates
    cancelPrompt,
    skipQueue
  };
}
