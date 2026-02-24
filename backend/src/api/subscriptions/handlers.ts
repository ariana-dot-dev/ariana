import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['api', 'subscriptions']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

/**
 * Get current user's subscription plan ID
 */
export async function handleGetCurrentPlan(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const user = await context.services.users.getUserById(auth.user.id);

    if (!user) {
      logger.warn`User not found - userId: ${auth.user.id}`;
      return addCorsHeaders(Response.json({
        success: false,
        error: 'User not found'
      }, { status: 404 }), context.origin);
    }

    const planId = user.subscriptionPlanId || 'free';

    logger.debug`Current plan retrieved - userId: ${auth.user.id}, planId: ${planId}`;

    return addCorsHeaders(Response.json({
      success: true,
      planId,
      subscriptionCancelAt: user.subscriptionCancelAt,
    }), context.origin);
  } catch (error) {
    logger.error`Get current plan failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get current plan'
    }, { status: 500 }), context.origin);
  }
}
