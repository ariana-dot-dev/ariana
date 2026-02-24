import { useState, useEffect, useCallback, useMemo } from 'react';
import { agentCreationService } from '@/services/agent.service';
import { useProviderStore, isSubscriptionConnected, isApiKeyConnected } from '@/stores/useProviderStore';
import type { AgentConfig } from '@/types/AgentConfig';
import type { AgentWithCreator } from '@/bindings/types';
import { ProjectWorkspace } from '@/stores/useAppStore';
import { useToast } from '@/hooks/use-toast';
import { showPoolExhaustedToast } from '@/lib/poolExhaustedToast';
import { posthog } from '@/lib/posthog';

interface CreateAgentParams {
  projectId: string;
  projectWorkspace: ProjectWorkspace;
  config: AgentConfig;
}

export interface UseAgentCreationReturn {
  createAgent: (params: CreateAgentParams, onAgentCreated?: (agent: AgentWithCreator) => void) => Promise<void>;
  isCreating: boolean;
  providerDialogOpen: boolean;
  setProviderDialogOpen: (open: boolean) => void;
  handleProviderSkip: () => void;
}

export function useAgentCreation(): UseAgentCreationReturn {
  const [isCreating, setIsCreating] = useState(false);
  const [providerDialogOpen, setProviderDialogOpen] = useState(false);
  const [pendingCreation, setPendingCreation] = useState<{
    params: CreateAgentParams;
    callback?: (agent: AgentWithCreator) => void;
  } | null>(null);

  const { toast } = useToast();

  // Get provider status from store
  const config = useProviderStore(state => state.config);
  const hasOAuthToken = useMemo(() => isSubscriptionConnected(config), [config]);
  const hasApiKey = useMemo(() => isApiKeyConnected(config), [config]);
  const isReady = useMemo(() => hasOAuthToken || hasApiKey, [hasOAuthToken, hasApiKey]);

  const createAgentDirectly = useCallback(async (
    params: CreateAgentParams,
    onAgentCreated?: (agent: AgentWithCreator) => void
  ) => {
    setIsCreating(true);

    try {
      // Wrap the callback to stop loading immediately after agent is created
      const wrappedCallback = onAgentCreated ? (agent: AgentWithCreator) => {
        // Stop loading immediately after creation (not after full startup)
        setIsCreating(false);
        onAgentCreated(agent);
      } : undefined;

      await agentCreationService.createAndStartAgent(
        {
          projectId: params.projectId,
          projectWorkspace: params.projectWorkspace,
          config: params.config
        },
        wrappedCallback
      );

      // If no callback was provided, stop loading after everything completes
      if (!onAgentCreated) {
        setIsCreating(false);
      }
    } catch (error) {
      console.error('[useAgentCreation] Failed to create agent:', error);
      setIsCreating(false);

      // Handle machine pool exhaustion specifically
      if (error instanceof Error && error.message === 'MACHINE_POOL_EXHAUSTED') {
        showPoolExhaustedToast(toast);
        return; // Don't rethrow - we handled it gracefully
      }

      throw error;
    }
  }, [toast]);

  // Auto-create agent when provider becomes ready
  useEffect(() => {
    if (isReady && pendingCreation) {
      console.log('[useAgentCreation] Provider became ready, creating agent');
      posthog.capture('provider_validation_completed', {
        has_oauth_token: hasOAuthToken,
        has_api_key: hasApiKey,
        provider: pendingCreation.params.config.provider
      });
      setProviderDialogOpen(false);
      createAgentDirectly(pendingCreation.params, pendingCreation.callback);
      setPendingCreation(null);
    }
  }, [isReady, pendingCreation, createAgentDirectly, hasOAuthToken, hasApiKey]);

  const createAgent = useCallback(async (
    params: CreateAgentParams,
    onAgentCreated?: (agent: AgentWithCreator) => void
  ) => {
    // Check if provider is ready
    if (!isReady) {
      console.log('[useAgentCreation] Provider not ready, showing validation dialog');
      posthog.capture('provider_validation_required', {
        has_oauth_token: hasOAuthToken,
        has_api_key: hasApiKey,
        provider: params.config.provider
      });
      setPendingCreation({ params, callback: onAgentCreated });
      setProviderDialogOpen(true);
      return;
    }

    await createAgentDirectly(params, onAgentCreated);
  }, [isReady, createAgentDirectly, hasOAuthToken, hasApiKey]);

  const handleProviderSkip = useCallback(() => {
    if (pendingCreation) {
      console.log('[useAgentCreation] User skipped provider validation, creating agent anyway');
      createAgentDirectly(pendingCreation.params, pendingCreation.callback);
      setPendingCreation(null);
    }
  }, [pendingCreation, createAgentDirectly]);

  return {
    createAgent,
    isCreating,
    providerDialogOpen,
    setProviderDialogOpen,
    handleProviderSkip
  };
}
