// LUX activity handlers - expose LUX session step history to frontend

import type { ServiceContainer } from '../../services';
import { addCorsHeaders } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getLogger } from '../../utils/logger';

const logger = getLogger(['api', 'agents', 'lux']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

/**
 * GET /api/agents/:id/lux/steps
 * Returns step history for the agent's active LUX session.
 */
export async function handleGetLuxSteps(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    if (!agent.luxActiveSessionId) {
      return addCorsHeaders(Response.json({
        success: true,
        steps: [],
      }), context.origin);
    }

    const records = await context.services.repositoryContainer.luxUsage.getBySessionId(agent.luxActiveSessionId);

    const steps = records.map(r => ({
      id: r.id,
      reason: r.reason ?? null,
      actionsReturned: r.actionsReturned,
      stopped: r.stopped,
      createdAt: r.createdAt,
    }));

    return addCorsHeaders(Response.json({
      success: true,
      steps,
    }), context.origin);
  } catch (error) {
    logger.error`Failed to get LUX steps for ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
