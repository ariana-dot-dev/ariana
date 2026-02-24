import { ServiceContainer } from '@/services';
import { handleAuthRoutes } from './auth/routes';
import { handleAgentRoutes } from './agents/routes';
import { handleRepositoryRoutes } from './repositories/routes';
import { handleGitHubRoutes } from './github/routes';
import { handleClaudeRoutes } from './claude/routes';
import { handleProjectRoutes } from './projects/routes';
import { handleAdminRoutes } from './admin/routes';
import { handleStripeRoutes } from './stripe/routes';
import { handleSubscriptionRoutes } from './subscriptions/routes';
import { handleMachineRoutes } from './machines/routes';
import { handleInternalRoutes } from './internal/routes';
import { generalRateLimit } from '../middleware/rateLimit';

// Main API router function
export async function handleApiRequest(
  req: Request,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  const url = new URL(req.url);

  // Apply general rate limiting to all API requests
  const rateLimitResult = await generalRateLimit(
    req,
    { services, origin },
    async () => {
      // Dummy next function - will route below
      return new Response();
    }
  );

  // If rate limit hit, return the error response
  if (rateLimitResult.status === 429) {
    return rateLimitResult;
  }

  // Route to appropriate module based on path
  if (url.pathname.startsWith('/api/auth/')) {
    return await handleAuthRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/agents')) {
    return await handleAgentRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/repositories')) {
    return await handleRepositoryRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/github')) {
    return await handleGitHubRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/claude')) {
    return await handleClaudeRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/projects')) {
    return await handleProjectRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/admin')) {
    return await handleAdminRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/stripe')) {
    return await handleStripeRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/subscription')) {
    return await handleSubscriptionRoutes(req, url, services, origin);
  }

  if (url.pathname.startsWith('/api/machines')) {
    return await handleMachineRoutes(req, url, services, origin);
  }

  // Internal API for MCP tools (agent-to-backend communication)
  if (url.pathname.startsWith('/api/internal/')) {
    return await handleInternalRoutes(req, url, services, origin);
  }

  return null;
}

// Export route modules for direct access if needed
export {
  handleAuthRoutes,
  handleAgentRoutes,
  handleRepositoryRoutes,
  handleGitHubRoutes,
  handleClaudeRoutes,
  handleProjectRoutes,
  handleAdminRoutes,
  handleStripeRoutes,
  handleMachineRoutes,
  handleInternalRoutes
};