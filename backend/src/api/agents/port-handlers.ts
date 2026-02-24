// Port monitoring route handlers

import { addCorsHeaders } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getLogger } from '../../utils/logger';
import type { RequestContext } from './handlers';

const logger = getLogger(['api', 'agents', 'ports']);

export interface PortInfo {
  port: number;
  protocol: 'tcp' | 'udp';
  pid: number;
  program: string;
  state: string;
  visibility: 'private' | 'public';
  listenAddress: string;
  isDocker: boolean;
  url?: string; // HTTPS URL via cert-gateway
}

export async function handleGetPorts(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check read access
    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    if (agent.isTrashed) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent is trashed'
      }, { status: 400 }), context.origin);
    }

    // Check if agent machine is running
    if (!agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent machine is not running'
      }, { status: 400 }), context.origin);
    }

    // Forward to agents-server
    const response = await context.services.agents.sendToAgentServer(
      agent.machineId,
      '/ports',
      {}
    );

    const data = await response.json();

    if (!data.success) {
      logger.error`Failed to get ports for agent ${agentId}: ${data.error}`;
    }

    return addCorsHeaders(Response.json(data, {
      status: response.status
    }), context.origin);

  } catch (error) {
    logger.error`Port query error for agent ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 }), context.origin);
  }
}

export async function handleSetPortVisibility(
  req: Request,
  context: RequestContext,
  agentId: string,
  port: number,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check write access
    const hasWrite = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
    if (!hasWrite) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Write access required'
      }, { status: 403 }), context.origin);
    }

    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    if (agent.isTrashed) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent is trashed'
      }, { status: 400 }), context.origin);
    }

    // Check if agent machine is running
    if (!agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent machine is not running'
      }, { status: 400 }), context.origin);
    }

    const body = await req.json();
    const { visibility } = body;

    if (!visibility || !['private', 'public'].includes(visibility)) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Invalid visibility value. Must be "private" or "public"'
      }, { status: 400 }), context.origin);
    }

    // Forward to agents-server
    const response = await context.services.agents.sendToAgentServer(
      agent.machineId,
      '/port-visibility',
      { port, visibility }
    );

    const data = await response.json();

    if (data.success) {
      logger.info`Set port ${port} visibility to ${visibility} for agent ${agentId}`;
    } else {
      logger.error`Failed to set port visibility for agent ${agentId}: ${data.error}`;
    }

    return addCorsHeaders(Response.json(data, {
      status: response.status
    }), context.origin);

  } catch (error) {
    logger.error`Port visibility error for agent ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 }), context.origin);
  }
}
