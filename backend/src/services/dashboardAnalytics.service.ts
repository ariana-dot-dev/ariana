import { RepositoryContainer } from '../data/repositories';
import type {
  CommitStats,
  AgentWithPushAndPRStats,
  UserDistributionByCount,
  RetentionCohortData,
  SessionDurationData,
  CohortPeriod,
  ActivationRateData,
  EngagementProgressionData,
  TimeToFirstActionData,
  RetentionByWeekData,
  SuccessRateByCohortData,
  UserWithMetrics
} from '../data/repositories/dashboardAnalytics.repository';

export class DashboardAnalyticsService {
  constructor(private repositories: RepositoryContainer) {}

  async getCommitStats(): Promise<CommitStats> {
    return this.repositories.dashboardAnalytics.getCommitStats();
  }

  async getAgentWithPushAndPRStats(): Promise<AgentWithPushAndPRStats> {
    return this.repositories.dashboardAnalytics.getAgentWithPushAndPRStats();
  }

  async getUsersWithMetrics(): Promise<UserWithMetrics[]> {
    return this.repositories.dashboardAnalytics.getUsersWithMetrics();
  }

  async getUserDistributionData(excludeUsers: string[] = []): Promise<UserDistributionByCount[]> {
    return this.repositories.dashboardAnalytics.getUserDistributionData(excludeUsers);
  }

  async getRetentionCohortData(excludeUsers: string[] = []): Promise<RetentionCohortData[]> {
    return this.repositories.dashboardAnalytics.getRetentionCohortData(excludeUsers);
  }

  async getSessionDurationData(excludeUsers: string[] = []): Promise<SessionDurationData[]> {
    return this.repositories.dashboardAnalytics.getSessionDurationData(excludeUsers);
  }

  // Cohort analytics methods
  async getActivationRatesByCohort(period: CohortPeriod, excludeUsers: string[] = []): Promise<ActivationRateData[]> {
    return this.repositories.dashboardAnalytics.getActivationRatesByCohort(period, excludeUsers);
  }

  async getEngagementProgression(period: CohortPeriod, excludeUsers: string[] = []): Promise<EngagementProgressionData[]> {
    return this.repositories.dashboardAnalytics.getEngagementProgression(period, excludeUsers);
  }

  async getTimeToFirstAction(period: CohortPeriod, excludeUsers: string[] = []): Promise<TimeToFirstActionData[]> {
    return this.repositories.dashboardAnalytics.getTimeToFirstAction(period, excludeUsers);
  }

  async getRetentionBySignupCohort(period: CohortPeriod, excludeUsers: string[] = []): Promise<RetentionByWeekData[]> {
    return this.repositories.dashboardAnalytics.getRetentionBySignupCohort(period, excludeUsers);
  }

  async getSuccessRateByCohort(period: CohortPeriod, excludeUsers: string[] = []): Promise<SuccessRateByCohortData[]> {
    return this.repositories.dashboardAnalytics.getSuccessRateByCohort(period, excludeUsers);
  }
}
