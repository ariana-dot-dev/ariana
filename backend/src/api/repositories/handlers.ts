import type { ServiceContainer } from '../../services';
import { ProjectRole, type AccessLevel } from '../../../shared/types';
import { addCorsHeaders, createAuthErrorResponse } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { Octokit } from '@octokit/rest';
import { getLogger } from '../../utils/logger';

const logger = getLogger(['api', 'repositories']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

// Get repository details
export async function handleGetRepository(
  req: Request,
  context: RequestContext,
  repositoryId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const repository = await context.services.repositories.getRepositoryById(repositoryId);
    if (!repository) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Repository not found'
      }, { status: 404 }), context.origin);
    }

    // Check permission using GitHub-only system
    const hasAccess = await context.services.permissions.checkRepoAccess(auth.user.id, repository.fullName, ProjectRole.READ);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    return addCorsHeaders(Response.json({
      success: true,
      repository
    }), context.origin);
  } catch (error) {
    logger.error `Get repository failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get repository branches
export async function handleGetBranches(
  req: Request,
  context: RequestContext,
  repositoryId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    let repository;

    if (repositoryId.split('---').length  === 1) {
      repository = await context.services.repositories.getRepositoryById(repositoryId);
      if (!repository) {
        return addCorsHeaders(Response.json({
          success: false,
          error: 'Repository not found'
        }, { status: 404 }), context.origin);
      }
    } else {
      repository = { fullName: repositoryId.split('---').join('/') }
    }

    // Check permission using GitHub-only system
    const hasAccess = await context.services.permissions.checkRepoAccess(auth.user.id, repository.fullName, ProjectRole.READ);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Fetch branches from GitHub
    const branches = await context.services.github.getRepositoryBranches(
      auth.user.id,
      repository.fullName
    );

    return addCorsHeaders(Response.json({
      success: true,
      branches
    }), context.origin);
  } catch (error) {
    logger.error `Get branches failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Search branches by name — queries GitHub directly, no cache
export async function handleSearchBranches(
  req: Request,
  context: RequestContext,
  repositoryId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('q') || '';
    if (!query.trim()) {
      return addCorsHeaders(Response.json({ success: true, branches: [] }), context.origin);
    }

    const repoFullName = repositoryId.includes('---')
      ? repositoryId.split('---').join('/')
      : (await context.services.repositories.getRepositoryById(repositoryId))?.fullName;

    if (!repoFullName) {
      return addCorsHeaders(Response.json({ success: false, error: 'Repository not found' }, { status: 404 }), context.origin);
    }

    const branches = await context.services.github.searchBranches(auth.user.id, repoFullName, query.trim(), 50);
    return addCorsHeaders(Response.json({ success: true, branches }), context.origin);
  } catch (error) {
    logger.error `Search branches failed: ${error}`;
    return addCorsHeaders(Response.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 }), context.origin);
  }
}

// Check repository access (app permissions)
export async function handleCheckRepositoryAccess(
  req: Request,
  context: RequestContext,
  repositoryId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    let repositoryFullName: string;

    // Handle both repositoryId and owner---repo format
    if (repositoryId.split('---').length === 1) {
      const repository = await context.services.repositories.getRepositoryById(repositoryId);
      if (!repository) {
        return addCorsHeaders(Response.json({
          success: false,
          error: 'Repository not found'
        }, { status: 404 }), context.origin);
      }
      repositoryFullName = repository.fullName;
    } else {
      repositoryFullName = repositoryId.split('---').join('/');
    }

    // STEP 1: Check if repo has GitHub App installed
    const installationPermission = await context.services.github.getRepositoryInstallationPermission(
      auth.user.id,
      repositoryFullName
    );

    if (installationPermission) {
      // Found in installations - return those permissions
      return addCorsHeaders(Response.json({
        success: true,
        accessLevel: installationPermission,
        repositoryFullName
      }), context.origin);
    }

    // STEP 2: Check if repo exists on GitHub (if we can see it, we at least have read access)
    try {
      const [owner, repo] = repositoryFullName.split('/');
      const userTokens = await context.services.github.getUserTokens(auth.user.id);

      if (userTokens) {
        const octokit = new Octokit({
          auth: userTokens.accessToken
        });

        await octokit.repos.get({
          owner,
          repo
        });

        // If we get here, repo exists and we can see it - means public or we have access
        return addCorsHeaders(Response.json({
          success: true,
          accessLevel: 'read' as AccessLevel,
          repositoryFullName
        }), context.origin);
      }
    } catch (error) {
      // 404 or 403 means we can't see it - fall through to return 'none'
      logger.debug `Repository not found or no access - repo: ${repositoryFullName}`;
    }

    // STEP 3: Repo not found in installations and doesn't exist / no access
    return addCorsHeaders(Response.json({
      success: true,
      accessLevel: 'none' as AccessLevel,
      repositoryFullName
    }), context.origin);

  } catch (error) {
    logger.error `Check repository access failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
