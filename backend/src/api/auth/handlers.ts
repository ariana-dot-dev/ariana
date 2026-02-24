// Auth handlers - complete GitHub OAuth flow ported from old backend

import type { ServiceContainer } from '@/services';
import type { AuthAPI } from '@shared/types';
import { addCorsHeaders, createAuthErrorResponse } from '@/middleware/auth.ts';
import type { AuthenticatedRequest } from '@/middleware/auth.ts';
import { randomBytes } from 'crypto';
import { getLogger } from '@/utils/logger.ts';

const logger = getLogger(['api', 'auth']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

// GitHub App authorization
export async function handleGitHubAuthorize(
  req: Request,
  context: RequestContext
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const redirectPath = url.searchParams.get('redirect') || null;
    const useDeepLink = url.searchParams.get('deep_link') === 'true';

    // Generate state for CSRF protection, encoding redirect path
    const csrfToken = randomBytes(32).toString('hex');
    const stateData = {
      csrf: csrfToken,
      redirect: redirectPath,
      useDeepLink
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString('base64url');

    logger.info `Generated OAuth state - redirect: ${redirectPath || 'none'}, useDeepLink: ${useDeepLink}`;

    // Use GitHub App's OAuth flow for user authorization
    // Note: For GitHub Apps, permissions are configured in the App settings on GitHub.com,
    // not via the 'scope' parameter (which only works for OAuth Apps)
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', process.env.GITHUB_APP_CLIENT_ID!);
    authUrl.searchParams.set('redirect_uri', `${process.env.SERVER_URL}/api/auth/callback/github`);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('prompt', 'consent');

    const response: AuthAPI.SignInResponse = {
      url: authUrl.toString(),
      message: 'Open this URL in your browser to complete authentication'
    };

    return addCorsHeaders(Response.json(response), context.origin);
  } catch (error) {
    logger.error `GitHub App authorization failed: ${error}`;
    return addCorsHeaders(Response.json({
      error: 'GitHub App authorization failed',
      code: 'GITHUB_APP_AUTHORIZATION_FAILED'
    }, { status: 500 }), context.origin);
  }
}

/**
 * GitHub App callback handler
 */
export async function handleGitHubCallback(
  req: Request,
  context: RequestContext
): Promise<Response> {
  try {
    logger.info `GitHub App callback received`;

    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    logger.info `GitHub callback received - code: ${code}, state: ${state}`;

    if (!code || !state) {
      logger.error `GitHub callback missing required parameters - hasCode: ${!!code}, hasState: ${!!state}`;
      return Response.redirect('/auth/error?error=missing_parameters');
    }

    // Decode state to get redirect path and useDeepLink
    let redirectPath: string | null = null;
    let useDeepLink = false;

    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
      redirectPath = stateData.redirect || null;
      useDeepLink = stateData.useDeepLink || false;
    } catch (e) {
      logger.warn `Failed to decode state, using defaults: ${(e as any).message}`;
    }

    const jwt = await context.services.auth.exchangeCodeForTokens(code, state);

    logger.info `GitHub App auth completed successfully, redirecting to: ${redirectPath || '/auth/success'}`;

    // If there's a custom redirect, redirect there with JWT in query params
    if (redirectPath) {
      // Check if redirectPath is already a full URL
      const isFullUrl = redirectPath.startsWith('http://') || redirectPath.startsWith('https://');
      const fullRedirectUrl = isFullUrl
        ? `${redirectPath}?token=${encodeURIComponent(jwt)}`
        : `${process.env.SERVER_URL}${redirectPath}?token=${encodeURIComponent(jwt)}`;
      return Response.redirect(fullRedirectUrl);
    }

    // Check if we should use deep link
    if (useDeepLink) {
      // Redirect to deep link for desktop app
      return Response.redirect(`ariana-ide://auth?token=${encodeURIComponent(jwt)}`);
    } else {
      // Fallback to web page for manual copy
      return Response.redirect(`/auth/success?token=${encodeURIComponent(jwt)}`);
    }
  } catch (error) {
    logger.error `GitHub callback failed: ${error}`;

    let errorCode = 'github_app_failed';
    if (error instanceof Error) {
      if (error.message.includes('GITHUB_APP_INVALID_STATE')) {
        errorCode = 'invalid_state';
      } else if (error.message.includes('GITHUB_APP_TOKEN_EXCHANGE_FAILED')) {
        errorCode = 'token_exchange_failed';
      }
    }

    return Response.redirect(`/auth/error?error=${errorCode}`);
  }
}

export async function handleSession(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info `Session check requested`;

    logger.info `Valid session found - userId: ${auth.user.id}`;

    const user = await context.services.users.getUserById(auth.user.id);

    const userResponse: {
      id: string;
      name?: string;
      email?: string;
      image?: string;
      isAnonymous?: boolean;
    } = {
      id: auth.user.id,
      isAnonymous: user?.isAnonymous || false
    };

    const githubProfile = await context.services.github.getUserGithubProfile(auth.user.id);
    if (githubProfile) {
      userResponse.name = githubProfile.name;
      userResponse.email = githubProfile.email;
      userResponse.image = githubProfile.image || undefined;
    }

    const response: AuthAPI.SessionResponse = {
      user: userResponse,
      authenticated: true,
      jwt: {
        issuedAt: new Date(auth.jwt.iat * 1000).toISOString(),
        expiresAt: new Date(auth.jwt.exp * 1000).toISOString()
      }
    };

    return addCorsHeaders(Response.json(response), context.origin);
  } catch (error) {
    logger.error `Session check failed: ${error}`;
    const response: AuthAPI.SessionResponse = {
      user: null,
      authenticated: false,
      error: 'Session check failed'
    };
    return addCorsHeaders(Response.json(response), context.origin);
  }
}

export async function handleSaveClaudeToken(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json();
    const { token } = body as { token: string };

    if (!token) {
      return addCorsHeaders(Response.json({
        error: 'Token is required',
        code: 'MISSING_TOKEN'
      }, { status: 400 }), context.origin);
    }

    // Save the token to the user
    const user = await context.services.agents.saveClaudeCodeOauthToken(auth.user.id, token);

    if (!user) {
      return addCorsHeaders(Response.json({
        error: 'Failed to save token',
        code: 'SAVE_FAILED'
      }, { status: 500 }), context.origin);
    }

    logger.info `Claude token saved successfully for user: ${auth.user.id}`;

    // Update credentials on all running agents
    try {
      const config = await context.services.users.getAgentProviderConfig(auth.user.id);
      const updateResult = await context.services.agents.updateCredentialsForUserAgentsWithConfig(
        auth.user.id,
        config
      );
      logger.info `Updated credentials on ${updateResult.success}/${updateResult.total} running agents`;
    } catch (error) {
      logger.error `Failed to update credentials on running agents: ${error}`;
      // Don't fail the request - token is saved in DB which is most important
    }

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Claude token saved successfully'
    }), context.origin);
  } catch (error) {
    logger.error `Save Claude token failed: ${error}`;
    return createAuthErrorResponse(error as Error, context.origin);
  }
}

// === Claude OAuth (PKCE) endpoints ===

/**
 * Start Claude OAuth flow. Returns { url, verifier }.
 */
export async function handleClaudeOAuthStart(
  _req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const { url, verifier } = await context.services.claudeOAuth.startOAuthFlow();

    return addCorsHeaders(Response.json({ url, verifier }), context.origin);
  } catch (error) {
    logger.error`Claude OAuth start failed: ${error}`;
    return addCorsHeaders(Response.json({ error: 'CLAUDE_OAUTH_START_FAILED' }, { status: 500 }), context.origin);
  }
}

/**
 * Callback to exchange code + verifier for tokens and persist.
 */
export async function handleClaudeOAuthCallback(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json();
    const { code, verifier } = body as { code?: string; verifier?: string };

    if (!code || !verifier) {
      return addCorsHeaders(Response.json({ error: 'MISSING_PARAMETERS' }, { status: 400 }), context.origin);
    }

    const tokens = await context.services.claudeOAuth.exchangeCodeForTokens(code, verifier);
    await context.services.claudeOAuth.saveTokensForUser(auth.user.id, tokens);

    // Update credentials on running agents using fresh config
    try {
      const config = await context.services.users.getAgentProviderConfig(auth.user.id);
      await context.services.agents.updateCredentialsForUserAgentsWithConfig(
        auth.user.id,
        config
      );
    } catch (e) {
      logger.warn`Failed to update credentials on running agents after OAuth: ${e}`;
    }

    return addCorsHeaders(Response.json({ success: true }), context.origin);
  } catch (error) {
    logger.error`Claude OAuth callback failed: ${error}`;
    return addCorsHeaders(Response.json({ error: 'CLAUDE_OAUTH_CALLBACK_FAILED' }, { status: 500 }), context.origin);
  }
}

/**
 * Attempt to refresh Claude OAuth credentials for current user.
 */
export async function handleClaudeOAuthRefresh(
  _req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const config = await context.services.users.getAgentProviderConfig(auth.user.id);
    const refreshToken = config.claudeCode.subscription.refreshToken;
    if (!refreshToken) {
      return addCorsHeaders(Response.json({ refreshed: false, reason: 'NO_REFRESH_TOKEN' }), context.origin);
    }

    const newTokens = await context.services.claudeOAuth.renewCredentials(refreshToken);
    await context.services.claudeOAuth.saveTokensForUser(auth.user.id, newTokens);

    return addCorsHeaders(Response.json({ refreshed: true }), context.origin);
  } catch (error) {
    logger.error`Claude OAuth refresh failed: ${error}`;
    return addCorsHeaders(Response.json({ refreshed: false }), context.origin);
  }
}

/**
 * Import Claude CLI credentials from ~/.claude/.credentials.json
 * This allows existing Claude CLI users to use their credentials without going through OAuth
 */
export async function handleImportClaudeCliCredentials(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json();
    const { token, expiresAt } = body as { token?: string; expiresAt?: number };

    if (!token || !expiresAt) {
      return addCorsHeaders(Response.json({ error: 'MISSING_PARAMETERS' }, { status: 400 }), context.origin);
    }

    logger.info`Importing Claude CLI credentials for user ${auth.user.id}`;

    // Store the CLI token as an OAuth token (they're compatible)
    // We treat the CLI session token as an access token
    await context.services.claudeOAuth.saveTokensForUser(auth.user.id, {
      accessToken: token,
      refreshToken: undefined, // CLI tokens don't have refresh tokens
      expiresAt: expiresAt,
    });

    // Update credentials on running agents
    try {
      const config = await context.services.users.getAgentProviderConfig(auth.user.id);
      await context.services.agents.updateCredentialsForUserAgentsWithConfig(
        auth.user.id,
        config
      );
    } catch (e) {
      logger.warn`Failed to update credentials on running agents after CLI import: ${e}`;
    }

    logger.info`Successfully imported Claude CLI credentials for user ${auth.user.id}`;
    return addCorsHeaders(Response.json({ success: true, imported: true }), context.origin);
  } catch (error) {
    logger.error`Import Claude CLI credentials failed: ${error}`;
    return addCorsHeaders(Response.json({ error: "IMPORT_CLI_CREDENTIALS_FAILED" }, { status: 500 }), context.origin);
  }
}
