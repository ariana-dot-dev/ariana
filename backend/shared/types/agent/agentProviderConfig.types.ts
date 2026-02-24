// Agent Provider Configuration Types
// Single source of truth for all agent provider settings and credentials

// Subscription method credentials
export interface SubscriptionCredentials {
  oauthToken?: string;
  refreshToken?: string;
  tokenExpiry?: string; // ISO date string
}

// API key credentials for a specific provider
export interface ApiKeyCredentials {
  apiKey?: string;
}

// API key method configuration (all providers stored, one active)
export interface ApiKeyMethodConfig {
  activeProvider: 'anthropic' | 'openrouter';
  anthropic: ApiKeyCredentials;
  openrouter: ApiKeyCredentials;
}

// Claude Code agent configuration
export interface ClaudeCodeConfig {
  activeAuthMethod: 'subscription' | 'api-key';
  subscription: SubscriptionCredentials;
  apiKey: ApiKeyMethodConfig;
}

// Full agent provider configuration tree
export interface AgentProviderConfig {
  activeAgentType: 'claude-code';
  claudeCode: ClaudeCodeConfig;
}

// Default configuration
export const DEFAULT_AGENT_PROVIDER_CONFIG: AgentProviderConfig = {
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

// Helper to check if subscription is connected
export function isSubscriptionConnected(config: AgentProviderConfig): boolean {
  return !!config.claudeCode.subscription.oauthToken;
}

// Helper to check if active API key provider has credentials
export function isApiKeyConnected(config: AgentProviderConfig): boolean {
  const { activeProvider, anthropic, openrouter } = config.claudeCode.apiKey;
  if (activeProvider === 'anthropic') {
    return !!anthropic.apiKey;
  }
  return !!openrouter.apiKey;
}

// Helper to check if the active auth method is connected
export function isActiveMethodConnected(config: AgentProviderConfig): boolean {
  if (config.claudeCode.activeAuthMethod === 'subscription') {
    return isSubscriptionConnected(config);
  }
  return isApiKeyConnected(config);
}

// Helper to get active credentials as environment variables
export function getActiveEnvironment(config: AgentProviderConfig): Record<string, string> {
  const { activeAuthMethod, subscription, apiKey } = config.claudeCode;

  if (activeAuthMethod === 'subscription' && subscription.oauthToken) {
    return {
      CLAUDE_CODE_OAUTH_TOKEN: subscription.oauthToken
    };
  }

  if (activeAuthMethod === 'api-key') {
    const { activeProvider, anthropic, openrouter } = apiKey;

    if (activeProvider === 'openrouter' && openrouter.apiKey) {
      return {
        ANTHROPIC_BASE_URL: 'https://openrouter.ai/api',
        ANTHROPIC_AUTH_TOKEN: openrouter.apiKey,
        ANTHROPIC_API_KEY: ''
      };
    }

    if (activeProvider === 'anthropic' && anthropic.apiKey) {
      return {
        ANTHROPIC_API_KEY: anthropic.apiKey
      };
    }
  }

  return {};
}

// Helper to merge partial config with defaults (deep merge)
export function mergeWithDefaults(partial: Partial<AgentProviderConfig> | null | undefined): AgentProviderConfig {
  if (!partial) {
    return { ...DEFAULT_AGENT_PROVIDER_CONFIG };
  }

  return {
    activeAgentType: partial.activeAgentType || DEFAULT_AGENT_PROVIDER_CONFIG.activeAgentType,
    claudeCode: {
      activeAuthMethod: partial.claudeCode?.activeAuthMethod || DEFAULT_AGENT_PROVIDER_CONFIG.claudeCode.activeAuthMethod,
      subscription: {
        ...DEFAULT_AGENT_PROVIDER_CONFIG.claudeCode.subscription,
        ...partial.claudeCode?.subscription
      },
      apiKey: {
        activeProvider: partial.claudeCode?.apiKey?.activeProvider || DEFAULT_AGENT_PROVIDER_CONFIG.claudeCode.apiKey.activeProvider,
        anthropic: {
          ...DEFAULT_AGENT_PROVIDER_CONFIG.claudeCode.apiKey.anthropic,
          ...partial.claudeCode?.apiKey?.anthropic
        },
        openrouter: {
          ...DEFAULT_AGENT_PROVIDER_CONFIG.claudeCode.apiKey.openrouter,
          ...partial.claudeCode?.apiKey?.openrouter
        }
      }
    }
  };
}
