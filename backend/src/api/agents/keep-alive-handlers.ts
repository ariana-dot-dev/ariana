import type { RequestContext } from './handlers';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { addCorsHeaders } from '../../middleware/auth';
import { AgentService } from '../../services/agent.service';

interface KeepAliveRequest {
  agentIds: string[];
}

/**
 * Handles keep-alive requests from the frontend.
 * The frontend sends a list of agent IDs that should remain alive
 * (e.g., agents with filesync or port forwarding enabled on this client).
 *
 * For each agent, if it's within the auto-extend threshold, we extend its lifetime.
 * This allows per-client keep-alive without storing state in the database.
 */
export async function handleKeepAlive(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Parse request body
    const body = await req.json() as KeepAliveRequest;
    const { agentIds } = body;

    // Validate input
    if (!Array.isArray(agentIds)) {
      return addCorsHeaders(Response.json({
        error: 'agentIds must be an array'
      }, { status: 400 }), context.origin);
    }

    // Limit to prevent abuse (max 100 agents per request)
    if (agentIds.length > 100) {
      return addCorsHeaders(Response.json({
        error: 'Too many agent IDs (max 100)'
      }, { status: 400 }), context.origin);
    }

    // Validate all IDs are strings
    if (!agentIds.every(id => typeof id === 'string')) {
      return addCorsHeaders(Response.json({
        error: 'All agent IDs must be strings'
      }, { status: 400 }), context.origin);
    }

    const agentService = context.services.agents as AgentService;
    const results: { [agentId: string]: { success: boolean; extended?: boolean; error?: string } } = {};

    // Process each agent
    for (const agentId of agentIds) {
      try {
        // Check write access first
        const hasWrite = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
        if (!hasWrite) {
          results[agentId] = { success: false, error: 'No write access' };
          continue;
        }

        // Get the agent (without user ID since we already checked access)
        const agent = await context.services.agents.getAgent(agentId);
        if (!agent) {
          results[agentId] = { success: false, error: 'Agent not found' };
          continue;
        }

        // Try to extend lifetime if within threshold
        const extended = await agentService.autoExtendIfNearExpiration(agent);
        results[agentId] = { success: true, extended };
      } catch (error) {
        console.error(`[Keep-Alive] Error processing agent ${agentId}:`, error);
        results[agentId] = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    }

    return addCorsHeaders(Response.json({
      success: true,
      results
    }), context.origin);
  } catch (error) {
    console.error('[Keep-Alive] Error handling keep-alive request:', error);
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
