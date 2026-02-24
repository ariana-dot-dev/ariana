
import { RepositoryContainer } from '../data/repositories';
import type { User, JWTPayload, AgentAccessJWTPayload } from '../../shared/types';
import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { getLogger } from '../utils/logger';
import type { GitHubService } from './github.service';
import type { UserService } from './user.service';
import { UsageLimitsService } from './usageLimits.service';

const logger = getLogger(['auth']);

export class AuthService {
  private secret: string;

  constructor(
    private repositories: RepositoryContainer,
    private userService: UserService,
    private githubService: GitHubService,
    private usageLimits: UsageLimitsService
  ) {
    this.secret = this.getOrGenerateSecret();
  }

  private getOrGenerateSecret(): string {
    try {
      if (process.env.JWT_SECRET) {
        logger.info `JWT secret loaded from environment`;
        return process.env.JWT_SECRET;
      }

      const secret = randomBytes(32).toString('hex');

      logger.info `New JWT secret generated`;
      return secret;
    } catch (error) {
      logger.error `Failed to initialize JWT secret: ${error}`;
      throw new Error('JWT_SECRET_INITIALIZATION_FAILED: Cannot initialize JWT secret');
    }
  }


  async createJwtToken(userId: string): Promise<string> {
    try {
      const user = await this.userService.getUserById(userId);

      if (!user) {
        logger.error `User not found for JWT creation - userId: ${userId}`;
        throw new Error('JWT_USER_NOT_FOUND: User not found');
      }

      const jti = randomBytes(16).toString('hex');

      // JWT payload contains only user ID - no personal data
      const payload = {
        sub: userId,
        jti: jti
      };

      // 10 year expiration (effectively permanent)
      const token = jwt.sign(payload, this.secret, {
        algorithm: 'HS256',
        expiresIn: '87600h',
        issuer: 'ide2-backend',
        audience: 'ide2-frontend'
      });

      logger.info `JWT token created successfully - userId: ${userId}, jti: ${jti.substring(0, 8)}...`;

      return token;
    } catch (error) {
      logger.error `JWT token creation failed - error: ${error}, userId: ${userId}`;
      if (error instanceof Error && error.message.includes('JWT_')) {
        throw error;
      }
      throw new Error('JWT_CREATION_FAILED: Token creation failed');
    }
  }

  async validateJwtToken(token: string): Promise<{ user: User; jwt: JWTPayload } | null> {
    try {
      // Stateless validation - only verify signature and expiry
      const decoded = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: 'ide2-backend',
        audience: 'ide2-frontend'
      }) as JWTPayload;

      const user = await this.userService.getUserById(decoded.sub);
      if (!user) {
        throw new Error('JWT_USER_NOT_FOUND: User not found');
      }

      // logger.debug `JWT token verified successfully - userId: ${decoded.sub}, jti: ${decoded.jti?.substring(0, 8)}...`;

      return { user, jwt: decoded };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        // logger.debug `JWT token verification failed: expired - expiredAt: ${error.expiredAt}`;
        throw new Error('JWT_TOKEN_EXPIRED: Token has expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        // logger.debug `JWT token verification failed: invalid - reason: ${error.message}`;
        throw new Error(`JWT_TOKEN_INVALID: ${error.message}`);
      } else if (error instanceof jwt.NotBeforeError) {
        // logger.debug `JWT token verification failed: not active yet - date: ${error.date}`;
        throw new Error('JWT_TOKEN_NOT_ACTIVE: Token not active yet');
      } else if (error instanceof Error && error.message.includes('JWT_')) {
        throw error;
      } else {
        // logger.debug `JWT token verification failed: unknown error - error: ${error}`;
        throw new Error('JWT_VERIFICATION_FAILED: Token verification failed');
      }
    }
  }

  // GitHub App authorization flow
  async exchangeCodeForTokens(code: string, state: string): Promise<string> {
    try {
      logger.info `Received GitHub App callback - state: ${state.substring(0, 8)}..., code: ${code.substring(0, 8)}...`;

      // Exchange code for user access token using GitHub App
      const tokens = await this.githubService.exchangeCodeForToken(code);

      // Get user info from GitHub
      const githubUser = await this.githubService.getAuthenticatedUser(tokens.access_token);

      // Create GitHub profile ID from GitHub user ID
      const githubProfileId = `github_${githubUser.id}`;

      // Check if GitHub profile already exists
      const existingProfile = await this.repositories.githubProfiles.findById(githubProfileId);

      if (existingProfile) {
        // Update existing GitHub profile
        // Store login username in name field for admin checks
        await this.repositories.githubProfiles.update(githubProfileId, {
          name: githubUser.login,
          email: githubUser.email || `${githubUser.login}@github.local`,
          image: githubUser.avatar_url
        });

        // Update GitHub tokens for this profile
        await this.storeGitHubTokens(githubProfileId, tokens);

        // Find user linked to this GitHub profile
        const existingUser = await this.userService.findUserByGithubProfileId(githubProfileId);

        if (existingUser) {
          logger.info `Existing GitHub user re-login - userId: ${existingUser.id}, githubLogin: ${githubUser.login}`;
          const jwt = await this.createJwtToken(existingUser.id);
          return jwt;
        } else {
          // GitHub profile exists but no user linked - create new user
          const user = await this.userService.createUser({
            githubProfileId: githubProfileId
          });

          logger.info `New user created for existing GitHub profile - userId: ${user.id}, githubLogin: ${githubUser.login}`;
          const jwt = await this.createJwtToken(user.id);
          return jwt;
        }
      } else {
        // New GitHub profile - create profile, user, and tokens
        // Store login username in name field for admin checks
        const githubProfile = await this.repositories.githubProfiles.create({
          id: githubProfileId,
          name: githubUser.login,
          email: githubUser.email || `${githubUser.login}@github.local`,
          image: githubUser.avatar_url
        });

        const user = await this.userService.createUser({
          githubProfileId: githubProfile.id
        });

        // Initialize usage tracking
        await this.usageLimits.initializeUserUsage(user.id);

        await this.storeGitHubTokens(githubProfile.id, tokens, 'repo user:email read:org');

        logger.info `New GitHub user and profile created - userId: ${user.id}, githubLogin: ${githubUser.login}`;

        const jwt = await this.createJwtToken(user.id);
        return jwt;
      }
    } catch (error) {
      logger.error `GitHub App code exchange failed - error: ${error}, code: ${code.substring(0, 8)}...`;
      throw error;
    }
  }

  // Store GitHub tokens for a GitHub profile (helper method)
  private async storeGitHubTokens(githubProfileId: string, tokens: any, defaultScope = ''): Promise<void> {
    // First, delete any existing GitHub tokens for this profile
    await this.repositories.githubTokens.deleteAllUserTokens(githubProfileId);

    const githubTokenId = `gt_${githubProfileId.replace('github_', '')}_${Date.now()}`;
    // tokens.expires_in is in seconds, convert to milliseconds and create Date
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : undefined;

    await this.repositories.githubTokens.upsertToken({
      id: githubTokenId,
      userId: githubProfileId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      scope: tokens.scope || defaultScope,
      expiresAt: expiresAt
    });
  }

  // Create agent access JWT for sharing (read-only access)
  async createAgentAccessToken(agentId: string, access: 'read'): Promise<string> {
    try {
      const jti = randomBytes(16).toString('hex');

      // JWT payload - exp and iat are set automatically by jwt.sign
      const payload = {
        agentId,
        access,
        jti
      };

      // 30 day expiration for share links
      const token = jwt.sign(payload, this.secret, {
        algorithm: 'HS256',
        expiresIn: '30d',
        issuer: 'ide2-backend',
        audience: 'ide2-agent-access'
      });

      logger.info `Agent access token created - agentId: ${agentId}, access: ${access}, jti: ${jti.substring(0, 8)}...`;

      return token;
    } catch (error) {
      logger.error `Agent access token creation failed - error: ${error}, agentId: ${agentId}`;
      throw new Error('AGENT_ACCESS_TOKEN_CREATION_FAILED: Token creation failed');
    }
  }

  // Validate agent access JWT
  async validateAgentAccessToken(token: string): Promise<AgentAccessJWTPayload | null> {
    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: 'ide2-backend',
        audience: 'ide2-agent-access'
      }) as AgentAccessJWTPayload;

      logger.debug `Agent access token verified - agentId: ${decoded.agentId}, access: ${decoded.access}`;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        logger.debug `Agent access token expired - expiredAt: ${error.expiredAt}`;
      } else if (error instanceof jwt.JsonWebTokenError) {
        logger.debug `Agent access token invalid - reason: ${error.message}`;
      }
      return null;
    }
  }
}