import { PrismaClient } from '../../../generated/prisma';
import type {
  UserDistributionByCount,
  RetentionCohortData,
  SessionDurationData
} from './dashboardAnalytics.repository';

export interface DashboardSnapshotData {
  snapshotDate: Date;
  totalUsers: number;
  totalProjects: number;
  totalAgents: number;
  agentsWithPushAndPR: number;
  totalCommits: number;
  pushedCommits: number;
  usersByAgentCount: Array<{ count: number; users: number }>;
  usersByPromptCount: Array<{ count: number; users: number }>;
  usersByPRCount: Array<{ count: number; users: number }>;
  retentionNoGap: Array<{ day: number; users: number }>;
  retentionGap1Day: Array<{ day: number; users: number }>;
  retentionGap3Days: Array<{ day: number; users: number }>;
  retentionGap7Days: Array<{ day: number; users: number }>;
  sessionDurationDist: Array<{ halfHours: number; users: number }>;
}

export interface HistoricalDataPoint {
  date: Date;
  value: number;
}

export class DashboardSnapshotRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new dashboard snapshot
   */
  async createSnapshot(data: DashboardSnapshotData): Promise<void> {
    const id = `snapshot_${data.snapshotDate.getTime()}`;

    await this.prisma.dashboardSnapshot.create({
      data: {
        id,
        snapshotDate: data.snapshotDate,
        totalUsers: data.totalUsers,
        totalProjects: data.totalProjects,
        totalAgents: data.totalAgents,
        agentsWithPushAndPR: data.agentsWithPushAndPR,
        totalCommits: data.totalCommits,
        pushedCommits: data.pushedCommits,
        usersByAgentCount: data.usersByAgentCount,
        usersByPromptCount: data.usersByPromptCount,
        usersByPRCount: data.usersByPRCount,
        retentionNoGap: data.retentionNoGap,
        retentionGap1Day: data.retentionGap1Day,
        retentionGap3Days: data.retentionGap3Days,
        retentionGap7Days: data.retentionGap7Days,
        sessionDurationDist: data.sessionDurationDist,
      }
    });
  }

  /**
   * Get the most recent snapshot
   */
  async getLatestSnapshot() {
    return this.prisma.dashboardSnapshot.findFirst({
      orderBy: {
        snapshotDate: 'desc'
      }
    });
  }

  /**
   * Get snapshot for a specific date
   */
  async getSnapshotByDate(date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    return this.prisma.dashboardSnapshot.findFirst({
      where: {
        snapshotDate: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    });
  }

  /**
   * Get all snapshots within a date range
   */
  async getSnapshotsByDateRange(startDate: Date, endDate: Date) {
    return this.prisma.dashboardSnapshot.findMany({
      where: {
        snapshotDate: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: {
        snapshotDate: 'asc'
      }
    });
  }

  /**
   * Get historical data for a specific metric
   */
  async getHistoricalMetric(
    metric: 'totalUsers' | 'totalProjects' | 'totalAgents' | 'totalCommits' | 'pushedCommits' | 'agentsWithPushAndPR',
    days: number = 30
  ): Promise<HistoricalDataPoint[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const snapshots = await this.getSnapshotsByDateRange(startDate, new Date());

    return snapshots.map(snapshot => ({
      date: snapshot.snapshotDate,
      value: snapshot[metric]
    }));
  }

  /**
   * Check if snapshot exists for today
   */
  async hasSnapshotForToday(): Promise<boolean> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const count = await this.prisma.dashboardSnapshot.count({
      where: {
        snapshotDate: {
          gte: today,
          lt: tomorrow
        }
      }
    });

    return count > 0;
  }

  /**
   * Delete old snapshots (optional cleanup)
   */
  async deleteSnapshotsOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.prisma.dashboardSnapshot.deleteMany({
      where: {
        snapshotDate: {
          lt: cutoffDate
        }
      }
    });

    return result.count;
  }
}
