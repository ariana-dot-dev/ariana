import { useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClaudeProviderConfig } from '@/components/ClaudeProviderConfig';
import { useAppStore } from '@/stores/useAppStore';
import type { AgentProvider } from '@/types/AgentConfig';
import { useProviderStore, isSubscriptionConnected, isApiKeyConnected } from '@/stores/useProviderStore';

const PROVIDER_OPTIONS = [
  { id: 'claude-code' as AgentProvider, name: 'Claude Code', logoPath: `${import.meta.env.BASE_URL}claude-logo.png` },
  // Future providers can be added here
];

export function ProviderSettings() {
  const defaultAgentProvider = useAppStore(state => state.defaultAgentProvider);
  const setDefaultAgentProvider = useAppStore(state => state.setDefaultAgentProvider);

  // Get provider status from store
  const config = useProviderStore(state => state.config);
  const isReady = useMemo(() => isSubscriptionConnected(config) || isApiKeyConnected(config), [config]);

  const selectedProvider = defaultAgentProvider || 'claude-code';

  // Auto-set default provider when it becomes ready
  useEffect(() => {
    if (isReady && !defaultAgentProvider) {
      console.log('[ProviderSettings] Provider became ready, setting as default');
      setDefaultAgentProvider('claude-code');
    }
  }, [isReady, defaultAgentProvider, setDefaultAgentProvider]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Configure the default AI provider for your agents
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Provider Selector */}
        <div className="flex flex-col gap-2">
          <Select
            value={selectedProvider}
            onValueChange={(value) => setDefaultAgentProvider(value as AgentProvider)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a provider" />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  <div className="flex items-center gap-2">
                    <img
                      src={provider.logoPath}
                      alt={provider.name}
                      className="w-5 h-5 rounded"
                    />
                    <span>{provider.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Provider Configuration */}
        {selectedProvider === 'claude-code' && (
          <div className="mt-2">
            <ClaudeProviderConfig />
          </div>
        )}
      </div>
    </div>
  );
}
