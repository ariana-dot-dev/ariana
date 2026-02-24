import { ServiceContainer } from '../../services';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { addCorsHeaders } from '../../middleware/auth';
import { getLogger } from '../../utils/logger';

const logger = getLogger(['admin', 'api']);

// Valid metrics for historical data
const VALID_METRICS = [
  'totalUsers',
  'totalProjects',
  'totalAgents',
  'totalCommits',
  'pushedCommits',
  'agentsWithPushAndPR'
] as const;

// Valid cohort periods
const VALID_COHORT_PERIODS = ['daily', 'weekly', 'biweekly'] as const;
type CohortPeriod = typeof VALID_COHORT_PERIODS[number];

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

/**
 * Parse excludeUsers query parameter (comma-separated usernames to exclude from on-the-fly stats)
 */
function parseExcludeUsers(req: Request): string[] {
  const url = new URL(req.url);
  const param = url.searchParams.get('excludeUsers');
  if (!param) return [];
  return param.split(',').map(u => u.trim()).filter(u => u.length > 0);
}

/**
 * Get parking pool health metrics
 * GET /api/admin/parking-pool-health
 */
export async function handleGetParkingPoolHealth(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info`Admin: Getting parking pool health - userId: ${auth.user.id}`;

    const metrics = await context.services.agents.getParkingMetrics();

    // Calculate success rate
    const successRate = metrics.totalAttempts > 0
      ? (metrics.successfulParks / metrics.totalAttempts) * 100
      : 0;

    // Calculate health status
    const poolStatus = metrics.currentPoolSize >= metrics.poolTarget
      ? 'healthy'
      : metrics.currentPoolSize > 0
        ? 'degraded'
        : 'critical';

    const response = {
      success: true,
      health: {
        status: poolStatus,
        metrics: {
          ...metrics,
          successRate: Math.round(successRate * 100) / 100, // Round to 2 decimals
        },
        timestamp: new Date().toISOString()
      }
    };

    return addCorsHeaders(Response.json(response), context.origin);
  } catch (error) {
    logger.error`Admin: Failed to get parking pool health - error: ${error instanceof Error ? error.message : String(error)}`;

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve parking pool health'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get user distribution analytics (Chart 1)
 * GET /api/admin/analytics/user-distribution?excludeUsers=user1,user2
 */
export async function handleGetUserDistribution(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const excludeUsers = parseExcludeUsers(req);
    logger.info`Admin: Getting user distribution analytics - userId: ${auth.user.id}`;

    const data = await context.services.dashboardAnalytics.getUserDistributionData(excludeUsers);

    return addCorsHeaders(Response.json({
      success: true,
      data
    }), context.origin);
  } catch (error) {
    logger.error`Admin: Failed to get user distribution analytics - error: ${error instanceof Error ? error.message : String(error)}`;

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve user distribution analytics'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get retention cohort analytics (Chart 2)
 * GET /api/admin/analytics/retention-cohorts?excludeUsers=user1,user2
 */
export async function handleGetRetentionCohorts(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const excludeUsers = parseExcludeUsers(req);
    logger.info`Admin: Getting retention cohort analytics - userId: ${auth.user.id}`;

    const data = await context.services.dashboardAnalytics.getRetentionCohortData(excludeUsers);

    return addCorsHeaders(Response.json({
      success: true,
      data
    }), context.origin);
  } catch (error) {
    logger.error`Admin: Failed to get retention cohort analytics - error: ${error instanceof Error ? error.message : String(error)}`;

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve retention cohort analytics'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get session duration analytics (Chart 3)
 * GET /api/admin/analytics/session-duration?excludeUsers=user1,user2
 */
export async function handleGetSessionDuration(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const excludeUsers = parseExcludeUsers(req);
    logger.info`Admin: Getting session duration analytics - userId: ${auth.user.id}`;

    const data = await context.services.dashboardAnalytics.getSessionDurationData(excludeUsers);

    return addCorsHeaders(Response.json({
      success: true,
      data
    }), context.origin);
  } catch (error) {
    logger.error`Admin: Failed to get session duration analytics - error: ${error instanceof Error ? error.message : String(error)}`;

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve session duration analytics'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get dashboard stats
 * GET /api/admin/stats
 */
export async function handleGetDashboardStats(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info`Admin: Getting dashboard stats - userId: ${auth.user.id}`;

    const { services } = context;

    // Get all users with their GitHub profiles and per-user metrics
    const usersWithMetrics = await services.dashboardAnalytics.getUsersWithMetrics();

    // Get total projects count
    const totalProjects = await services.projects.getTotalProjectsCount();

    // Get total agents count from Agent model
    const totalAgents = await services.agents.getTotalAgentsCount();

    // Get commit stats (total and pushed)
    const commitStats = await services.dashboardAnalytics.getCommitStats();

    // Get agents with at least 1 push and 1 PR
    const agentStats = await services.dashboardAnalytics.getAgentWithPushAndPRStats();

    const response = {
      success: true,
      stats: {
        totalUsers: usersWithMetrics.length,
        users: usersWithMetrics,
        totalProjects,
        totalAgents,
        totalAgentCommits: commitStats.totalCommits,
        totalPushedCommits: commitStats.totalPushedCommits,
        pushedCommitsPercentage: commitStats.pushedCommitsPercentage,
        agentsWithPushAndPR: agentStats.agentsWithPushAndPR,
        agentsWithPushAndPRPercentage: agentStats.agentsWithPushAndPRPercentage,
      }
    };

    return addCorsHeaders(Response.json(response), context.origin);
  } catch (error) {
    logger.error`Admin: Failed to get dashboard stats - error: ${error instanceof Error ? error.message : String(error)}`;

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve dashboard stats'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get historical data for a specific metric
 * GET /api/admin/analytics/historical/:metric?days=30
 */
export async function handleGetHistoricalMetric(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest,
  metric: string
): Promise<Response> {
  try {
    logger.info(`Admin: Getting historical data for ${metric} - userId: ${auth.user.id}`);

    // Validate metric
    if (!VALID_METRICS.includes(metric as any)) {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Invalid metric. Valid metrics: ${VALID_METRICS.join(', ')}`
      }, { status: 400 }), context.origin);
    }

    // Get days parameter from query string
    const url = new URL(req.url);
    const daysParam = url.searchParams.get('days');
    const days = daysParam ? parseInt(daysParam, 10) : 30;

    if (isNaN(days) || days < 1 || days > 365) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Invalid days parameter. Must be between 1 and 365'
      }, { status: 400 }), context.origin);
    }

    const data = await context.services.dashboardSnapshot.getHistoricalMetric(
      metric as any,
      days
    );

    return addCorsHeaders(Response.json({
      success: true,
      metric,
      days,
      data
    }), context.origin);
  } catch (error) {
    logger.error(`Admin: Failed to get historical data for ${metric} - error: ${error instanceof Error ? error.message : String(error)}`);

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve historical data'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get all snapshots within a date range
 * GET /api/admin/analytics/snapshots?startDate=2024-01-01&endDate=2024-12-31
 */
export async function handleGetSnapshots(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info(`Admin: Getting snapshots - userId: ${auth.user.id}`);

    const url = new URL(req.url);
    const startDateParam = url.searchParams.get('startDate');
    const endDateParam = url.searchParams.get('endDate');

    // Default to last 30 days if not specified
    const endDate = endDateParam ? new Date(endDateParam) : new Date();
    const startDate = startDateParam
      ? new Date(startDateParam)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      }, { status: 400 }), context.origin);
    }

    if (startDate > endDate) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Start date must be before end date'
      }, { status: 400 }), context.origin);
    }

    const snapshots = await context.services.dashboardSnapshot.getSnapshotsByDateRange(
      startDate,
      endDate
    );

    return addCorsHeaders(Response.json({
      success: true,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      count: snapshots.length,
      snapshots
    }), context.origin);
  } catch (error) {
    logger.error(`Admin: Failed to get snapshots - error: ${error instanceof Error ? error.message : String(error)}`);

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve snapshots'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Manually trigger a snapshot capture
 * POST /api/admin/analytics/snapshot
 */
export async function handleCaptureSnapshot(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info(`Admin: Manually capturing snapshot - userId: ${auth.user.id}`);

    await context.services.scheduledJobs.captureSnapshotNow();

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Snapshot captured successfully'
    }), context.origin);
  } catch (error) {
    logger.error(`Admin: Failed to capture snapshot - error: ${error instanceof Error ? error.message : String(error)}`);

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to capture snapshot'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get activation rates by signup cohort
 * GET /api/admin/analytics/cohorts/activation?period=weekly&excludeUsers=user1,user2
 */
export async function handleGetActivationRates(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'weekly';
    const excludeUsers = parseExcludeUsers(req);

    if (!VALID_COHORT_PERIODS.includes(period as CohortPeriod)) {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Invalid period. Valid periods: ${VALID_COHORT_PERIODS.join(', ')}`
      }, { status: 400 }), context.origin);
    }

    logger.info(`Admin: Getting activation rates for period ${period} - userId: ${auth.user.id}`);

    const data = await context.services.dashboardAnalytics.getActivationRatesByCohort(period as CohortPeriod, excludeUsers);

    return addCorsHeaders(Response.json({
      success: true,
      period,
      data
    }), context.origin);
  } catch (error) {
    logger.error(`Admin: Failed to get activation rates - error: ${error instanceof Error ? error.message : String(error)}`);

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve activation rates'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get engagement progression by signup cohort
 * GET /api/admin/analytics/cohorts/engagement?period=weekly&excludeUsers=user1,user2
 */
export async function handleGetEngagementProgression(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'weekly';
    const excludeUsers = parseExcludeUsers(req);

    if (!VALID_COHORT_PERIODS.includes(period as CohortPeriod)) {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Invalid period. Valid periods: ${VALID_COHORT_PERIODS.join(', ')}`
      }, { status: 400 }), context.origin);
    }

    logger.info(`Admin: Getting engagement progression for period ${period} - userId: ${auth.user.id}`);

    const data = await context.services.dashboardAnalytics.getEngagementProgression(period as CohortPeriod, excludeUsers);

    return addCorsHeaders(Response.json({
      success: true,
      period,
      data
    }), context.origin);
  } catch (error) {
    logger.error(`Admin: Failed to get engagement progression - error: ${error instanceof Error ? error.message : String(error)}`);

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve engagement progression'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get time to first action by signup cohort
 * GET /api/admin/analytics/cohorts/time-to-action?period=weekly&excludeUsers=user1,user2
 */
export async function handleGetTimeToFirstAction(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'weekly';
    const excludeUsers = parseExcludeUsers(req);

    if (!VALID_COHORT_PERIODS.includes(period as CohortPeriod)) {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Invalid period. Valid periods: ${VALID_COHORT_PERIODS.join(', ')}`
      }, { status: 400 }), context.origin);
    }

    logger.info(`Admin: Getting time to first action for period ${period} - userId: ${auth.user.id}`);

    const data = await context.services.dashboardAnalytics.getTimeToFirstAction(period as CohortPeriod, excludeUsers);

    return addCorsHeaders(Response.json({
      success: true,
      period,
      data
    }), context.origin);
  } catch (error) {
    logger.error(`Admin: Failed to get time to first action - error: ${error instanceof Error ? error.message : String(error)}`);

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve time to first action'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get retention rates by signup cohort
 * GET /api/admin/analytics/cohorts/retention?period=weekly&excludeUsers=user1,user2
 */
export async function handleGetRetentionByCohort(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'weekly';
    const excludeUsers = parseExcludeUsers(req);

    if (!VALID_COHORT_PERIODS.includes(period as CohortPeriod)) {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Invalid period. Valid periods: ${VALID_COHORT_PERIODS.join(', ')}`
      }, { status: 400 }), context.origin);
    }

    logger.info(`Admin: Getting retention by cohort for period ${period} - userId: ${auth.user.id}`);

    const data = await context.services.dashboardAnalytics.getRetentionBySignupCohort(period as CohortPeriod, excludeUsers);

    return addCorsHeaders(Response.json({
      success: true,
      period,
      data
    }), context.origin);
  } catch (error) {
    logger.error(`Admin: Failed to get retention by cohort - error: ${error instanceof Error ? error.message : String(error)}`);

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve retention by cohort'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get success rates by signup cohort
 * GET /api/admin/analytics/cohorts/success?period=weekly&excludeUsers=user1,user2
 */
export async function handleGetSuccessRateByCohort(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') || 'weekly';
    const excludeUsers = parseExcludeUsers(req);

    if (!VALID_COHORT_PERIODS.includes(period as CohortPeriod)) {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Invalid period. Valid periods: ${VALID_COHORT_PERIODS.join(', ')}`
      }, { status: 400 }), context.origin);
    }

    logger.info(`Admin: Getting success rate by cohort for period ${period} - userId: ${auth.user.id}`);

    const data = await context.services.dashboardAnalytics.getSuccessRateByCohort(period as CohortPeriod, excludeUsers);

    return addCorsHeaders(Response.json({
      success: true,
      period,
      data
    }), context.origin);
  } catch (error) {
    logger.error(`Admin: Failed to get success rate by cohort - error: ${error instanceof Error ? error.message : String(error)}`);

    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to retrieve success rate by cohort'
    }, { status: 500 }), context.origin);
  }
}
