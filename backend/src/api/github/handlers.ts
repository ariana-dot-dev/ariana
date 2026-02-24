import type { ServiceContainer } from '../../services';
import { addCorsHeaders } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import type { InstallationRepository } from '../../../shared/types';
import { getLogger } from '../../utils/logger';

const logger = getLogger(['api', 'github']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

// Get grouped GitHub App installations with repositories
export async function handleGetGroupedInstallations(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info `Fetching grouped installations for user ${auth.user.id}`;

    // Check if user is anonymous - return empty installations
    const user = await context.services.users.getUserById(auth.user.id);
    if (user?.isAnonymous) {
      logger.info `Anonymous user requested installations - returning empty list`;
      return addCorsHeaders(Response.json({ installations: [] }), context.origin);
    }

    const groupedInstallations = await context.services.github.getGroupedInstallations(auth.user.id);

    logger.info `Found ${groupedInstallations.installations.length} installations for user ${auth.user.id}`;

    return addCorsHeaders(Response.json(groupedInstallations), context.origin);
  } catch (error) {
    // Check if this is a GitHub authentication error
    if (error instanceof Error && error.message === 'GITHUB_AUTH_REQUIRED') {
      logger.warn `GitHub authentication required for user ${auth.user.id}`;
      return addCorsHeaders(Response.json({
        error: 'GitHub authentication required',
        code: 'GITHUB_AUTH_REQUIRED'
      }, { status: 401 }), context.origin);
    }

    logger.error `Failed to fetch grouped installations: ${error instanceof Error ? error.message : String(error)}`;
    return addCorsHeaders(Response.json({
      error: 'Failed to fetch grouped installations',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 }), context.origin);
  }
}

// Search repositories by name
// No searchTerm: return cached top 100 repos (for app startup)
// With searchTerm: query GitHub search API directly (for user-triggered search)
export async function handleSearchRepositories(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const searchTerm = url.searchParams.get('searchTerm');

    const user = await context.services.users.getUserById(auth.user.id);
    if (user?.isAnonymous) {
      return addCorsHeaders(Response.json({ repositories: [] }), context.origin);
    }

    // No search term: return cached top 100 repos sorted by recency
    if (!searchTerm || searchTerm.trim().length === 0) {
      const allReposResponse = await context.services.github.getAllAccessibleRepositoriesForUser(auth.user.id);
      const repos = (allReposResponse.repositories || [])
        .sort((a: InstallationRepository, b: InstallationRepository) => {
          const dateA = a.pushedAt ? new Date(a.pushedAt).getTime() : 0;
          const dateB = b.pushedAt ? new Date(b.pushedAt).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, 100);
      return addCorsHeaders(Response.json({ repositories: repos }), context.origin);
    }

    // With search term: query GitHub directly
    const results = await context.services.github.searchRepositories(auth.user.id, searchTerm.trim(), 50);
    return addCorsHeaders(Response.json({ repositories: results }), context.origin);
  } catch (error) {
    if (error instanceof Error && error.message === 'GITHUB_AUTH_REQUIRED') {
      return addCorsHeaders(Response.json({ error: 'GitHub authentication required', code: 'GITHUB_AUTH_REQUIRED' }, { status: 401 }), context.origin);
    }
    logger.error `Failed to search repositories: ${error instanceof Error ? error.message : String(error)}`;
    return addCorsHeaders(Response.json({ error: 'Failed to search repositories' }, { status: 500 }), context.origin);
  }
}

// Check GitHub token health
export async function handleCheckTokenHealth(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info `Checking GitHub token health for user ${auth.user.id}`;

    const result = await context.services.github.checkTokenHealth(auth.user.id);

    return addCorsHeaders(Response.json({
      hasToken: result.hasToken,
      wasRefreshed: result.wasRefreshed
    }), context.origin);
  } catch (error) {
    logger.error `Failed to check token health: ${error instanceof Error ? error.message : String(error)}`;
    return addCorsHeaders(Response.json({
      error: 'Failed to check token health',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 }), context.origin);
  }
}

// Create a new GitHub repository
export async function handleCreateRepository(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info `Creating repository for user ${auth.user.id}`;

    // Check if user is anonymous
    const user = await context.services.users.getUserById(auth.user.id);
    if (user?.isAnonymous) {
      logger.warn `Anonymous user attempted to create repository`;
      return addCorsHeaders(Response.json({
        error: 'GitHub authentication required',
        code: 'GITHUB_AUTH_REQUIRED'
      }, { status: 401 }), context.origin);
    }

    const body = await req.json() as { name: string };
    const { name } = body;

    if (!name || name.trim().length === 0) {
      return addCorsHeaders(Response.json({
        error: 'Repository name is required',
        message: 'Please provide a valid repository name'
      }, { status: 400 }), context.origin);
    }

    // Validate repository name
    const nameRegex = /^[a-zA-Z0-9._-]+$/;
    if (!nameRegex.test(name) || name.length > 100) {
      return addCorsHeaders(Response.json({
        error: 'Invalid repository name',
        message: 'Repository name must only contain letters, numbers, hyphens, underscores, and periods, and be 100 characters or less'
      }, { status: 400 }), context.origin);
    }

    // Create repository via GitHub service
    const repository = await context.services.github.createRepository(auth.user.id, name.trim());

    logger.info `Successfully created repository ${repository.fullName} for user ${auth.user.id}`;

    return addCorsHeaders(Response.json({
      success: true,
      repository
    }), context.origin);

  } catch (error) {
    // Check if this is a GitHub authentication error
    if (error instanceof Error && error.message === 'GITHUB_AUTH_REQUIRED') {
      logger.warn `GitHub authentication required for user ${auth.user.id}`;
      return addCorsHeaders(Response.json({
        error: 'GitHub authentication required',
        code: 'GITHUB_AUTH_REQUIRED'
      }, { status: 401 }), context.origin);
    }

    logger.error `Failed to create repository: ${error instanceof Error ? error.message : String(error)}`;

    // Check for specific GitHub errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const status = errorMessage.includes('already exists') ? 409 : 500;

    return addCorsHeaders(Response.json({
      error: 'Failed to create repository',
      message: errorMessage
    }, { status }), context.origin);
  }
}