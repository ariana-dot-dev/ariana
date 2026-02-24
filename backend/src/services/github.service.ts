import type {RepositoryContainer} from '../data/repositories';
import {
  type Installation,
  type InstallationRepository,
  type InstallationsResponse,
  InstallationType,
} from '../../shared/types';
import { Octokit } from '@octokit/rest';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import type {AccessLevel, GithubIssueMention, GitHubProfile, Repository} from '../../shared/types';
import { ProjectRole } from '../../shared/types';
import { getLogger } from '../utils/logger';
import type { UserService } from './user.service';

const logger = getLogger(['github']);

interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret?: string;
}

interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface GitHubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

// Rate limit tracking (kept in-memory per worker - acceptable since each worker
// will quickly learn the rate limit state after a failed request)
interface RateLimitState {
  isLimited: boolean;
  resetAt: number; // Unix timestamp in ms
  backoffUntil: number; // When to stop backing off
}

const ISSUES_CACHE_TTL = 60 * 1000; // 60 seconds cache
const RATE_LIMIT_BACKOFF_BASE = 30 * 1000; // 30 seconds base backoff
const RATE_LIMIT_BACKOFF_MAX = 5 * 60 * 1000; // 5 minutes max backoff
const REPOSITORIES_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache for repository lists
const BRANCHES_CACHE_TTL = 2 * 60 * 1000; // 2 minutes cache for branch lists

interface RepositoriesCacheEntry {
  repositories: any;
  timestamp: number;
}

interface BranchesCacheEntry {
  branches: any;
  timestamp: number;
}

export class GitHubService {
  private appConfig: GitHubAppConfig;

  // Rate limit state per user (in-memory per worker)
  private rateLimitState: Map<string, RateLimitState> = new Map();

  // Cache for repository lists per user (in-memory per worker)
  private repositoriesCache: Map<string, RepositoriesCacheEntry> = new Map();

  // Cache for branch lists per repo (in-memory per worker)
  private branchesCache: Map<string, BranchesCacheEntry> = new Map();

  constructor(
    private repositories: RepositoryContainer,
    private userService: UserService
  ) {
    // Load GitHub App configuration from environment
    this.appConfig = {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
      clientId: process.env.GITHUB_APP_CLIENT_ID!,
      clientSecret: process.env.GITHUB_APP_CLIENT_SECRET!,
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET
    };
    
    if (!this.appConfig.appId || !this.appConfig.privateKey || !this.appConfig.clientId || !this.appConfig.clientSecret) {
      logger.error `GitHub App configuration incomplete`;
      throw new Error('GITHUB_APP_CONFIG_ERROR: Missing required GitHub App environment variables');
    }

    logger.info `GitHub App initialized - appId: ${this.appConfig.appId}, clientId: ${this.appConfig.clientId}`;
  }

  async getRepositoryIssues(userId: string, repositoryFullName: string) {
    // Cache key: issues are per-repo (not per-user) since issues are the same for all users
    const cacheKey = `issues:${repositoryFullName}`;
    const now = Date.now();

    // Check if we're rate limited and should back off
    const rateLimitState = this.rateLimitState.get(userId);
    if (rateLimitState && rateLimitState.backoffUntil > now) {
      // Return cached data if available (even if expired), otherwise empty array
      const cached = await this.repositories.githubCache.getEvenIfExpired(cacheKey);
      if (cached) {
        logger.debug `Returning cached issues during rate limit backoff - repo: ${repositoryFullName}, backoffRemaining: ${Math.round((rateLimitState.backoffUntil - now) / 1000)}s`;
        return JSON.parse(cached.data);
      }
      logger.warn `Rate limited with no cache available - repo: ${repositoryFullName}, backoffRemaining: ${Math.round((rateLimitState.backoffUntil - now) / 1000)}s`;
      return [];
    }

    // Check database cache first
    const cached = await this.repositories.githubCache.get(cacheKey);
    if (cached) {
      const cacheAge = Math.round((now - (cached.updatedAt?.getTime() || now)) / 1000);
      logger.debug `Returning cached issues - repo: ${repositoryFullName}, cacheAge: ${cacheAge}s`;
      return JSON.parse(cached.data);
    }

    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken,
      });

      const [owner, repo] = repositoryFullName.split('/');

      const { data: issues } = await octokit.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        per_page: 100,
        sort: 'created',
        direction: 'desc'
      });

      const mappedIssues = issues.map(issue => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        url: issue.html_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at
      }));

      // Update database cache
      await this.repositories.githubCache.set({
        cacheKey,
        endpoint: 'issues.listForRepo',
        data: JSON.stringify(mappedIssues),
        ttlMs: ISSUES_CACHE_TTL
      });

      // Clear rate limit state on successful request
      this.rateLimitState.delete(userId);

      return mappedIssues;
    } catch (error: any) {
      // Handle rate limit errors with exponential backoff
      if (error?.status === 403 && error?.response?.headers) {
        const rateLimitRemaining = error.response.headers['x-ratelimit-remaining'];
        const rateLimitReset = error.response.headers['x-ratelimit-reset'];

        if (rateLimitRemaining === '0' || error.message?.includes('rate limit')) {
          const resetAt = rateLimitReset ? parseInt(rateLimitReset) * 1000 : now + RATE_LIMIT_BACKOFF_BASE;

          // Calculate backoff with exponential increase
          const currentState = this.rateLimitState.get(userId);
          const previousBackoff = currentState?.backoffUntil ? currentState.backoffUntil - now : 0;
          const newBackoff = Math.min(
            Math.max(previousBackoff * 2, RATE_LIMIT_BACKOFF_BASE),
            RATE_LIMIT_BACKOFF_MAX
          );

          this.rateLimitState.set(userId, {
            isLimited: true,
            resetAt,
            backoffUntil: now + newBackoff
          });

          logger.warn `GitHub rate limit hit - userId: ${userId}, repo: ${repositoryFullName}, backoff: ${Math.round(newBackoff / 1000)}s, resetAt: ${new Date(resetAt).toISOString()}`;

          // Return cached data if available (even if expired)
          const staleCache = await this.repositories.githubCache.getEvenIfExpired(cacheKey);
          if (staleCache) {
            logger.info `Returning stale cached issues after rate limit - repo: ${repositoryFullName}`;
            return JSON.parse(staleCache.data);
          }

          return [];
        }
      }

      logger.error `Failed to fetch repository issues - userId: ${userId}, repo: ${repositoryFullName}, error: ${getErrorMessage(error)}`;
      throw error;
    }
  }

  async getIssue(userId: string, owner: string, repo: string, issueNumber: number): Promise<GithubIssueMention> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken,
      });

      const { data: issue } = await octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber
      });

      return {
        title: issue.title,
        body: issue.body || ''
      };

    } catch (error) {
      logger.error `Failed to fetch issue - userId: ${userId}, owner: ${owner}, repo: ${repo}, issue: ${issueNumber}, error: ${getErrorMessage(error)}`;
      throw error;
    }
  }

  async getAllAccessibleRepositoriesForUser(userId: string): Promise<any> {
    try {
      // Check cache first
      const now = Date.now();
      const cached = this.repositoriesCache.get(userId);
      if (cached && (now - cached.timestamp) < REPOSITORIES_CACHE_TTL) {
        logger.info `Returning cached repositories for user ${userId} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`;
        return cached.repositories;
      }

      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      const accessibleRepositories: InstallationRepository[] = [];

      // STEP 1: Get repositories where GitHub App has been granted access
      // These repos have the app's permissions (read/write based on what was granted)
      try {
        const installationsResponse = await octokit.rest.apps.listInstallationsForAuthenticatedUser();
        const installations = installationsResponse.data.installations;

        for (const installation of installations) {
          try {
            const reposResponse = await octokit
                .rest
                .apps
                .listInstallationReposForAuthenticatedUser({
                  installation_id: installation.id,
                  per_page: 100
                });

            const repositories: InstallationRepository[] = reposResponse.data.repositories.map(this.toInstallationRepository);

            accessibleRepositories.push(...repositories);

          } catch (installationError) {
            logger.error `Failed to fetch repos for installation ${installation.id} - error: ${getErrorMessage(installationError)}`;
          }
        }
      } catch (error) {
        logger.warn `Failed to fetch GitHub App installations - error: ${getErrorMessage(error)}`;
      }

      // Track which repos are already in the list (have app access)
      const appAccessRepoIds = new Set(accessibleRepositories.map(r => r.id));

      // STEP 2: Get user's own public repos + org repos where user contributed
      // The app only has READ access to these (via user's OAuth token)
      try {
        const graphqlWithAuth = graphql.defaults({
          headers: {
            authorization: `token ${userTokens.accessToken}`,
          },
        });

        // Get user's own public repos + contributed org repos in one query
        const reposQuery = `
          query {
            viewer {
              login
              repositories(first: 100, privacy: PUBLIC, ownerAffiliations: [OWNER]) {
                nodes { databaseId name nameWithOwner description url pushedAt isPrivate }
              }
              repositoriesContributedTo(first: 100, privacy: PUBLIC, contributionTypes: [COMMIT, PULL_REQUEST, ISSUE]) {
                nodes { databaseId name nameWithOwner description url pushedAt isPrivate owner { login } }
              }
            }
          }
        `;
        const result = await graphqlWithAuth(reposQuery) as any;
        const username = result.viewer.login;

        for (const repo of result.viewer.repositories.nodes) {
          if (!appAccessRepoIds.has(repo.databaseId)) {
            accessibleRepositories.push({
              id: repo.databaseId, name: repo.name, fullName: repo.nameWithOwner,
              description: repo.description, url: repo.url, private: repo.isPrivate,
              permissions: 'read', pushedAt: repo.pushedAt,
            });
          }
        }

        for (const repo of result.viewer.repositoriesContributedTo.nodes) {
          if (repo.owner.login !== username && !appAccessRepoIds.has(repo.databaseId)) {
            accessibleRepositories.push({
              id: repo.databaseId, name: repo.name, fullName: repo.nameWithOwner,
              description: repo.description, url: repo.url, private: repo.isPrivate,
              permissions: 'read', pushedAt: repo.pushedAt,
            });
          }
        }
      } catch (error) {
        logger.warn `Failed to fetch public repositories via GraphQL - error: ${getErrorMessage(error)}`;
      }

      const result = { repositories: accessibleRepositories };

      // Store in cache
      this.repositoriesCache.set(userId, {
        repositories: result,
        timestamp: Date.now()
      });
      logger.info `Cached ${accessibleRepositories.length} repositories for user ${userId}`;

      return result;
    } catch (error) {
      logger.error `Failed to fetch accessible repositories - error: ${getErrorMessage(error)}, userId: ${userId}`;
      throw error;
    }
  }

  /**
   * Search repositories by filtering the user's accessible repos. Returns up to limit results.
   */
  async searchRepositories(userId: string, query: string, limit: number = 50): Promise<InstallationRepository[]> {
    // Get all accessible repos (will use cache if available)
    const allReposResponse = await this.getAllAccessibleRepositoriesForUser(userId);
    const allRepositories = allReposResponse.repositories || [];

    // Filter by search term
    const searchLower = query.toLowerCase();
    const filtered = allRepositories.filter((repo: InstallationRepository) =>
      repo.name.toLowerCase().includes(searchLower) ||
      repo.fullName.toLowerCase().includes(searchLower) ||
      (repo.description && repo.description.toLowerCase().includes(searchLower))
    );

    // Return top results by most recent push
    return filtered
      .sort((a: InstallationRepository, b: InstallationRepository) => {
        const dateA = a.pushedAt ? new Date(a.pushedAt).getTime() : 0;
        const dateB = b.pushedAt ? new Date(b.pushedAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, limit);
  }

  /**
   * Search branches directly via GitHub's API. No caching — returns fresh results.
   */
  async searchBranches(userId: string, repoFullName: string, query: string, limit: number = 50): Promise<any[]> {
    const userTokens = await this.getUserTokens(userId);
    if (!userTokens) {
      throw new Error('GITHUB_AUTH_REQUIRED');
    }

    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      throw new Error('Invalid repository format. Expected: owner/repo');
    }

    // GitHub doesn't have a branch search API, so fetch all and filter
    const octokit = new Octokit({ auth: userTokens.accessToken });
    const allBranches: any[] = [];
    let page = 1;
    const queryLower = query.toLowerCase();

    while (true) {
      const response = await octokit.request('GET /repos/{owner}/{repo}/branches', {
        owner, repo, per_page: 100, page,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' }
      });
      for (const branch of response.data) {
        if (branch.name.toLowerCase().includes(queryLower)) {
          allBranches.push(branch);
          if (allBranches.length >= limit) break;
        }
      }
      if (response.data.length < 100 || allBranches.length >= limit) break;
      page++;
    }

    return allBranches;
  }

  async getGroupedInstallations(userId: string): Promise<InstallationsResponse> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      // First get all installations for the user
      const installationsResponse = await octokit.rest.apps.listInstallationsForAuthenticatedUser();
      const installations = installationsResponse.data.installations;
      const groupedInstallations: Installation[] = [];

      // For each installation, get the repositories and group them
      for (const installation of installations) {
        try {
          const reposResponse = await octokit
              .rest
              .apps
              .listInstallationReposForAuthenticatedUser({
            installation_id: installation.id,
          });

          const repositories: InstallationRepository[] = reposResponse.data.repositories.map(this.toInstallationRepository);

          const installationType: InstallationType = installation.target_type === 'Organization'
              ? InstallationType.Organization
              : InstallationType.User;

          groupedInstallations.push({
            type: installationType,
            // @ts-ignore idk why typescript yellows about the login here
            accountLogin: installation.account.login,
            accountAvatarUrl: installation.account?.avatar_url || null,
            repositories
          });


        } catch (installationError) {
          logger.error `Failed to fetch repos for installation ${installation.id} - error: ${getErrorMessage(installationError)}`;
          // Continue with other installations even if one fails
        }
      }
      return { installations: groupedInstallations };
    } catch (error) {
      logger.error `Failed to fetch grouped installations - error: ${getErrorMessage(error)}, userId: ${userId}`;
      throw error;
    }
  }

  toInstallationRepository(repo: RestEndpointMethodTypes["apps"]["listInstallationReposForAuthenticatedUser"]["response"]['data']['repositories'][0]): InstallationRepository {
    let accessLevel: AccessLevel = 'read';
    if (repo.permissions?.push || repo.permissions?.admin || repo.permissions?.maintain) {
      accessLevel = 'write';
    }

    return {
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      url: repo.html_url,
      private: repo.private,
      permissions: accessLevel,
      pushedAt: repo.pushed_at,
    };
  }

  async getRepositoryBranches(userId: string, repoFullName: string) {
    try {
      // Check cache first
      const cacheKey = `${userId}:${repoFullName}`;
      const now = Date.now();
      const cached = this.branchesCache.get(cacheKey);
      if (cached && (now - cached.timestamp) < BRANCHES_CACHE_TTL) {
        logger.info `Returning cached branches for ${repoFullName} (age: ${Math.round((now - cached.timestamp) / 1000)}s)`;
        return cached.branches;
      }

      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      const [owner, repo] = repoFullName.split('/');
      if (!owner || !repo) {
        throw new Error('Invalid repository format. Expected: owner/repo');
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken,
        userAgent: 'IDE2-App'
      });

      logger.info(`Fetching branches for ${owner}/${repo} using Octokit`);

      const allBranches: any[] = [];
      let page = 1;
      while (true) {
        const response = await octokit.request('GET /repos/{owner}/{repo}/branches', {
          owner,
          repo,
          per_page: 100,
          page,
          headers: {
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });
        allBranches.push(...response.data);
        if (response.data.length < 100) break;
        page++;
      }

      logger.info(`Successfully fetched ${allBranches.length} branches`);

      // Store in cache
      this.branchesCache.set(cacheKey, {
        branches: allBranches,
        timestamp: Date.now()
      });

      return allBranches;
    } catch (error) {
      logger.error(`Error fetching repository branches: ${getErrorMessage(error)}`);

      const err = error as any;
      if (err?.status === 404) {
        throw new Error(`Repository not found: ${repoFullName}`);
      } else if (err?.status === 403) {
        throw new Error(`Access denied to repository: ${repoFullName}. Check permissions and token scope.`);
      } else {
        throw new Error(`GitHub API error: ${err?.status || 'unknown'} - ${getErrorMessage(error)}`);
      }
    }
  }

  async deleteBranch(userId: string, repoFullName: string, branchName: string) {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      const [owner, repo] = repoFullName.split('/');
      if (!owner || !repo) {
        throw new Error('Invalid repository format. Expected: owner/repo');
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      logger.info(`Deleting branch ${branchName} in ${owner}/${repo} using Octokit`);

      await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
        owner,
        repo,
        ref: `heads/${branchName}`,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      logger.info(`Successfully deleted branch ${branchName}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting branch: ${getErrorMessage(error)}`);
      
      const err = error as any;
      if (err?.status === 404) {
        throw new Error(`Repository or branch not found: ${repoFullName}/${branchName}`);
      } else if (err?.status === 403) {
        throw new Error(`Access denied to repository: ${repoFullName}. Check permissions and token scope.`);
      } else if (err?.status === 422) {
        throw new Error(`Cannot delete branch ${branchName} - it may be protected or the default branch`);
      } else {
        throw new Error(`GitHub API error: ${err?.status || 'unknown'} - ${getErrorMessage(error)}`);
      }
    }
  }

  /**
   * Refresh GitHub access token using refresh token
   * @private
   */
  private async refreshGitHubToken(
    githubProfileId: string,
    refreshToken: string
  ): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type: string;
  } | null> {
    const startTime = Date.now();
    logger.info `[GitHub Token Refresh] Starting token refresh for profile ${githubProfileId}`;
    logger.info `[GitHub Token Refresh] Using refresh token: ${refreshToken.substring(0, 10)}...`;
    logger.info `[GitHub Token Refresh] Client ID: ${this.appConfig.clientId}`;

    try {
      logger.info `[GitHub Token Refresh] Sending POST request to GitHub OAuth endpoint`;

      const requestBody = {
        client_id: this.appConfig.clientId,
        client_secret: this.appConfig.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      };

      logger.info `[GitHub Token Refresh] Request body prepared (client_secret hidden)`;

      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const elapsed = Date.now() - startTime;
      logger.info `[GitHub Token Refresh] Received response in ${elapsed}ms - status: ${tokenResponse.status}`;

      if (!tokenResponse.ok) {
        const responseText = await tokenResponse.text();
        logger.error `[GitHub Token Refresh] FAILED - HTTP ${tokenResponse.status} ${tokenResponse.statusText}`;
        logger.error `[GitHub Token Refresh] Response body: ${responseText}`;
        logger.error `[GitHub Token Refresh] Profile: ${githubProfileId}`;
        return null;
      }

      const responseText = await tokenResponse.text();
      logger.info `[GitHub Token Refresh] Raw response body: ${responseText}`;

      const tokens = JSON.parse(responseText);
      logger.info `[GitHub Token Refresh] Parsed token response - has access_token: ${!!tokens.access_token}, has refresh_token: ${!!tokens.refresh_token}`;

      if (!tokens.access_token) {
        logger.error `[GitHub Token Refresh] FAILED - No access_token in response`;
        logger.error `[GitHub Token Refresh] Full response: ${JSON.stringify(tokens)}`;
        logger.error `[GitHub Token Refresh] Profile: ${githubProfileId}`;
        return null;
      }

      if (tokens.error) {
        logger.error `[GitHub Token Refresh] FAILED - GitHub returned error in response`;
        logger.error `[GitHub Token Refresh] Error: ${tokens.error}`;
        logger.error `[GitHub Token Refresh] Error description: ${tokens.error_description || 'none'}`;
        logger.error `[GitHub Token Refresh] Profile: ${githubProfileId}`;
        return null;
      }

      logger.info `[GitHub Token Refresh] SUCCESS - New access token obtained`;
      logger.info `[GitHub Token Refresh] New access token: ${tokens.access_token.substring(0, 10)}...`;
      logger.info `[GitHub Token Refresh] Expires in: ${tokens.expires_in || 'no expiry'}s`;
      logger.info `[GitHub Token Refresh] New refresh token: ${tokens.refresh_token ? tokens.refresh_token.substring(0, 10) + '...' : 'not provided (keeping old)'}`;
      logger.info `[GitHub Token Refresh] Scope: ${tokens.scope || 'none'}`;
      logger.info `[GitHub Token Refresh] Total time: ${Date.now() - startTime}ms`;

      return tokens;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      logger.error `[GitHub Token Refresh] EXCEPTION after ${elapsed}ms`;
      logger.error `[GitHub Token Refresh] Error type: ${error instanceof Error ? error.constructor.name : typeof error}`;
      logger.error `[GitHub Token Refresh] Error message: ${getErrorMessage(error)}`;
      logger.error `[GitHub Token Refresh] Error stack: ${error instanceof Error ? error.stack : 'no stack'}`;
      logger.error `[GitHub Token Refresh] Profile: ${githubProfileId}`;
      return null;
    }
  }

  /**
   * Get valid GitHub tokens for user, automatically refreshing if expired or expiring soon
   * Similar to Claude OAuth's getValidAccessToken method
   */
  async getValidGitHubToken(userId: string) {
    const user = (await this.userService.getUserById(userId))!;
    if (!user.githubProfileId) {
      return null;
    }

    const token = await this.repositories.githubTokens.findByUserId(user.githubProfileId);
    if (!token) {
      logger.debug `[GitHub Token] No token found in database for githubProfileId ${user.githubProfileId} (user ${userId})`;
      return null;
    }

    const now = Date.now();
    const expiryTime = token.expiresAt ? token.expiresAt.getTime() : null;
    const bufferTime = 5 * 60 * 1000; // 5 minutes

    // Check if token needs refresh (5 minute buffer)
    const needsRefresh = token.expiresAt
      ? token.expiresAt.getTime() <= Date.now() + 5 * 60 * 1000
      : false;

    if (needsRefresh && token.refreshToken) {
      logger.info `[GitHub Token] Starting refresh flow for user ${userId}`;

      try {
        const newTokens = await this.refreshGitHubToken(user.githubProfileId, token.refreshToken);

        if (newTokens) {
          logger.info `[GitHub Token] Refresh succeeded for user ${userId}`;

          // Update token in database
          const expiresAt = newTokens.expires_in
            ? new Date(Date.now() + newTokens.expires_in * 1000)
            : undefined;

          await this.repositories.githubTokens.updateToken(token.id, {
            accessToken: newTokens.access_token,
            refreshToken: newTokens.refresh_token || token.refreshToken,
            scope: newTokens.scope || token.scope || undefined,
            expiresAt: expiresAt
          });

          // Return updated token
          const updatedToken = await this.repositories.githubTokens.findByUserId(user.githubProfileId);
          return updatedToken;
        } else {
          // Refresh failed - delete the invalid token and return null
          // This forces the user to re-authenticate via frontend 401 handling
          logger.error `[GitHub Token] Refresh returned null for user ${userId} - deleting invalid token`;
          await this.repositories.githubTokens.deleteToken(token.id);
          return null;
        }
      } catch (error) {
        logger.error `[GitHub Token] Exception during refresh for user ${userId}: ${getErrorMessage(error)}`;
        // Delete invalid token and return null to force re-authentication
        await this.repositories.githubTokens.deleteToken(token.id);
        return null;
      }
    } else if (needsRefresh && !token.refreshToken) {
      logger.warn `[GitHub Token] Token needs refresh but no refresh token available for user ${userId}`;
    }

    return token;
  }

  /**
   * @deprecated Use getValidGitHubToken instead to get tokens with automatic refresh
   */
  async getUserTokens(userId: string) {
    return this.getValidGitHubToken(userId);
  }

  async getUserGithubProfile(userId: string): Promise<GitHubProfile | null> {
    const user = await this.repositories.users.findById(userId);
    if (!user) {
      return null;
    }
    if (!user.githubProfileId) {
      return null;
    }
    return await this.repositories.githubProfiles.findById(user.githubProfileId);
  }

  /**
   * Get the authenticated user's GitHub username
   */
  async getUserGitHubLogin(userId: string): Promise<string | null> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        logger.warn `No GitHub token found for user - userId: ${userId}`;
        return null;
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      const response = await octokit.rest.users.getAuthenticated();
      return response.data.login;
      
    } catch (error) {
      logger.error `Failed to get GitHub username - error: ${getErrorMessage(error)}, userId: ${userId}`;
      return null;
    }
  }

  async getRepositoryByUrl(userId: string, githubUrl: string): Promise<RestEndpointMethodTypes['repos']['get']['response']['data'] | null> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      // Parse GitHub URL to get owner/repo - support both SSH and HTTPS formats
      let owner: string, repo: string;

      // SSH format: git@github.com:owner/repo.git
      const sshMatch = githubUrl.match(/git@github\.com:([^\/]+)\/(.+?)(\.git)?$/);
      if (sshMatch) {
        [, owner, repo] = sshMatch;
      } else {
        // HTTPS format: https://github.com/owner/repo.git
        const httpsMatch = githubUrl.match(/github\.com\/([^\/]+)\/(.+?)(\.git)?$/);
        if (httpsMatch) {
          [, owner, repo] = httpsMatch;
        } else {
          throw new Error('Invalid GitHub URL format');
        }
      }

      // Remove .git extension if present
      repo = repo.replace(/\.git$/, '');

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      try {
        const { data } = await octokit.repos.get({
          owner,
          repo
        });
        return data;
      } catch (error) {
        logger.error(`Failed to get repository by URL - userId: ${userId}, url: ${githubUrl}, error: ${getErrorMessage(error)}`);
        if (getErrorMessage(error).includes('Not Found')) {
          logger.warn(`Repository not found - userId: ${userId}, url: ${githubUrl}`);
          return null
        } else {
          throw error;
        }
      }
    } catch (error) {
      logger.error `Failed to get repository by URL - userId: ${userId}, url: ${githubUrl}, error: ${getErrorMessage(error)}`;
      throw error;
    }
  }

  async getRepositoryById(userId: string, githubId: number): Promise<RestEndpointMethodTypes['repos']['get']['response']['data']> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      const { data } = await octokit.request('GET /repositories/{repository_id}', {
        repository_id: githubId
      });

      return data;
    } catch (error) {
      logger.error `Failed to get repository by ID - userId: ${userId}, id: ${githubId}, error: ${getErrorMessage(error)}`;
      throw error;
    }
  }

  /**
   * Check if a specific repository has the GitHub App installed and return its permissions
   * Returns the access level from the installation if found, null otherwise
   */
  async getRepositoryInstallationPermission(userId: string, repoFullName: string): Promise<AccessLevel | null> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        return null;
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      // Get all installations for the user
      const installationsResponse = await octokit.rest.apps.listInstallationsForAuthenticatedUser();
      const installations = installationsResponse.data.installations;

      // Check each installation for the specific repository
      for (const installation of installations) {
        try {
          const reposResponse = await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
            installation_id: installation.id,
            per_page: 100
          });

          // Look for the specific repository in this installation
          const foundRepo = reposResponse.data.repositories.find(
            repo => repo.full_name === repoFullName
          );

          if (foundRepo) {
            // Found the repo, determine access level
            let accessLevel: AccessLevel = 'read';
            if (foundRepo.permissions?.push || foundRepo.permissions?.admin || foundRepo.permissions?.maintain) {
              accessLevel = 'write';
            }
            return accessLevel;
          }
        } catch (installationError) {
          logger.error `Failed to check installation ${installation.id} for repo ${repoFullName} - error: ${getErrorMessage(installationError)}`;
          // Continue checking other installations
        }
      }

      // Repository not found in any installation
      return null;
    } catch (error) {
      logger.error `Failed to check repository installation permission - userId: ${userId}, repo: ${repoFullName}, error: ${getErrorMessage(error)}`;
      return null;
    }
  }

  /**
   * Get the current authenticated user's permission level for a repository
   * This checks what the USER personally can do (their direct permissions on the repo)
   */
  async getCurrentUserRepositoryPermission(userId: string, repoFullName: string): Promise<{ accessLevel: ProjectRole } | null> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        logger.warn `No GitHub token found for user - userId: ${userId}`;
        return null;
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      const [owner, repo] = repoFullName.split('/');

      // Get the repository which returns the authenticated user's permissions
      try {
        const repoResponse = await octokit.rest.repos.get({
          owner,
          repo
        });

        const permissions = repoResponse.data.permissions;
        if (!permissions) {
          return null;
        }

        // Determine access level based on permissions - match GitHub's exact permission model
        if (permissions.admin) {
          return { accessLevel: ProjectRole.ADMIN };
        } else if (permissions.maintain) {
          return { accessLevel: ProjectRole.MAINTAIN };
        } else if (permissions.push) {
          return { accessLevel: ProjectRole.WRITE };
        } else if (permissions.triage) {
          return { accessLevel: ProjectRole.TRIAGE };
        } else if (permissions.pull) {
          return { accessLevel: ProjectRole.READ };
        } else {
          // No permissions at all (none) - refuse access
          return null;
        }
      } catch (repoError: any) {
        if (repoError?.status === 404) {
          logger.debug `User has no access to repository - userId: ${userId}, repoFullName: ${repoFullName}`;
          return null;
        } else if (repoError?.status === 403) {
          logger.debug `User access denied to repository - userId: ${userId}, repoFullName: ${repoFullName}`;
          return null;
        } else if (repoError?.status === 401) {
          // Bad credentials - token may be invalid/expired/revoked, or GitHub may be
          // returning a transient 401. Never delete token here — this is a background
          // permission check, not an auth flow. Token deletion only happens during
          // explicit auth/refresh flows. The frontend handles 401s via its own counter.
          logger.error `GitHub token got 401 for user ${userId} during repo permission check (NOT deleting token)`;
          throw new Error('GITHUB_AUTH_REQUIRED');
        } else {
          throw repoError;
        }
      }
    } catch (error) {
      logger.error `Failed to get current user repository permission - error: ${getErrorMessage(error)}, userId: ${userId}, repoFullName: ${repoFullName}`;
      throw error;
    }
  }

  /**
   * Exchange authorization code for user access token
   * This creates a user-to-server token, not an installation token
   */
  async exchangeCodeForToken(code: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    scope?: string;
    token_type: string;
  }> {
    try {
      logger.info `Exchanging authorization code for user access token - code: ${code.substring(0, 8)}...`;
      
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: this.appConfig.clientId,
          client_secret: this.appConfig.clientSecret,
          code: code
        })
      });
      
      if (!tokenResponse.ok) {
        logger.error `GitHub token exchange failed - status: ${tokenResponse.status}, statusText: ${tokenResponse.statusText}`;
        throw new Error('GITHUB_APP_TOKEN_EXCHANGE_FAILED');
      }
      
      const tokens = await tokenResponse.json();
      
      if (!tokens.access_token) {
        logger.error `GitHub token exchange returned no access token - response: ${JSON.stringify(tokens)}`;
        throw new Error('GITHUB_APP_NO_ACCESS_TOKEN');
      }
      
      logger.info `Successfully exchanged code for user access token - scope: ${tokens.scope}`;
      
      return tokens;
    } catch (error) {
      logger.error `Failed to exchange code for token - error: ${error}`;
      throw error;
    }
  }
  
  /**
   * Get the user's email addresses from GitHub
   * This endpoint returns all emails including private ones (requires user:email scope)
   */
  async getUserEmails(accessToken: string): Promise<GitHubEmailResponse[]> {
    try {
      const response = await fetch('https://api.github.com/user/emails', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ariana-ide-github-app',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error `Failed to fetch user emails - status: ${response.status}, error: ${errorText}`;
        return [];
      }

      const emails = await response.json() as GitHubEmailResponse[];
      return emails;
    } catch (error) {
      logger.error `Failed to get user emails - error: ${error}`;
      return [];
    }
  }

  /**
   * Get the user's primary verified email from GitHub
   * Falls back to any primary email, then any verified email
   */
  async getPrimaryEmail(accessToken: string): Promise<string | null> {
    const emails = await this.getUserEmails(accessToken);

    if (emails.length === 0) {
      return null;
    }

    // First try: primary AND verified email
    const primaryVerified = emails.find(e => e.primary && e.verified);
    if (primaryVerified) {
      return primaryVerified.email;
    }

    // Second try: any primary email (even if not verified)
    const primary = emails.find(e => e.primary);
    if (primary) {
      return primary.email;
    }

    // Third try: any verified email
    const verified = emails.find(e => e.verified);
    if (verified) {
      return verified.email;
    }

    // Last resort: first email in the list
    return emails[0]?.email || null;
  }

  /**
   * Get authenticated user information using the user access token
   */
  async getAuthenticatedUser(accessToken: string): Promise<GitHubUserResponse> {
    try {
      logger.info `Fetching authenticated user information`;

      // Use GraphQL API to get user information
      const query = `
        query {
          viewer {
            id
            databaseId
            login
            name
            email
            avatarUrl
            bio
            company
            location
            websiteUrl
            createdAt
            updatedAt
          }
        }
      `;

      const graphqlResponse = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'ariana-ide-github-app'
        },
        body: JSON.stringify({ query })
      });

      if (!graphqlResponse.ok) {
        const errorText = await graphqlResponse.text();
        logger.error `Failed to fetch GitHub user via GraphQL - status: ${graphqlResponse.status}, error: ${errorText}`;
        throw new Error('GITHUB_APP_USER_FETCH_FAILED');
      }

      const data = await graphqlResponse.json();

      if (data.errors) {
        logger.error `GraphQL errors when fetching user - errors: ${JSON.stringify(data.errors)}`;
        throw new Error('GITHUB_APP_USER_FETCH_FAILED');
      }

      if (!data.data?.viewer) {
        logger.error `Invalid user data from GitHub GraphQL - data: ${JSON.stringify(data)}`;
        throw new Error('GITHUB_APP_INVALID_USER_DATA');
      }

      // Transform GraphQL response to match expected format
      const viewer = data.data.viewer;

      // If no public email from GraphQL, fetch from /user/emails endpoint
      let email = viewer.email;
      if (!email) {
        logger.info `No public email from GraphQL, fetching from /user/emails endpoint`;
        email = await this.getPrimaryEmail(accessToken);
        if (email) {
          logger.info `Found primary email via /user/emails endpoint`;
        } else {
          logger.warn `No email found via /user/emails endpoint either`;
        }
      }

      const user: GitHubUserResponse = {
        id: viewer.databaseId,
        login: viewer.login,
        name: viewer.name,
        email: email,
        avatar_url: viewer.avatarUrl,
        bio: viewer.bio,
        company: viewer.company,
        location: viewer.location,
        blog: viewer.websiteUrl,
        created_at: viewer.createdAt,
        updated_at: viewer.updatedAt
      };

      if (!user.id) {
        logger.error `Invalid user data from GitHub - user: ${JSON.stringify(user)}`;
        throw new Error('GITHUB_APP_INVALID_USER_DATA');
      }

      logger.info `Successfully fetched GitHub user - userId: ${user.id}, login: ${user.login}, hasEmail: ${!!user.email}`;

      return user;
    } catch (error) {
      logger.error `Failed to get authenticated user - error: ${error}`;
      throw error;
    }
  }

  /**
   * Check GitHub token health - returns whether user has valid tokens and if they were refreshed
   * This makes an actual API call to GitHub to verify the token is valid (not just checking expiry)
   */
  async checkTokenHealth(userId: string): Promise<{
    hasToken: boolean;
    wasRefreshed: boolean;
  }> {
    logger.info `[GitHub Token Health] Checking token health for user ${userId}`;

    const user = await this.userService.getUserById(userId);
    if (!user || !user.githubProfileId) {
      logger.info `[GitHub Token Health] User ${userId} has no GitHub profile - hasToken: false`;
      return { hasToken: false, wasRefreshed: false };
    }

    const tokenBefore = await this.repositories.githubTokens.findByUserId(user.githubProfileId);
    if (!tokenBefore) {
      logger.warn `[GitHub Token Health] No token in database for user ${userId} - hasToken: false`;
      return { hasToken: false, wasRefreshed: false };
    }

    logger.info `[GitHub Token Health] Token exists for user ${userId}, checking validity`;
    const accessTokenBefore = tokenBefore.accessToken;

    // This will refresh if needed (based on expiry time)
    const validToken = await this.getValidGitHubToken(userId);

    if (!validToken) {
      logger.error `[GitHub Token Health] Token validation failed for user ${userId} - hasToken: false (likely deleted due to failed refresh)`;
      return { hasToken: false, wasRefreshed: false };
    }

    const wasRefreshed = validToken.accessToken !== accessTokenBefore;

    // Actually validate the token with GitHub by making a lightweight API call
    // This catches cases where token was revoked or permissions changed
    try {
      const response = await fetch('https://api.github.com/user', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${validToken.accessToken}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'ariana-ide-github-app',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        logger.error `[GitHub Token Health] GitHub API validation failed for user ${userId} - status: ${response.status}`;
        // Never delete token based on GitHub API errors — a 401 from GitHub
        // (transient issues, rate limits misreported as 401, etc.) should not
        // cause the user to be signed out. Token deletion only happens during
        // auth/refresh flows, not health checks.
        logger.warn `[GitHub Token Health] GitHub API error (${response.status}), keeping token for user ${userId}`;
        return { hasToken: true, wasRefreshed };
      }

      logger.info `[GitHub Token Health] User ${userId} - hasToken: true, wasRefreshed: ${wasRefreshed}`;
      return { hasToken: true, wasRefreshed };
    } catch (error) {
      logger.error `[GitHub Token Health] GitHub API call failed for user ${userId}: ${getErrorMessage(error)}`;
      // Network error - don't delete token, just report as valid to avoid false positives
      // The user will get logged out if this persists via the 401 counter in frontend
      return { hasToken: true, wasRefreshed };
    }
  }

  /**
   * Create a new repository in the authenticated user's account
   */
  async createRepository(userId: string, name: string): Promise<InstallationRepository> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        throw new Error('GITHUB_AUTH_REQUIRED');
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      logger.info `Creating repository ${name} for user ${userId}`;

      // Create the repository
      const { data: repo } = await octokit.repos.createForAuthenticatedUser({
        name,
        private: false,
        auto_init: false,
        description: undefined
      });

      logger.info `Repository created: ${repo.full_name} (ID: ${repo.id})`;

      // Get the authenticated user's login to use as owner
      const owner = repo.owner.login;

      // Create README.md with initial commit
      const readmeContent = `# ${name}`;
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo: name,
        path: 'README.md',
        message: 'Initial commit',
        content: Buffer.from(readmeContent).toString('base64')
      });

      logger.info `Initial commit created for ${repo.full_name}`;

      // Fetch the repository again to get updated data with the initial commit
      const { data: updatedRepo } = await octokit.repos.get({
        owner,
        repo: name
      });

      // Check installation permissions for the newly created repo
      let accessLevel: AccessLevel = 'write'; // User always has write access to their own repos
      const installationPermission = await this.getRepositoryInstallationPermission(userId, updatedRepo.full_name);
      if (installationPermission) {
        accessLevel = installationPermission;
      }

      // Return repository in InstallationRepository format
      return {
        id: updatedRepo.id,
        name: updatedRepo.name,
        fullName: updatedRepo.full_name,
        description: updatedRepo.description,
        url: updatedRepo.html_url,
        private: updatedRepo.private,
        permissions: accessLevel,
        pushedAt: updatedRepo.pushed_at,
      };
    } catch (error) {
      logger.error `Failed to create repository ${name} for user ${userId} - error: ${getErrorMessage(error)}`;

      // Check for specific error types
      const err = error as any;
      if (err?.status === 422) {
        throw new Error(`Repository '${name}' already exists in your account`);
      } else if (err?.status === 403) {
        throw new Error('Insufficient permissions to create repository');
      }

      throw error;
    }
  }

  /**
   * Get the state of a pull request by number
   * Returns PR state info or null if not found
   */
  async getPullRequestState(userId: string, repoFullName: string, prNumber: number): Promise<{
    state: 'open' | 'closed';
    merged: boolean;
    mergedAt: Date | null;
    closedAt: Date | null;
    headSha: string;
    headBranch: string;
    baseBranch: string;
    url: string;
  } | null> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        logger.warn `No GitHub token for user ${userId} when fetching PR state`;
        return null;
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      const [owner, repo] = repoFullName.split('/');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);
      try {
        const { data: pr } = await octokit.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
          request: { signal: controller.signal }
        });
        clearTimeout(timeoutId);

        return {
          state: pr.state as 'open' | 'closed',
          merged: pr.merged,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
          headSha: pr.head.sha,
          headBranch: pr.head.ref,
          baseBranch: pr.base.ref,
          url: pr.html_url
        };
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error?.status === 404) {
          logger.warn `PR #${prNumber} not found in ${repoFullName}`;
          return null;
        }
        logger.error `Failed to get PR state - repo: ${repoFullName}, pr: ${prNumber}, error: ${getErrorMessage(error)}`;
        return null;
      }
    } catch (error: any) {
      if (error?.status === 404) {
        logger.warn `PR #${prNumber} not found in ${repoFullName}`;
        return null;
      }
      logger.error `Failed to get PR state - repo: ${repoFullName}, pr: ${prNumber}, error: ${getErrorMessage(error)}`;
      return null;
    }
  }

  /**
   * Find the latest open PR for a branch
   * Returns the most recent open PR or null if none found
   */
  async findLatestPRForBranch(userId: string, repoFullName: string, branchName: string): Promise<{
    number: number;
    state: 'open' | 'closed';
    merged: boolean;
    mergedAt: Date | null;
    closedAt: Date | null;
    baseBranch: string;
    url: string;
  } | null> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        logger.warn `No GitHub token for user ${userId} when finding PR for branch`;
        return null;
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      const [owner, repo] = repoFullName.split('/');

      // First try to find an open PR
      const controller1 = new AbortController();
      const timeoutId1 = setTimeout(() => controller1.abort(), 10_000);
      let openPRs;
      try {
        const resp = await octokit.pulls.list({
          owner,
          repo,
          head: `${owner}:${branchName}`,
          state: 'open',
          sort: 'updated',
          direction: 'desc',
          per_page: 1,
          request: { signal: controller1.signal }
        });
        clearTimeout(timeoutId1);
        openPRs = resp.data;
      } catch (error) {
        clearTimeout(timeoutId1);
        throw error;
      }

      if (openPRs.length > 0) {
        const pr = openPRs[0];
        return {
          number: pr.number,
          state: 'open',
          merged: false,
          mergedAt: null,
          closedAt: null,
          baseBranch: pr.base.ref,
          url: pr.html_url
        };
      }

      // No open PR, check for most recent closed/merged PR
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 10_000);
      let closedPRs;
      try {
        const resp = await octokit.pulls.list({
          owner,
          repo,
          head: `${owner}:${branchName}`,
          state: 'closed',
          sort: 'updated',
          direction: 'desc',
          per_page: 1,
          request: { signal: controller2.signal }
        });
        clearTimeout(timeoutId2);
        closedPRs = resp.data;
      } catch (error) {
        clearTimeout(timeoutId2);
        throw error;
      }

      if (closedPRs.length > 0) {
        const pr = closedPRs[0];
        return {
          number: pr.number,
          state: 'closed',
          merged: pr.merged_at !== null,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
          baseBranch: pr.base.ref,
          url: pr.html_url
        };
      }

      return null;
    } catch (error) {
      logger.error `Failed to find PR for branch - repo: ${repoFullName}, branch: ${branchName}, error: ${getErrorMessage(error)}`;
      return null;
    }
  }

  /**
   * Get branch info from GitHub
   * Returns the remote branch state or null if branch doesn't exist
   */
  async getBranchInfo(userId: string, repoFullName: string, branchName: string): Promise<{
    exists: boolean;
    headSha: string | null;
  }> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        return { exists: false, headSha: null };
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      const [owner, repo] = repoFullName.split('/');

      const { data: branch } = await octokit.repos.getBranch({
        owner,
        repo,
        branch: branchName
      });

      return {
        exists: true,
        headSha: branch.commit.sha
      };
    } catch (error: any) {
      if (error?.status === 404) {
        return { exists: false, headSha: null };
      }
      logger.error `Failed to get branch info - repo: ${repoFullName}, branch: ${branchName}, error: ${getErrorMessage(error)}`;
      return { exists: false, headSha: null };
    }
  }

  /**
   * Get the base branch for a given branch (the branch it was created from)
   * This uses the GitHub API to find the default branch of the repo
   */
  async getDefaultBranch(userId: string, repoFullName: string): Promise<string | null> {
    try {
      const userTokens = await this.getUserTokens(userId);
      if (!userTokens) {
        return null;
      }

      const octokit = new Octokit({
        auth: userTokens.accessToken
      });

      const [owner, repo] = repoFullName.split('/');

      const { data: repoData } = await octokit.repos.get({
        owner,
        repo
      });

      return repoData.default_branch;
    } catch (error) {
      logger.error `Failed to get default branch - repo: ${repoFullName}, error: ${getErrorMessage(error)}`;
      return null;
    }
  }

  /**
   * Migrate existing users with @github.local emails to their real GitHub emails
   * This runs at server startup and updates profiles that have placeholder emails
   */
  async migrateGithubLocalEmails(): Promise<{ updated: number; failed: number; skipped: number }> {
    const stats = { updated: 0, failed: 0, skipped: 0 };

    try {
      // Find all GitHub profiles with @github.local emails
      const profilesWithPlaceholderEmail = await this.repositories.prisma.gitHubProfile.findMany({
        where: {
          email: {
            endsWith: '@github.local'
          }
        },
        include: {
          githubTokens: true
        }
      });

      logger.info `[Email Migration] Found ${profilesWithPlaceholderEmail.length} profiles with @github.local emails`;

      for (const profile of profilesWithPlaceholderEmail) {
        try {
          // Get the user's GitHub token
          const token = profile.githubTokens[0];
          if (!token) {
            logger.warn `[Email Migration] Profile ${profile.id} has no token, skipping`;
            stats.skipped++;
            continue;
          }

          // Try to get valid token (will refresh if needed)
          const user = await this.repositories.users.findByGithubProfileId(profile.id);
          if (!user) {
            logger.warn `[Email Migration] No user found for profile ${profile.id}, skipping`;
            stats.skipped++;
            continue;
          }

          const validToken = await this.getValidGitHubToken(user.id);
          if (!validToken) {
            logger.warn `[Email Migration] Could not get valid token for profile ${profile.id}, skipping`;
            stats.skipped++;
            continue;
          }

          // Fetch the real email
          const realEmail = await this.getPrimaryEmail(validToken.accessToken);

          if (!realEmail) {
            logger.warn `[Email Migration] No email found for profile ${profile.id} (${profile.name}), skipping`;
            stats.skipped++;
            continue;
          }

          if (realEmail === profile.email) {
            // Already correct (shouldn't happen since we filtered, but just in case)
            stats.skipped++;
            continue;
          }

          // Update the profile with the real email
          await this.repositories.githubProfiles.update(profile.id, {
            email: realEmail
          });

          logger.info `[Email Migration] Updated profile ${profile.id} (${profile.name}): ${profile.email} -> ${realEmail}`;
          stats.updated++;

        } catch (error) {
          logger.error `[Email Migration] Failed to update profile ${profile.id}: ${getErrorMessage(error)}`;
          stats.failed++;
        }
      }

      logger.info `[Email Migration] Complete - updated: ${stats.updated}, failed: ${stats.failed}, skipped: ${stats.skipped}`;
      return stats;
    } catch (error) {
      logger.error `[Email Migration] Fatal error: ${getErrorMessage(error)}`;
      return stats;
    }
  }
}