import { useState, useEffect } from 'react';
import { Loader2, CheckCircle, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useProviderStore,
  isSubscriptionConnected,
  isApiKeyConnected,
  type AuthMethod,
  type ApiKeyProvider
} from '@/stores/useProviderStore';
import { useClaudeCodeProviderActions } from '@/hooks/useClaudeCodeProviderActions';
import { SelectGroupRoot, SelectGroupOption } from '@/components/ui/select-group';
import { posthog } from '@/lib/posthog';

export function ClaudeProviderConfig() {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [oauthTokenInput, setOauthTokenInput] = useState('');
  const [copiedOauthUrl, setCopiedOauthUrl] = useState(false);

  const { config, isLoading, loadConfig, setAuthMethod, setApiKeyProvider, saveApiKey } = useProviderStore();
  const actions = useClaudeCodeProviderActions();

  // Derive values from the unified config tree
  const authMethod = config.claudeCode.activeAuthMethod;
  const apiKeyProvider = config.claudeCode.apiKey.activeProvider;
  const hasOAuthToken = isSubscriptionConnected(config);
  const hasApiKey = isApiKeyConnected(config);

  useEffect(() => {
    loadConfig();
    return () => {
      actions.cancelOauthConnection();
    };
  }, []);

  const handleAuthMethodChange = (value: string) => {
    setAuthMethod(value as AuthMethod);
  };

  const handleProviderChange = (value: string) => {
    setApiKeyProvider(value as ApiKeyProvider);
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;

    try {
      posthog.capture('api_key_save_started', { provider: apiKeyProvider });
      await saveApiKey(apiKeyInput.trim());
      posthog.capture('api_key_save_succeeded', { provider: apiKeyProvider });
      setApiKeyInput('');
    } catch (error) {
      console.error('Failed to save API key:', error);
      posthog.capture('api_key_save_failed', {
        provider: apiKeyProvider,
        error: error instanceof Error ? error.message : 'unknown'
      });
    }
  };

  const handleSaveOAuthToken = async () => {
    if (!oauthTokenInput.trim()) return;
    await actions.giveOAuthToken(oauthTokenInput.trim());
    setOauthTokenInput('');
  };

  const handleCopyOauthUrl = async () => {
    const url = actions.oauthConnectionState.oauthUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedOauthUrl(true);
      setTimeout(() => setCopiedOauthUrl(false), 2000);
    } catch (err) {
      console.error('Failed to copy OAuth URL:', err);
    }
  };

  const handleDisconnect = () => {
    if (authMethod === 'subscription') {
      actions.disconnectOauth();
    } else {
      actions.disconnectApiKey();
    }
  };

  const isConnected = authMethod === 'subscription'
    ? hasOAuthToken
    : hasApiKey;

  const getApiKeyLink = () => {
    return apiKeyProvider === 'openrouter'
      ? 'https://openrouter.ai/keys'
      : 'https://console.anthropic.com/settings/keys';
  };

  const getApiKeyPlaceholder = () => {
    return apiKeyProvider === 'openrouter'
      ? 'Enter your OpenRouter API key'
      : 'Enter your Anthropic API key';
  };

  return (
    <div className="flex flex-col gap-4 min-w-sm max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center p-1">
          <img
            src={`${import.meta.env.BASE_URL}claude-logo.png`}
            alt="Claude Code"
            className="w-full h-full object-contain"
          />
        </div>
        <div className="text-lg font-semibold">Claude Code</div>
      </div>

      {/* Auth Method Selector */}
      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">Authentication</div>
        <SelectGroupRoot
          className="w-full"
          rounded={false}
          value={authMethod}
          onValueChange={handleAuthMethodChange}
          orientation="horizontal"
        >
          <SelectGroupOption value="subscription" className="flex-1 h-7 !text-xs">
            Subscription
          </SelectGroupOption>
          <SelectGroupOption value="api-key" className="flex-1 h-7 !text-xs">
            API Key
          </SelectGroupOption>
        </SelectGroupRoot>
      </div>

      {/* Provider Selector (only for API Key) */}
      {authMethod === 'api-key' && (
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">Provider</div>
          <SelectGroupRoot
            className="w-full"
            rounded={false}
            value={apiKeyProvider}
            onValueChange={handleProviderChange}
            orientation="horizontal"
          >
            <SelectGroupOption value="anthropic" className="flex-1 h-7 !text-xs">
              Anthropic
            </SelectGroupOption>
            <SelectGroupOption value="openrouter" className="flex-1 h-7 !text-xs">
              OpenRouter
            </SelectGroupOption>
          </SelectGroupRoot>
          {apiKeyProvider === 'openrouter' && (
            <p className="text-xs text-muted-foreground">
              Use Claude through OpenRouter's API
            </p>
          )}
        </div>
      )}

      {/* Connection Status & Input */}
      <div className="flex flex-col gap-3 p-4 rounded-md bg-muted/10">
        <div className="flex flex-col justify-center gap-4">
          <div className="text-sm font-medium">
            {authMethod === 'subscription' ? 'Claude Subscription' : 'API Key'}
          </div>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </div>
          ) : isConnected ? (
            <div className="flex items-center gap-2 text-xs text-green-600">
              <CheckCircle className="h-4 w-4" />
              Connected
            </div>
          ) : authMethod === 'subscription' ? (
            <Button
              onClick={actions.connectOauth}
              variant="accent"
              size="sm"
              disabled={actions.oauthConnectionState.isConnecting}
            >
              {actions.oauthConnectionState.isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                'Step 1: Connect'
              )}
            </Button>
          ) : null}
        </div>

        {isConnected ? (
          <div className="flex flex-col gap-2">
            {authMethod === 'subscription' && (
              <p className="text-xs text-muted-foreground">
                Manage at{' '}
                <a
                  href="https://claude.ai/settings/claude-code"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  claude.ai/settings/claude-code
                </a>
              </p>
            )}
            <button
              onClick={handleDisconnect}
              className="text-xs w-fit text-muted-foreground underline"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex flex-1 min-w-0 flex-col gap-2">
            {authMethod === 'subscription' ? (
              <>
                {/* Fallback copiable link for iOS Safari (popup blocked after async) */}
                {actions.oauthConnectionState.oauthUrl && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground">
                      If the page didn't open, copy and open this link in a new tab:
                    </p>
                    <div className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md bg-muted/30">
                      <code className="flex-1 text-xs text-foreground/50 overflow-x-auto whitespace-nowrap">
                        {actions.oauthConnectionState.oauthUrl}
                      </code>
                      <button
                        onClick={handleCopyOauthUrl}
                        className="h-5 w-5 flex-shrink-0 hover:text-accent"
                      >
                        {copiedOauthUrl ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-end flex-1 min-w-0 gap-2">
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className='text-sm text-muted-foreground'>
                      Step 2: Paste the token given to you
                    </div>
                    <Input
                      type="password"
                      placeholder="paste token here"
                      value={oauthTokenInput}
                      onChange={(e) => setOauthTokenInput(e.target.value)}
                      className=""
                    />
                  </div>
                  <div className="flex-shrink-0 w-fit">
                    <Button onClick={handleSaveOAuthToken} disabled={isLoading}>
                      Confirm
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="password"
                      placeholder={getApiKeyPlaceholder()}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="flex-1"
                    />
                  </div>
                  <Button onClick={handleSaveApiKey} disabled={isLoading}>
                    Save
                  </Button>
                </div>
                <a
                  href={getApiKeyLink()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline"
                >
                  Get an API key
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
