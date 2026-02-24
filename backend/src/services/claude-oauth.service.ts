import * as crypto from "node:crypto";
import { getLogger } from '../utils/logger';
import type { RepositoryContainer } from '../data/repositories';
import { CLAUDE_CLIENT_ID } from '../config/constants.ts';
import type { UserService } from './user.service';

const logger = getLogger(['claude-oauth']);

// Claude Code OAuth constants
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const OAUTH_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const OAUTH_SCOPE = "org:create_api_key user:profile user:inference";

export interface ClaudeOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

export interface OAuthStartResponse {
  url: string;
  verifier: string;
}

interface ClaudeCodeAuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds
  token_type: string;
}

export class ClaudeOAuthService {
  private userService: UserService | null = null;

  constructor(private repositories: RepositoryContainer) {}

  // Set the user service (called after service container is initialized to avoid circular deps)
  setUserService(userService: UserService): void {
    this.userService = userService;
  }

  /**
   * Start the Claude Code OAuth flow
   * Returns the authorization URL and PKCE verifier (to be stored temporarily by client)
   */
  async startOAuthFlow(): Promise<OAuthStartResponse> {
    // Generate PKCE parameters for security
    const pkce = this.generatePKCEParams();

    const authParams = new URLSearchParams({
      code: "true",
      client_id: CLAUDE_CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: OAUTH_SCOPE,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      state: pkce.verifier, // Use verifier as state per Claude Code reference
    });

    const url = `${OAUTH_AUTHORIZE_URL}?${authParams.toString()}`;

    logger.info `OAuth flow started - challenge: ${pkce.challenge.substring(0, 8)}...`;

    return {
      url,
      verifier: pkce.verifier,
    };
  }

  /**
   * Exchange authorization code for access tokens
   */
  async exchangeCodeForTokens(
    code: string,
    verifier: string,
  ): Promise<ClaudeOAuthTokens> {
    // Parse code if it contains state (format: code#state)
    const [actualCode, state] = code.includes('#') ? code.split("#") : [code, verifier];

    logger.info `Exchanging code for tokens - code: ${actualCode.substring(0, 8)}...`;

    const response = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: actualCode,
        state: state || verifier,
        grant_type: "authorization_code",
        client_id: CLAUDE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error `Token exchange failed: ${errorText}`;
      throw new Error(
        `Token exchange failed: ${response.status} ${response.statusText}`,
      );
    }

    const tokenData = (await response.json()) as ClaudeCodeAuthResponse;

    logger.info `Token exchange successful - expires in ${tokenData.expires_in}s`;

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async renewCredentials(
    refreshToken: string,
  ): Promise<ClaudeOAuthTokens> {
    logger.info `Refreshing access token`;

    try {
      const response = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: CLAUDE_CLIENT_ID,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error `Token refresh failed: ${errorText}`;
        throw new Error(
          `Token refresh failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenData = (await response.json()) as ClaudeCodeAuthResponse;

      logger.info `Token refresh successful - expires in ${tokenData.expires_in}s`;

      return {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || refreshToken, // Use new refresh token if provided, else keep old one
        expiresAt: Date.now() + tokenData.expires_in * 1000,
      };
    } catch (error) {
      logger.error `Failed to refresh Claude Code token: ${error}`;
      throw error;
    }
  }

  /**
   * Get and refresh token if needed (with 5 minute buffer)
   */
  async getValidAccessToken(userId: string): Promise<string | null> {
    if (!this.userService) {
      logger.error `UserService not set - cannot get valid access token`;
      return null;
    }

    const config = await this.userService.getAgentProviderConfig(userId);
    const subscription = config.claudeCode.subscription;

    if (!subscription.oauthToken) {
      return null;
    }

    // Check if token needs refresh (5 minute buffer)
    const tokenExpiry = subscription.tokenExpiry ? new Date(subscription.tokenExpiry) : null;
    const needsRefresh = tokenExpiry
      ? tokenExpiry.getTime() <= Date.now() + 5 * 60 * 1000
      : false;

    if (needsRefresh && subscription.refreshToken) {
      try {
        logger.info `Token expired or expiring soon for user ${userId}, refreshing...`;
        const newTokens = await this.renewCredentials(subscription.refreshToken);

        // Update config with new tokens
        config.claudeCode.subscription = {
          oauthToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
          tokenExpiry: new Date(newTokens.expiresAt).toISOString(),
        };
        await this.userService.setAgentProviderConfig(userId, config);

        logger.info `Token refreshed successfully for user ${userId}`;
        return newTokens.accessToken;
      } catch (error) {
        logger.error `Failed to refresh token for user ${userId}: ${error}`;
        // Return null when refresh fails instead of returning the expired token
        return null;
      }
    } else if (needsRefresh) {
      logger.info `Token expired or expiring soon for user ${userId}, but no refresh token available`;
      return null;
    }

    return subscription.oauthToken;
  }

  /**
   * Save OAuth tokens for a user
   */
  async saveTokensForUser(userId: string, tokens: ClaudeOAuthTokens): Promise<void> {
    if (!this.userService) {
      logger.error `UserService not set - cannot save tokens`;
      throw new Error('UserService not initialized');
    }

    const config = await this.userService.getAgentProviderConfig(userId);
    config.claudeCode.subscription = {
      oauthToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiry: new Date(tokens.expiresAt).toISOString(),
    };
    await this.userService.setAgentProviderConfig(userId, config);

    logger.info `OAuth tokens saved for user ${userId}`;
  }

  /**
   * Remove OAuth tokens for a user
   */
  async removeTokensForUser(userId: string): Promise<void> {
    if (!this.userService) {
      logger.error `UserService not set - cannot remove tokens`;
      throw new Error('UserService not initialized');
    }

    const config = await this.userService.getAgentProviderConfig(userId);
    config.claudeCode.subscription = {};
    await this.userService.setAgentProviderConfig(userId, config);

    logger.info `OAuth tokens removed for user ${userId}`;
  }

  /**
   * Generate PKCE parameters for OAuth2 security
   */
  private generatePKCEParams(): { verifier: string; challenge: string } {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");

    return { verifier, challenge };
  }
}
