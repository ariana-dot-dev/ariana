import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { useProviderStore } from '@/stores/useProviderStore';
import { apiRequest, authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { useIsBrowser } from './useIsBrowser';
import { openUrl } from '@tauri-apps/plugin-opener';
import { posthog } from '@/lib/posthog';

export interface ClaudeCodeProviderActions {
  // OAuth token actions
  connectOauth: () => Promise<void>;
  disconnectOauth: () => Promise<void>;
  cancelOauthConnection: () => void;
  giveOAuthToken: (code: string) => Promise<void>;

  // API key actions
  disconnectApiKey: () => Promise<void>;

  // State
  oauthConnectionState: {
    isConnecting: boolean;
    oauthUrl: string | null;
  };
}

export function useClaudeCodeProviderActions(): ClaudeCodeProviderActions {
  // OAuth state
  const [isConnectingOauth, setIsConnectingOauth] = useState(false);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);

  const isBrowser = useIsBrowser();

  // Get store actions
  const loadConfig = useProviderStore(state => state.loadConfig);

  const connectOauth = async () => {
    setIsConnectingOauth(true);

    try {
      posthog.capture('oauth_flow_started', {
        provider: 'claude-code',
        platform: isBrowser ? 'browser' : 'desktop'
      });

      // Start OAuth flow on backend
      const startData = await apiRequest<{ url: string; verifier: string }>(
        '/api/auth/claude-oauth/start',
        { method: 'POST' }
      );

      if (!startData?.url || !startData?.verifier) {
        throw new Error('Failed to start OAuth flow');
      }

      // Store verifier for callback
      const storage = localStorage || sessionStorage;
      storage.setItem('claude_pkce_verifier', startData.verifier);

      // Store the URL for fallback display (iOS Safari blocks window.open after await)
      setOauthUrl(startData.url);

      if (isBrowser) {
        // Open OAuth URL in new tab
        window.open(startData.url, '_blank');
      } else {
        await openUrl(startData.url);
      }
    } catch (error) {
      console.error('Claude OAuth error:', error);
      posthog.capture('oauth_flow_failed', {
        provider: 'claude-code',
        error: error instanceof Error ? error.message : 'unknown_error'
      });
      toast({ title: 'Error', description: 'Failed to connect Claude Code.', variant: 'destructive' });
      setIsConnectingOauth(false);
    }
  };

  const giveOAuthToken = async (code: string) => {
    try {
      const storage = localStorage || sessionStorage;
      const verifier = storage.getItem('claude_pkce_verifier') || '';
      if (!verifier) throw new Error('Missing OAuth verifier');

      await apiRequest('/api/auth/claude-oauth/callback', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim(), verifier })
      });

      // Refresh config to get updated OAuth status
      await loadConfig();

      posthog.capture('oauth_flow_succeeded', {
        provider: 'claude-code',
        platform: isBrowser ? 'browser' : 'desktop'
      });

      toast({ title: 'Success', description: 'Claude Code connected.' });
    } catch (error) {
      console.error('Failed to complete OAuth:', error);
      posthog.capture('oauth_flow_failed', {
        provider: 'claude-code',
        error: error instanceof Error ? error.message : 'unknown_error'
      });
      toast({ title: 'Error', description: 'Failed to complete OAuth flow.', variant: 'destructive' });
    } finally {
      setIsConnectingOauth(false);
    }
  };

  const cancelOauthConnection = () => {
    setIsConnectingOauth(false);
    setOauthUrl(null);
  };

  const disconnectOauth = async () => {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/auth/claude-token`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to remove OAuth token');
      }

      // Refresh config to get updated status
      await loadConfig();

      toast({
        title: 'Success',
        description: 'Claude Code token has been removed.',
      });
    } catch (error) {
      console.error('Error disconnecting Claude token:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove Claude Code token.',
        variant: 'destructive',
      });
    }
  };

  const disconnectApiKey = async () => {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/auth/anthropic-api-key`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to remove API key');
      }

      // Refresh config to get updated status
      await loadConfig();

      toast({
        title: 'Success',
        description: 'API key has been removed.',
      });
    } catch (error) {
      console.error('Error disconnecting API key:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove API key.',
        variant: 'destructive',
      });
    }
  };

  return {
    connectOauth,
    disconnectOauth,
    cancelOauthConnection,
    disconnectApiKey,
    giveOAuthToken,
    oauthConnectionState: {
      isConnecting: isConnectingOauth,
      oauthUrl,
    },
  };
}
