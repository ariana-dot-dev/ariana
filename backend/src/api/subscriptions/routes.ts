import type { ServiceContainer } from '@/services';
import {requireAuthAsync, createAuthErrorResponse, addCorsHeaders, type AuthenticatedRequest} from '@/middleware/auth';
import { handleGetCurrentPlan } from './handlers';

export async function handleSubscriptionRoutes(
  req: Request,
  url: URL,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  const context = { services, origin };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 200 }), origin);
  }


  // Auth check for all agent endpoints
  let auth: AuthenticatedRequest;
  try {
    auth = await requireAuthAsync(req, services);
  } catch (error) {
    return createAuthErrorResponse(error as Error, origin);
  }


  // GET /api/subscription/current-plan
  if (url.pathname === '/api/subscription/current-plan' && req.method === 'GET') {
    return await handleGetCurrentPlan(req, context, auth);
  }

  return null;
}
