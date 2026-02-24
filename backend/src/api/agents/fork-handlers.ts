import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['api', 'agents', 'fork']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

export async function handleForkAgent(
  req: Request,
  context: RequestContext,
  sourceAgentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as {
      newOwnerId: string;
      newAgentName?: string;
    };

    logger.info`Forking agent ${sourceAgentId} for new owner ${body.newOwnerId}`;

    // Check usage limits before fork/resume
    await context.services.agentMovements.checkAgentUsageLimits(body.newOwnerId);

    // Call the service method - forceNewAgent ensures we always create a new agent
    // (don't convert to resume when owner forks their own archived agent)
    const result = await context.services.agentMovements.forkOrResume({
      sourceAgentId,
      newOwnerId: body.newOwnerId,
      newAgentName: body.newAgentName,
      forceNewAgent: true
    });

    // Return success response
    return addCorsHeaders(Response.json({
      success: true,
      targetAgentId: result.targetAgentId,
      agent: result.agent,
      message: result.message
    }), context.origin);

  } catch (error) {
    const err = error as any;
    const errorMessage = err?.message || String(error);
    const errorStack = err?.stack || '';
    logger.error`Fork agent failed: ${errorMessage}`;
    if (errorStack) {
      console.error('[FORK-ERROR] Stack trace:', errorStack);
    }

    // Handle specific error cases

    // User not found
    if (err.message === 'User not found') {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'User not found'
      }, { status: 404 }), context.origin);
    }

    // Source agent not found
    if (err.message === 'Source agent not found') {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Source agent not found'
      }, { status: 404 }), context.origin);
    }

    // Access denied
    if (err.message === 'New owner must have read access to source agent') {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'New owner must have read access to source agent'
      }, { status: 403 }), context.origin);
    }

    // Machine pool exhausted
    if (err.code === 'MACHINE_POOL_EXHAUSTED') {
      return addCorsHeaders(Response.json({
        success: false,
        error: err.message,
        code: 'MACHINE_POOL_EXHAUSTED',
        details: err.details
      }, { status: 503 }), context.origin);
    }

    // Limit exceeded
    if (err.code === 'LIMIT_EXCEEDED') {
      return addCorsHeaders(Response.json({
        success: false,
        error: err.message,
        code: 'LIMIT_EXCEEDED',
        limitInfo: err.limitInfo
      }, { status: 429 }), context.origin);
    }

    // Source not running errors
    if (err.message.includes('source agent is not running')) {
      return addCorsHeaders(Response.json({
        success: false,
        error: err.message,
        code: 'SOURCE_NOT_RUNNING'
      }, { status: 400 }), context.origin);
    }

    // GitHub authentication errors (bad credentials, expired token, etc.)
    if (
      err.message?.includes('Bad credentials') ||
      err.message === 'GITHUB_AUTH_REQUIRED' ||
      err.status === 401
    ) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'GitHub authentication required. Please re-connect your GitHub account.',
        code: 'GITHUB_AUTH_REQUIRED'
      }, { status: 401 }), context.origin);
    }

    // Default error
    return addCorsHeaders(Response.json({
      success: false,
      error: err.message || 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
