// Repository route registration - maps URLs to handlers

import { ServiceContainer } from '../../services';
import { addCorsHeaders, requireAuthAsync, createAuthErrorResponse } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import {
  handleGetRepository,
  handleGetBranches,
  handleSearchBranches,
  handleCheckRepositoryAccess,
  type RequestContext
} from './handlers';

// Route repository endpoints
export async function handleRepositoryRoutes(
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

  // Parse repository ID from path
  const repoIdMatch = url.pathname.match(/^\/api\/repositories\/([^\/]+)/);
  const repositoryId = repoIdMatch ? repoIdMatch[1] : null;

  // Auth check for all repository endpoints
  let auth: AuthenticatedRequest;
  try {
    auth = await requireAuthAsync(req, services);
  } catch (error) {
    return createAuthErrorResponse(error as Error, origin);
  }

  if (repositoryId) {
    // GET /api/repositories/:id - Get repository details
    if (url.pathname === `/api/repositories/${repositoryId}` && req.method === 'GET') {
      return await handleGetRepository(req, context, repositoryId, auth);
    }

    // GET /api/repositories/:id/branches - Get repository branches
    if (url.pathname === `/api/repositories/${repositoryId}/branches` && req.method === 'GET') {
      return await handleGetBranches(req, context, repositoryId, auth);
    }

    // GET /api/repositories/:id/branches/search?q=... - Search branches on GitHub directly
    if (url.pathname === `/api/repositories/${repositoryId}/branches/search` && req.method === 'GET') {
      return await handleSearchBranches(req, context, repositoryId, auth);
    }

    // GET /api/repositories/:id/check-access - Check repository access
    if (url.pathname === `/api/repositories/${repositoryId}/check-access` && req.method === 'GET') {
      return await handleCheckRepositoryAccess(req, context, repositoryId, auth);
    }
  }

  return null; // Not a repository endpoint
}