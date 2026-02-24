import { ServiceContainer } from '../../services';
import {
  handleGitHubAuthorize,
  handleGitHubCallback,
  handleSession,
  handleSaveClaudeToken,
  handleClaudeOAuthStart,
  handleClaudeOAuthCallback,
  handleClaudeOAuthRefresh,
  handleImportClaudeCliCredentials,
  type RequestContext
} from './handlers';
import { addCorsHeaders, requireAuthAsync, createAuthErrorResponse } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { createResourceRateLimit } from '../../middleware/rateLimit';
import type { AgentProviderConfig } from '../../../shared/types';
import { mergeWithDefaults } from '../../../shared/types';

export async function handleAuthRoutes(
  req: Request,
  url: URL,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  const context: RequestContext = { services, origin };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 200 }), origin);
  }

  // entrypoint for the github-based OAuth flow
  if (url.pathname === '/api/auth/sign-in/github' && req.method === 'GET') {
    return handleGitHubAuthorize(req, context);
  }

  if (url.pathname === '/api/auth/callback/github' && req.method === 'GET') {
    return handleGitHubCallback(req, context);
  }

  // Protected auth endpoints - require authentication
  const protectedPaths = [
    '/api/auth/session',
    '/api/auth/claude-token',
    '/api/auth/claude-token/status',
    '/api/auth/anthropic-api-key',
    '/api/auth/anthropic-api-key/status',
    '/api/auth/claude-oauth/start',
    '/api/auth/claude-oauth/callback',
    '/api/auth/claude-oauth/refresh',
    '/api/auth/claude-cli/import',
    '/api/auth/agent-provider-config'
  ];

  if (protectedPaths.some(path => url.pathname === path)) {
    let auth: AuthenticatedRequest;
    try {
      auth = await requireAuthAsync(req, services);
    } catch (error) {
      return createAuthErrorResponse(error as Error, origin);
    }

    // Check current session/authentication status
    if (url.pathname === '/api/auth/session' && req.method === 'GET') {
      return handleSession(req, context, auth);
    }

    // Unified agent provider config endpoint
    if (url.pathname === '/api/auth/agent-provider-config') {
      if (req.method === 'GET') {
        return handleGetAgentProviderConfig(auth, services, origin);
      }
      if (req.method === 'POST') {
        return handleSaveAgentProviderConfig(req, auth, services, origin);
      }
    }

    // Start Claude OAuth flow (returns URL and verifier)
    if (url.pathname === '/api/auth/claude-oauth/start' && req.method === 'POST') {
      return handleClaudeOAuthStart(req, context, auth);
    }

    // Exchange Claude OAuth code for tokens
    if (url.pathname === '/api/auth/claude-oauth/callback' && req.method === 'POST') {
      return handleClaudeOAuthCallback(req, context, auth);
    }

    // Refresh Claude OAuth tokens
    if (url.pathname === '/api/auth/claude-oauth/refresh' && req.method === 'POST') {
      return handleClaudeOAuthRefresh(req, context, auth);
    }

    // Import Claude CLI credentials from ~/.claude/.credentials.json
    if (url.pathname === '/api/auth/claude-cli/import' && req.method === 'POST') {
      return handleImportClaudeCliCredentials(req, context, auth);
    }

    // Save Claude Code OAuth token
    if (url.pathname === '/api/auth/claude-token' && req.method === 'POST') {
      return handleSaveClaudeToken(req, context, auth);
    }

    // Check Claude Code token status and refresh if needed
    if (url.pathname === '/api/auth/claude-token/status' && req.method === 'GET') {
      try {
        // Try to get a valid token (will refresh if needed)
        const validToken = await services.claudeOAuth.getValidAccessToken(auth.user.id);

        if (validToken) {
          // Token is valid or was successfully refreshed
          return addCorsHeaders(
            new Response(JSON.stringify({ hasToken: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }),
            origin
          );
        } else {
          // No token at all or refresh failed - check if we had tokens and clear them
          const config = await services.users.getAgentProviderConfig(auth.user.id);
          if (config.claudeCode.subscription.refreshToken) {
            // Had tokens but refresh failed - clear them
            await services.claudeOAuth.removeTokensForUser(auth.user.id);
            console.log(`Cleared expired OAuth tokens for user ${auth.user.id}`);
          }

          return addCorsHeaders(
            new Response(JSON.stringify({ hasToken: false }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }),
            origin
          );
        }
      } catch (error) {
        console.error('Error checking Claude token status:', error);
        return addCorsHeaders(
          new Response(JSON.stringify({ error: 'Failed to check token status' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      }
    }

    // Delete Claude Code token
    if (url.pathname === '/api/auth/claude-token' && req.method === 'DELETE') {
      try {
        await services.claudeOAuth.removeTokensForUser(auth.user.id);

        // Update credentials on all running agents with the new config
        try {
          const config = await services.users.getAgentProviderConfig(auth.user.id);
          const updateResult = await services.agents.updateCredentialsForUserAgentsWithConfig(
            auth.user.id,
            config
          );
          console.log(`Updated credentials on ${updateResult.success}/${updateResult.total} running agents`);
        } catch (error) {
          console.error('Failed to update credentials on running agents:', error);
        }

        return addCorsHeaders(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      } catch (error) {
        console.error('Error deleting Claude token:', error);
        return addCorsHeaders(
          new Response(JSON.stringify({ error: 'Failed to delete token' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      }
    }

    // Save Anthropic API key (updates the active provider's apiKey in config)
    if (url.pathname === '/api/auth/anthropic-api-key' && req.method === 'POST') {
      try {
        const body = await req.json();
        const { apiKey } = body;

        if (!apiKey || typeof apiKey !== 'string') {
          return addCorsHeaders(
            new Response(JSON.stringify({ error: 'API key is required' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            }),
            origin
          );
        }

        // Update the apiKey in the config for the active provider
        const config = await services.users.getAgentProviderConfig(auth.user.id);
        const activeProvider = config.claudeCode.apiKey.activeProvider;
        config.claudeCode.apiKey[activeProvider] = { apiKey };
        await services.users.setAgentProviderConfig(auth.user.id, config);

        // Update credentials on all running agents
        try {
          const updateResult = await services.agents.updateCredentialsForUserAgentsWithConfig(
            auth.user.id,
            config
          );
          console.log(`Updated credentials on ${updateResult.success}/${updateResult.total} running agents`);
        } catch (error) {
          console.error('Failed to update credentials on running agents:', error);
          // Don't fail the request - config is saved which is most important
        }

        return addCorsHeaders(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      } catch (error) {
        console.error('Error saving Anthropic API key:', error);
        return addCorsHeaders(
          new Response(JSON.stringify({ error: 'Failed to save API key' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      }
    }

    // Delete Anthropic API key (clears the active provider's apiKey in config)
    if (url.pathname === '/api/auth/anthropic-api-key' && req.method === 'DELETE') {
      try {
        // Clear the apiKey for the active provider
        const config = await services.users.getAgentProviderConfig(auth.user.id);
        const activeProvider = config.claudeCode.apiKey.activeProvider;
        config.claudeCode.apiKey[activeProvider] = {};
        await services.users.setAgentProviderConfig(auth.user.id, config);

        // Update credentials on all running agents
        try {
          const updateResult = await services.agents.updateCredentialsForUserAgentsWithConfig(
            auth.user.id,
            config
          );
          console.log(`Updated credentials on ${updateResult.success}/${updateResult.total} running agents`);
        } catch (error) {
          console.error('Failed to update credentials on running agents:', error);
        }

        return addCorsHeaders(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      } catch (error) {
        console.error('Error deleting Anthropic API key:', error);
        return addCorsHeaders(
          new Response(JSON.stringify({ error: 'Failed to delete API key' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      }
    }

    // Check Anthropic API key status (checks active provider's apiKey in config)
    if (url.pathname === '/api/auth/anthropic-api-key/status' && req.method === 'GET') {
      try {
        const config = await services.users.getAgentProviderConfig(auth.user.id);
        const activeProvider = config.claudeCode.apiKey.activeProvider;
        const hasApiKey = !!config.claudeCode.apiKey[activeProvider]?.apiKey;
        return addCorsHeaders(
          new Response(JSON.stringify({ hasApiKey }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      } catch (error) {
        console.error('Error checking Anthropic API key status:', error);
        return addCorsHeaders(
          new Response(JSON.stringify({ error: 'Failed to check API key status' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          }),
          origin
        );
      }
    }
  }

  // GitHub App installation callback page
  if (url.pathname === '/api/auth/installation/callback' && req.method === 'GET') {
    try {
      const filePath = new URL('../../../static/installation-callback.html', import.meta.url);
      const html = await Bun.file(filePath).text();

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      console.error('Error serving installation callback page:', error);
      return new Response('Installation callback page not found', { status: 404 });
    }
  }

  // Auth success/error pages
  if (url.pathname === '/auth/success' && req.method === 'GET') {
    try {
      const filePath = new URL('../../../static/auth-success.html', import.meta.url);
      const html = await Bun.file(filePath).text();

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      console.error('Error serving auth success page:', error);
      return new Response('Auth success page not found', { status: 404 });
    }
  }

  if (url.pathname === '/auth/error' && req.method === 'GET') {
    try {
      const filePath = new URL('../../../static/auth-error.html', import.meta.url);
      const html = await Bun.file(filePath).text();

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    } catch (error) {
      console.error('Error serving auth error page:', error);
      return new Response('Auth error page not found', { status: 404 });
    }
  }

  return null;
}

// GET /api/auth/agent-provider-config - returns the full config tree
async function handleGetAgentProviderConfig(
  auth: AuthenticatedRequest,
  services: ServiceContainer,
  origin: string | null
): Promise<Response> {
  try {
    // Get the full config (single source of truth)
    const config = await services.users.getAgentProviderConfig(auth.user.id);

    // Return the full config tree - frontend derives everything from this
    return addCorsHeaders(
      new Response(JSON.stringify(config), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }),
      origin
    );
  } catch (error) {
    console.error('Error getting agent provider config:', error);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Failed to get config' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }),
      origin
    );
  }
}

// POST /api/auth/agent-provider-config - update config (partial or full)
async function handleSaveAgentProviderConfig(
  req: Request,
  auth: AuthenticatedRequest,
  services: ServiceContainer,
  origin: string | null
): Promise<Response> {
  try {
    const body = await req.json() as Partial<AgentProviderConfig>;

    // Get current config and merge with updates
    const currentConfig = await services.users.getAgentProviderConfig(auth.user.id);
    const updatedConfig = mergeWithDefaults({
      ...currentConfig,
      ...body,
      claudeCode: {
        ...currentConfig.claudeCode,
        ...body.claudeCode,
        subscription: {
          ...currentConfig.claudeCode.subscription,
          ...body.claudeCode?.subscription
        },
        apiKey: {
          ...currentConfig.claudeCode.apiKey,
          ...body.claudeCode?.apiKey,
          anthropic: {
            ...currentConfig.claudeCode.apiKey.anthropic,
            ...body.claudeCode?.apiKey?.anthropic
          },
          openrouter: {
            ...currentConfig.claudeCode.apiKey.openrouter,
            ...body.claudeCode?.apiKey?.openrouter
          }
        }
      }
    });

    // Save the updated config
    await services.users.setAgentProviderConfig(auth.user.id, updatedConfig);

    // Update credentials on running agents
    try {
      const { environment } = await services.users.getActiveCredentials(auth.user.id);
      if (Object.keys(environment).length > 0) {
        const updateResult = await services.agents.updateCredentialsForUserAgentsWithConfig(
          auth.user.id,
          updatedConfig
        );
        console.log(`Updated credentials on ${updateResult.success}/${updateResult.total} running agents`);
      }
    } catch (error) {
      console.error('Failed to update credentials on running agents:', error);
      // Don't fail - config is saved which is most important
    }

    // Return the updated config
    return addCorsHeaders(
      new Response(JSON.stringify(updatedConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }),
      origin
    );
  } catch (error) {
    console.error('Error saving agent provider config:', error);
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Failed to save config' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }),
      origin
    );
  }
}
