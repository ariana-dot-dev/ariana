/**
 * Internal API routes for agent MCP tools.
 * These routes are authenticated via internal JWT tokens (not user OAuth).
 */

import type { ServiceContainer } from '@/services';
import { handleInternalQuery, handleInternalAction } from './handlers';
import {
  handleLuxStartSession,
  handleLuxStep,
  handleLuxEndSession,
  handleLuxStatus
} from './luxHandlers';

export async function handleInternalRoutes(
  req: Request,
  url: URL,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  const context = { services };

  // Internal Query API - for MCP query tool
  // POST /api/internal/agent/query
  if (url.pathname === '/api/internal/agent/query' && req.method === 'POST') {
    return await handleInternalQuery(req, context);
  }

  // Internal Action API - for MCP action tool
  // POST /api/internal/agent/action
  if (url.pathname === '/api/internal/agent/action' && req.method === 'POST') {
    return await handleInternalAction(req, context);
  }

  // LUX Computer-Use API - start a new session
  // POST /api/internal/agent/lux/session/start
  if (url.pathname === '/api/internal/agent/lux/session/start' && req.method === 'POST') {
    return await handleLuxStartSession(req, context);
  }

  // LUX Computer-Use API - execute one step
  // POST /api/internal/agent/lux/step
  if (url.pathname === '/api/internal/agent/lux/step' && req.method === 'POST') {
    return await handleLuxStep(req, context);
  }

  // LUX Computer-Use API - end a session
  // POST /api/internal/agent/lux/session/end
  if (url.pathname === '/api/internal/agent/lux/session/end' && req.method === 'POST') {
    return await handleLuxEndSession(req, context);
  }

  // LUX Computer-Use API - get status/usage
  // GET /api/internal/agent/lux/status
  if (url.pathname === '/api/internal/agent/lux/status' && req.method === 'GET') {
    return await handleLuxStatus(req, context);
  }

  return null;
}
