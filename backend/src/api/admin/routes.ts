import { ServiceContainer } from '../../services';
import { addCorsHeaders, createAuthErrorResponse } from '../../middleware/auth';
import { requireAdminAsync } from '../../middleware/admin';
import type { AuthenticatedRequest } from '../../middleware/auth';
import {
  handleGetParkingPoolHealth,
  handleGetDashboardStats,
  handleGetUserDistribution,
  handleGetRetentionCohorts,
  handleGetSessionDuration,
  handleGetHistoricalMetric,
  handleGetSnapshots,
  handleCaptureSnapshot,
  handleGetActivationRates,
  handleGetEngagementProgression,
  handleGetTimeToFirstAction,
  handleGetRetentionByCohort,
  handleGetSuccessRateByCohort,
  type RequestContext
} from './handlers';

// Route admin endpoints
export async function handleAdminRoutes(
  req: Request,
  url: URL,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  const context: RequestContext = { services, origin };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 200 }), origin);
  }

  // Admin auth check for all admin endpoints
  let auth: AuthenticatedRequest;
  try {
    auth = await requireAdminAsync(req, services);
  } catch (error) {
    return createAuthErrorResponse(error as Error, origin);
  }

  // GET /api/admin/parking-pool-health
  if (url.pathname === '/api/admin/parking-pool-health' && req.method === 'GET') {
    return await handleGetParkingPoolHealth(req, context, auth);
  }

  // GET /api/admin/stats
  if (url.pathname === '/api/admin/stats' && req.method === 'GET') {
    return await handleGetDashboardStats(req, context, auth);
  }

  // GET /api/admin/analytics/user-distribution
  if (url.pathname === '/api/admin/analytics/user-distribution' && req.method === 'GET') {
    return await handleGetUserDistribution(req, context, auth);
  }

  // GET /api/admin/analytics/retention-cohorts
  if (url.pathname === '/api/admin/analytics/retention-cohorts' && req.method === 'GET') {
    return await handleGetRetentionCohorts(req, context, auth);
  }

  // GET /api/admin/analytics/session-duration
  if (url.pathname === '/api/admin/analytics/session-duration' && req.method === 'GET') {
    return await handleGetSessionDuration(req, context, auth);
  }

  // GET /api/admin/analytics/historical/:metric
  if (url.pathname.startsWith('/api/admin/analytics/historical/') && req.method === 'GET') {
    const metric = url.pathname.split('/').pop();
    if (metric) {
      return await handleGetHistoricalMetric(req, context, auth, metric);
    }
  }

  // GET /api/admin/analytics/snapshots
  if (url.pathname === '/api/admin/analytics/snapshots' && req.method === 'GET') {
    return await handleGetSnapshots(req, context, auth);
  }

  // POST /api/admin/analytics/snapshot
  if (url.pathname === '/api/admin/analytics/snapshot' && req.method === 'POST') {
    return await handleCaptureSnapshot(req, context, auth);
  }

  // Cohort Analytics Endpoints
  // GET /api/admin/analytics/cohorts/activation
  if (url.pathname === '/api/admin/analytics/cohorts/activation' && req.method === 'GET') {
    return await handleGetActivationRates(req, context, auth);
  }

  // GET /api/admin/analytics/cohorts/engagement
  if (url.pathname === '/api/admin/analytics/cohorts/engagement' && req.method === 'GET') {
    return await handleGetEngagementProgression(req, context, auth);
  }

  // GET /api/admin/analytics/cohorts/time-to-action
  if (url.pathname === '/api/admin/analytics/cohorts/time-to-action' && req.method === 'GET') {
    return await handleGetTimeToFirstAction(req, context, auth);
  }

  // GET /api/admin/analytics/cohorts/retention
  if (url.pathname === '/api/admin/analytics/cohorts/retention' && req.method === 'GET') {
    return await handleGetRetentionByCohort(req, context, auth);
  }

  // GET /api/admin/analytics/cohorts/success
  if (url.pathname === '/api/admin/analytics/cohorts/success' && req.method === 'GET') {
    return await handleGetSuccessRateByCohort(req, context, auth);
  }

  return null;
}
