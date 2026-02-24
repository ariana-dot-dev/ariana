import { ServiceContainer } from '../../services';
import { addCorsHeaders, requireAuthAsync, createAuthErrorResponse } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import {
  handleGenerateRegistrationToken,
  handleRegisterMachine,
  handleGetMachines,
  handleGetMachine,
  handleDeleteMachine,
  handleCheckMachinesHealth,
  type RequestContext
} from './handlers';

// Route machine endpoints
export async function handleMachineRoutes(
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

  // POST /api/machines/register - No auth required (called by installation script with token)
  if (url.pathname === '/api/machines/register' && req.method === 'POST') {
    return await handleRegisterMachine(req, context);
  }

  // All other endpoints require authentication
  let auth: AuthenticatedRequest;
  try {
    auth = await requireAuthAsync(req, services);
  } catch (error) {
    return createAuthErrorResponse(error as Error, origin);
  }

  // POST /api/machines/generate-registration-token
  if (url.pathname === '/api/machines/generate-registration-token' && req.method === 'POST') {
    return await handleGenerateRegistrationToken(req, context, auth);
  }

  // POST /api/machines/check-health - Check health of all machines
  if (url.pathname === '/api/machines/check-health' && req.method === 'POST') {
    return await handleCheckMachinesHealth(req, context, auth);
  }

  // GET /api/machines - List all machines for user
  if (url.pathname === '/api/machines' && req.method === 'GET') {
    return await handleGetMachines(req, context, auth);
  }

  // Parse machine ID from path
  const machineIdMatch = url.pathname.match(/^\/api\/machines\/([^\/]+)$/);
  const machineId = machineIdMatch ? machineIdMatch[1] : null;

  if (machineId) {
    // GET /api/machines/:id
    if (req.method === 'GET') {
      return await handleGetMachine(req, context, machineId, auth);
    }

    // DELETE /api/machines/:id
    if (req.method === 'DELETE') {
      return await handleDeleteMachine(req, context, machineId, auth);
    }
  }

  return null;
}
