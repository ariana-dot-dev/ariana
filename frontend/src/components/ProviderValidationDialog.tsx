import { useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ClaudeProviderConfig } from '@/components/ClaudeProviderConfig';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/stores/useAppStore';
import type { AgentProvider } from '@/types/AgentConfig';
import { useProviderStore, isSubscriptionConnected, isApiKeyConnected } from '@/stores/useProviderStore';
import { posthog } from '@/lib/posthog';

const PROVIDER_OPTIONS = [
  { id: 'claude-code' as AgentProvider, name: 'Claude Code', logoPath: `${import.meta.env.BASE_URL}claude-logo.png` },
  // Future providers can be added here
];

interface ProviderValidationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSkip: () => void;
}

export function ProviderValidationDialog({ open, onOpenChange, onSkip }: ProviderValidationDialogProps) {
  const defaultAgentProvider = useAppStore(state => state.defaultAgentProvider);
  const setDefaultAgentProvider = useAppStore(state => state.setDefaultAgentProvider);

  // Get provider status from store
  const config = useProviderStore(state => state.config);
  const isReady = useMemo(() => isSubscriptionConnected(config) || isApiKeyConnected(config), [config]);

  const selectedProvider = defaultAgentProvider || 'claude-code';

  // Auto-close when provider becomes ready
  useEffect(() => {
    if (isReady && open) {
      console.log('[ProviderValidationDialog] Provider became ready, closing dialog');
      onOpenChange(false);
    }
  }, [isReady, open, onOpenChange]);

  const handleSkip = () => {
    posthog.capture('provider_validation_skipped', {
      provider: selectedProvider
    });
    onSkip();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[45ch] max-w-[95vw] p-0 gap-0">
        <Card className="w-full border-0 shadow-none">
          <CardHeader className="text-left">
            <CardTitle className="text-2xl mb-3">Agent Provider Required</CardTitle>
            <CardDescription className='flex flex-col gap-1'>
              <div>You need to setup an agent provider to create agents.</div>
              <div>Please authenticate with a supported provider:</div>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
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
              <div className="px-2 md:px-1">
                <ClaudeProviderConfig />
              </div>
            )}
          </CardContent>
          <DialogFooter className="px-6 pb-6 !flex !flex-col !gap-6 items-center">
            <div className='text-muted text-sm'>or</div>
            <Button
              variant="transparent"
              hoverVariant="default"
              onClick={handleSkip}
              className='text-xs'
            >
              <div>
                Skip and just start a machine without a working agent
              </div>
            </Button>
          </DialogFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
