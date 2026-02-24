import { useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClaudeProviderConfig } from '@/components/ClaudeProviderConfig';
import { useAppStore } from '@/stores/useAppStore';
import type { AgentProvider } from '@/types/AgentConfig';
import Logo from '@/components/ui/logo';
import { useProviderStore, isSubscriptionConnected, isApiKeyConnected } from '@/stores/useProviderStore';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { Button } from '@/components/ui/button';

const PROVIDER_OPTIONS = [
  { id: 'claude-code' as AgentProvider, name: 'Claude Code', logoPath: `${import.meta.env.BASE_URL}claude-logo.png` },
  // Future providers can be added here
];

export function OnboardingProvider() {
  const defaultAgentProvider = useAppStore(state => state.defaultAgentProvider);
  const setDefaultAgentProvider = useAppStore(state => state.setDefaultAgentProvider);
  const setHasCompletedOnboarding = useAppStore(state => state.setHasCompletedOnboarding);
  const isBrowser = useIsBrowser();

  // Get provider status from store
  const config = useProviderStore(state => state.config);
  const isReady = useMemo(() => isSubscriptionConnected(config) || isApiKeyConnected(config), [config]);

  const selectedProvider = defaultAgentProvider || 'claude-code';

  // Auto-set default provider when it becomes ready and complete onboarding
  useEffect(() => {
    if (isReady && !defaultAgentProvider) {
      console.log('[OnboardingStep2] Provider became ready, setting as default and completing onboarding');
      setDefaultAgentProvider('claude-code');
      setHasCompletedOnboarding(true);
    }
  }, [isReady, defaultAgentProvider, setDefaultAgentProvider, setHasCompletedOnboarding]);

  const handleSkip = () => {
    if (!defaultAgentProvider) {
      setDefaultAgentProvider('claude-code');
    }
    setHasCompletedOnboarding(true);
  };

  return (
    <Card className="w-full">
      <CardHeader className="text-left">
        <CardTitle className="text-2xl mb-3">Setup your Agent Provider</CardTitle>
        <CardDescription className='flex flex-col gap-1'>
          <div>Ariana helps you get more value out of your existing subscriptions & API credits.</div>
          <div>Please pick & authenticate a supported agent provider:</div>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 !px-4">
        {/* Provider Selector */}
        {(PROVIDER_OPTIONS.length > 1 && (
          <div className="flex items-center gap-2 w-fit">
            <Select
              value={selectedProvider}
              onValueChange={(value) => setDefaultAgentProvider(value as AgentProvider)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_OPTIONS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <div className="flex items-center gap-2">
                      <span>{provider.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}

        {/* Provider Configuration */}
        {selectedProvider === 'claude-code' && (
          <div className="">
            <ClaudeProviderConfig />
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-end">
        <Button
          variant="transparent"
          hoverVariant="default"
          onClick={handleSkip}
        >
          Skip for now
        </Button>
      </CardFooter>
    </Card>
  );
}
