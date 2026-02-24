import { RepositoryContainer } from '../data/repositories';
import type { DashboardSnapshotData } from '../data/repositories/dashboardSnapshot.repository';
import { getLogger } from '../utils/logger';

const logger = getLogger(['dashboard', 'snapshot']);

export class DashboardSnapshotService {
  constructor(private repositories: RepositoryContainer) {}

  /**
   * Capture a snapshot of all current dashboard analytics
   */
  async captureSnapshot(): Promise<void> {
    try {
      const snapshotDate = new Date();
      snapshotDate.setUTCHours(0, 0, 0, 0);

      // Check if snapshot already exists for today
      const existingSnapshot = await this.repositories.dashboardSnapshot.hasSnapshotForToday();
      if (existingSnapshot) {
        logger.info('Snapshot already exists for today, skipping capture');
        return;
      }

      logger.info('Capturing dashboard snapshot...');

      // Gather all analytics data
      const [
        userCount,
        projectCount,
        agentStats,
        commitStats,
        userDistribution,
        retentionData,
        sessionDuration
      ] = await Promise.all([
        this.repositories.prisma.user.count(),
        this.repositories.prisma.project.count(),
        this.repositories.dashboardAnalytics.getAgentWithPushAndPRStats(),
        this.repositories.dashboardAnalytics.getCommitStats(),
        this.repositories.dashboardAnalytics.getUserDistributionData(),
        this.repositories.dashboardAnalytics.getRetentionCohortData(),
        this.repositories.dashboardAnalytics.getSessionDurationData()
      ]);

      // Transform user distribution data into separate arrays
      const usersByAgentCount = userDistribution.map(d => ({
        count: d.count,
        users: d.usersByAgents
      }));

      const usersByPromptCount = userDistribution.map(d => ({
        count: d.count,
        users: d.usersByPrompts
      }));

      const usersByPRCount = userDistribution.map(d => ({
        count: d.count,
        users: d.usersByAgentsWithPR
      }));

      // Transform retention data
      const retentionNoGap = retentionData.map(d => ({
        day: d.dayNumber,
        users: d.users0DayGap
      }));

      const retentionGap1Day = retentionData.map(d => ({
        day: d.dayNumber,
        users: d.users1DayGap
      }));

      const retentionGap3Days = retentionData.map(d => ({
        day: d.dayNumber,
        users: d.users3DayGap
      }));

      const retentionGap7Days = retentionData.map(d => ({
        day: d.dayNumber,
        users: d.users7DayGap
      }));

      // Transform session duration data
      const sessionDurationDist = sessionDuration.map(d => ({
        halfHours: d.halfHourBucket,
        users: d.userCount
      }));

      const snapshotData: DashboardSnapshotData = {
        snapshotDate,
        totalUsers: userCount,
        totalProjects: projectCount,
        totalAgents: agentStats.totalAgents,
        agentsWithPushAndPR: agentStats.agentsWithPushAndPR,
        totalCommits: commitStats.totalCommits,
        pushedCommits: commitStats.totalPushedCommits,
        usersByAgentCount,
        usersByPromptCount,
        usersByPRCount,
        retentionNoGap,
        retentionGap1Day,
        retentionGap3Days,
        retentionGap7Days,
        sessionDurationDist
      };

      await this.repositories.dashboardSnapshot.createSnapshot(snapshotData);

      logger.info('Dashboard snapshot captured successfully', {
        snapshotDate: snapshotDate.toISOString(),
        totalUsers: userCount,
        totalProjects: projectCount,
        totalAgents: agentStats.totalAgents
      });
    } catch (error) {
      logger.error('Failed to capture dashboard snapshot', { error });
      throw error;
    }
  }

  /**
   * Get historical data for a specific metric
   */
  async getHistoricalMetric(
    metric: 'totalUsers' | 'totalProjects' | 'totalAgents' | 'totalCommits' | 'pushedCommits' | 'agentsWithPushAndPR',
    days: number = 30
  ) {
    return this.repositories.dashboardSnapshot.getHistoricalMetric(metric, days);
  }

  /**
   * Get all snapshots within a date range
   */
  async getSnapshotsByDateRange(startDate: Date, endDate: Date) {
    return this.repositories.dashboardSnapshot.getSnapshotsByDateRange(startDate, endDate);
  }

  /**
   * Cleanup old snapshots (optional maintenance task)
   */
  async cleanupOldSnapshots(retentionDays: number = 365): Promise<number> {
    logger.info(`Cleaning up snapshots older than ${retentionDays} days`);
    const deletedCount = await this.repositories.dashboardSnapshot.deleteSnapshotsOlderThan(retentionDays);
    logger.info(`Deleted ${deletedCount} old snapshots`);
    return deletedCount;
  }
}
