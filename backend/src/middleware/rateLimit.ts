import type { ServiceContainer } from '@/services';
import type { IPResourceType } from '@/services/ipRateLimiting.service';
import { extractIPAddress } from '@/utils/ipExtraction';
import { addCorsHeaders } from './auth';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['middleware', 'rateLimit']);

export interface RateLimitContext {
  services: ServiceContainer;
  origin: string | null;
}

/**
 * Creates a rate limiting middleware for specific resource types
 */
export function createResourceRateLimit(resourceType: IPResourceType) {
  return async (
    req: Request,
    context: RateLimitContext,
    next: () => Promise<Response>
  ): Promise<Response> => {
    const ipAddress = extractIPAddress(req);

    const ipLimitCheck = context.services.ipRateLimiting.checkIPLimit(ipAddress, resourceType);
    if (!ipLimitCheck.allowed) {
      logger.warn(`IP rate limit exceeded for ${resourceType} - ip: ${ipAddress}`);
      return addCorsHeaders(Response.json({
        error: ipLimitCheck.reason || 'Rate limit exceeded',
        code: 'IP_RATE_LIMIT_EXCEEDED',
        retryAfter: ipLimitCheck.retryAfter
      }, { status: 429 }), context.origin);
    }

    // Record the action immediately (whether success or failure)
    context.services.ipRateLimiting.recordIPAction(ipAddress, resourceType);

    return next();
  };
}

/**
 * General rate limiting middleware for all endpoints
 */
export async function generalRateLimit(
  req: Request,
  context: RateLimitContext,
  next: () => Promise<Response>
): Promise<Response> {
  const ipAddress = extractIPAddress(req);

  const ipLimitCheck = context.services.ipRateLimiting.checkIPLimit(ipAddress, 'general');
  if (!ipLimitCheck.allowed) {
    logger.warn(`General IP rate limit exceeded - ip: ${ipAddress}`);
    return addCorsHeaders(Response.json({
      error: ipLimitCheck.reason || 'Rate limit exceeded',
      code: 'IP_RATE_LIMIT_EXCEEDED',
      retryAfter: ipLimitCheck.retryAfter
    }, { status: 429 }), context.origin);
  }

  // Record the action immediately
  context.services.ipRateLimiting.recordIPAction(ipAddress, 'general');

  return next();
}
