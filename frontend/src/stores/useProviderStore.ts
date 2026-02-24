import { create } from 'zustand';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';

// Types matching the backend AgentProviderConfig
export type AuthMethod = 'subscription' | 'api-key';
export type ApiKeyProvider = 'anthropic' | 'openrouter';

export interface SubscriptionCredentials {
  oauthToken?: string;
  refreshToken?: string;
  tokenExpiry?: string;
}

export interface ApiKeyCredentials {
  apiKey?: string;
}

export interface ApiKeyMethodConfig {
  activeProvider: ApiKeyProvider;
  anthropic: ApiKeyCredentials;
  openrouter: ApiKeyCredentials;
}

export interface ClaudeCodeConfig {
  activeAuthMethod: AuthMethod;
  subscription: SubscriptionCredentials;
  apiKey: ApiKeyMethodConfig;
}

export interface AgentProviderConfig {
  activeAgentType: 'claude-code';
  claudeCode: ClaudeCodeConfig;
}

// Default config
const DEFAULT_CONFIG: AgentProviderConfig = {
  activeAgentType: 'claude-code',
  claudeCode: {
    activeAuthMethod: 'subscription',
    subscription: {},
    apiKey: {
      activeProvider: 'anthropic',
      anthropic: {},
      openrouter: {}
    }
  }
};

// Helper functions
export function isSubscriptionConnected(config: AgentProviderConfig): boolean {
  return !!config.claudeCode.subscription.oauthToken;
}

export function isApiKeyConnected(config: AgentProviderConfig): boolean {
  const { activeProvider, anthropic, openrouter } = config.claudeCode.apiKey;
  if (activeProvider === 'anthropic') {
    return !!anthropic.apiKey;
  }
  return !!openrouter.apiKey;
}

export function isActiveMethodConnected(config: AgentProviderConfig): boolean {
  if (config.claudeCode.activeAuthMethod === 'subscription') {
    return isSubscriptionConnected(config);
  }
  return isApiKeyConnected(config);
}

interface ProviderStore {
  config: AgentProviderConfig;
  isLoading: boolean;
  error: string | null;

  loadConfig: () => Promise<void>;
  saveConfig: (updates: Partial<AgentProviderConfig>) => Promise<void>;
  setAuthMethod: (method: AuthMethod) => Promise<void>;
  setApiKeyProvider: (provider: ApiKeyProvider) => Promise<void>;
  saveApiKey: (apiKey: string) => Promise<void>;
  deleteApiKey: () => Promise<void>;
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  isLoading: false,
  error: null,

  loadConfig: async () => {
    set({ isLoading: true, error: null });

    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/auth/agent-provider-config`,
        { method: 'GET' }
      );

      if (response.ok) {
        const config = await response.json() as AgentProviderConfig;
        set({
          config,
          isLoading: false,
        });
      } else {
        console.error('Failed to load provider config:', response.statusText);
        set({ isLoading: false, error: 'Failed to load config' });
      }
    } catch (err) {
      console.error('Failed to load provider config:', err);
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load config',
      });
    }
  },

  saveConfig: async (updates) => {
    set({ isLoading: true, error: null });

    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/auth/agent-provider-config`,
        {
          method: 'POST',
          body: JSON.stringify(updates),
        }
      );

      if (response.ok) {
        const config = await response.json() as AgentProviderConfig;
        set({
          config,
          isLoading: false,
        });
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to save provider config:', errorData);
        set({ isLoading: false, error: errorData.error || 'Failed to save config' });
      }
    } catch (err) {
      console.error('Failed to save provider config:', err);
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to save config',
      });
    }
  },

  setAuthMethod: async (method: AuthMethod) => {
    const currentConfig = get().config;
    await get().saveConfig({
      claudeCode: {
        ...currentConfig.claudeCode,
        activeAuthMethod: method
      }
    });
  },

  setApiKeyProvider: async (provider: ApiKeyProvider) => {
    const currentConfig = get().config;
    await get().saveConfig({
      claudeCode: {
        ...currentConfig.claudeCode,
        apiKey: {
          ...currentConfig.claudeCode.apiKey,
          activeProvider: provider
        }
      }
    });
  },

  saveApiKey: async (apiKey: string) => {
    set({ isLoading: true, error: null });

    try {
      // Use the existing endpoint which now updates the active provider's apiKey
      const response = await authenticatedFetch(
        `${API_URL}/api/auth/anthropic-api-key`,
        {
          method: 'POST',
          body: JSON.stringify({ apiKey }),
        }
      );

      if (response.ok) {
        // Reload config to get updated state
        await get().loadConfig();
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to save API key:', errorData);
        set({ isLoading: false, error: errorData.error || 'Failed to save API key' });
        throw new Error(errorData.error || 'Failed to save API key');
      }
    } catch (err) {
      console.error('Failed to save API key:', err);
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to save API key',
      });
      throw err;
    }
  },

  deleteApiKey: async () => {
    set({ isLoading: true, error: null });

    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/auth/anthropic-api-key`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        // Reload config to get updated state
        await get().loadConfig();
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Failed to delete API key:', errorData);
        set({ isLoading: false, error: errorData.error || 'Failed to delete API key' });
      }
    } catch (err) {
      console.error('Failed to delete API key:', err);
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to delete API key',
      });
    }
  },
}));
