// Slop mode handlers - auto-prompt agent to keep working

import type { ServiceContainer } from '../../services';
import { addCorsHeaders } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getLogger } from '../../utils/logger';

const logger = getLogger(['api', 'agents', 'slop-mode']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

interface StartSlopModeRequest {
  hours: number;
  customPrompt?: string;
}

/**
 * Start slop mode for an agent
 * Agent will be auto-prompted to keep working when it goes idle
 */
export async function handleStartSlopMode(
  req: Request,
  context: RequestContext,
  agentId: string,
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

    // Get agent to verify it exists
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Parse request body
    const body = await req.json() as StartSlopModeRequest;
    const hours = body.hours || 1;
    const customPrompt = body.customPrompt?.trim() || undefined;

    if (hours <= 0 || hours > 24) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Hours must be between 1 and 24'
      }, { status: 400 }), context.origin);
    }

    // Calculate end time
    const now = new Date();
    const inSlopModeUntil = new Date(now.getTime() + hours * 60 * 60 * 1000);

    // Update agent
    await context.services.agents.updateAgentFields(agentId, {
      inSlopModeUntil,
      slopModeLastPromptAt: null, // Reset last prompt time
      slopModeCustomPrompt: customPrompt || null
    });

    logger.info`Agent ${agentId} entered slop mode for ${hours} hours (until ${inSlopModeUntil.toISOString()})`;

    return addCorsHeaders(Response.json({
      success: true,
      inSlopModeUntil: inSlopModeUntil.toISOString(),
      hours
    }), context.origin);

  } catch (error) {
    logger.error`Failed to start slop mode for ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Stop slop mode for an agent
 */
export async function handleStopSlopMode(
  req: Request,
  context: RequestContext,
  agentId: string,
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

    // Get agent to verify it exists
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Update agent to clear slop mode
    await context.services.agents.updateAgentFields(agentId, {
      inSlopModeUntil: null,
      slopModeLastPromptAt: null,
      slopModeCustomPrompt: null
    });

    logger.info`Agent ${agentId} exited slop mode`;

    return addCorsHeaders(Response.json({
      success: true
    }), context.origin);

  } catch (error) {
    logger.error`Failed to stop slop mode for ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
