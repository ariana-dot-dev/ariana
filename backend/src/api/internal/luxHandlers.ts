/**
 * LUX Computer-Use API handlers.
 *
 * These endpoints allow agents to use the LUX vision AI for computer-use tasks.
 * The LUX API key is stored on the backend - agents only need their JWT token.
 *
 * Flow:
 * 1. Agent calls /lux/session/start with a task description
 * 2. Agent takes screenshot, calls /lux/step with base64 image
 * 3. Backend calls LUX API, returns actions to agent
 * 4. Agent executes actions locally (xdotool)
 * 5. Repeat until task complete or limit reached
 * 6. Agent calls /lux/session/end to clean up
 */

import type { ServiceContainer } from '@/services';
import { requireInternalAgent } from '@/middleware/internalAgentAuth';
import { getLogger } from '@/utils/logger';
import type { StartSessionRequest, StepRequest } from '@/services/lux.service';

const logger = getLogger(['api', 'internal', 'lux']);

export interface LuxRequestContext {
  services: ServiceContainer;
}

/**
 * Start a new LUX computer-use session
 * POST /api/internal/agent/lux/session/start
 */
export async function handleLuxStartSession(
  req: Request,
  context: LuxRequestContext
): Promise<Response> {
  try {
    const claims = requireInternalAgent(req);
    logger.info`LUX session start from agentId=${claims.agentId}`;

    const agent = await context.services.repositoryContainer.agents.getAgentById(claims.agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    const body = await req.json() as StartSessionRequest;
    if (!body.task) {
      return Response.json({ error: 'Missing required field: task' }, { status: 400 });
    }

    const result = await context.services.lux.startSession(
      claims.agentId,
      claims.userId,
      agent.projectId,
      body
    );

    if ('error' in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    logger.error`LUX session start error: ${error}`;
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('token') || message.includes('authorization') ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

/**
 * Execute one step: send screenshot, get actions
 * POST /api/internal/agent/lux/step
 */
export async function handleLuxStep(
  req: Request,
  context: LuxRequestContext
): Promise<Response> {
  try {
    const claims = requireInternalAgent(req);

    const body = await req.json() as StepRequest;
    if (!body.sessionId) {
      return Response.json({ error: 'Missing required field: sessionId' }, { status: 400 });
    }
    if (!body.screenshot) {
      return Response.json({ error: 'Missing required field: screenshot' }, { status: 400 });
    }

    // Validate screenshot size (max 10MB base64)
    if (body.screenshot.length > 10 * 1024 * 1024) {
      return Response.json({ error: 'Screenshot too large (max 10MB)' }, { status: 400 });
    }

    logger.info`LUX step from agentId=${claims.agentId} sessionId=${body.sessionId}`;

    const result = await context.services.lux.step(
      claims.agentId,
      claims.userId,
      body
    );

    if ('error' in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    logger.error`LUX step error: ${error}`;
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('token') || message.includes('authorization') ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

/**
 * End a session early
 * POST /api/internal/agent/lux/session/end
 */
export async function handleLuxEndSession(
  req: Request,
  context: LuxRequestContext
): Promise<Response> {
  try {
    const claims = requireInternalAgent(req);

    const body = await req.json() as { sessionId: string };
    if (!body.sessionId) {
      return Response.json({ error: 'Missing required field: sessionId' }, { status: 400 });
    }

    logger.info`LUX session end from agentId=${claims.agentId} sessionId=${body.sessionId}`;

    const result = await context.services.lux.endSession(
      claims.agentId,
      claims.userId,
      body.sessionId
    );

    if ('error' in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    logger.error`LUX session end error: ${error}`;
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('token') || message.includes('authorization') ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

/**
 * Get usage status
 * GET /api/internal/agent/lux/status
 */
export async function handleLuxStatus(
  req: Request,
  context: LuxRequestContext
): Promise<Response> {
  try {
    const claims = requireInternalAgent(req);

    const configured = context.services.lux.isConfigured();
    const usage = await context.services.lux.getUsageStats(claims.userId);

    return Response.json({
      configured,
      ...usage,
    });
  } catch (error) {
    logger.error`LUX status error: ${error}`;
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('token') || message.includes('authorization') ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
