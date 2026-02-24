import { ServiceContainer } from '../../services';
import { addCorsHeaders, requireAuthAsync, createAuthErrorResponse } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import {
  handleGetGroupedInstallations,
  handleSearchRepositories,
  handleCreateRepository,
  handleCheckTokenHealth,
  type RequestContext
} from './handlers';


export async function handleGitHubRoutes(
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

  // Auth check for all other GitHub endpoints
  let auth: AuthenticatedRequest;
  try {
    auth = await requireAuthAsync(req, services);
  } catch (error) {
    return createAuthErrorResponse(error as Error, origin);
  }
  
  if (url.pathname === '/api/github/grouped-installations' && req.method === 'GET') {
    return await handleGetGroupedInstallations(req, context, auth);
  }

  if (url.pathname === '/api/github/repository/search' && req.method === 'GET') {
    return await handleSearchRepositories(req, context, auth);
  }

  if (url.pathname === '/api/github/repository/create' && req.method === 'POST') {
    return await handleCreateRepository(req, context, auth);
  }

  if (url.pathname === '/api/github/token-health' && req.method === 'GET') {
    return await handleCheckTokenHealth(req, context, auth);
  }

  return null;
}