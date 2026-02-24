import type { RepositoryContainer } from '@/data/repositories';
import { randomUUID } from 'crypto';
import { getLogger } from '../utils/logger';

const logger = getLogger(['usageLimits']);

export type ResourceType = 'project' | 'agent' | 'prompt';
export type LimitPeriod = 'minute' | 'day' | 'month' | 'total';

export interface LimitCheckResult {
  allowed: boolean;
  userNotFound?: boolean; // True if user doesn't exist in database
  limitType?: LimitPeriod; // Which limit was exceeded
  resourceType?: ResourceType;
  current?: number;
  max?: number;
  isMonthlyLimit?: boolean; // True only for agent monthly limits
}

export const LIMIT_TIER_ANONYMOUS = 'anonymous';
export const LIMIT_TIER_GITHUB = 'github';

export class UsageLimitsService {
  constructor(private repositories: RepositoryContainer) {}

  /**
   * Initialize usage tracking for a new user
   * The user's limit tier is set when the user is created
   */
  async initializeUserUsage(userId: string): Promise<void> {
    try {
      const now = new Date();
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      nextMonth.setDate(1);
      nextMonth.setHours(0, 0, 0, 0);

      await this.repositories.userUsage.create({
        id: randomUUID(),
        userId,
        projectsTotal: 0,
        agentsThisMonth: 0,
        agentsMonthResetAt: nextMonth
      });

      logger.info(`Usage tracking initialized for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to initialize usage for user ${userId}: ${error}`);
      throw error;
    }
  }

  /**
   * Atomically check and increment usage in a single transaction.
   * This prevents race conditions when multiple requests try to create resources concurrently.
   */
  async checkAndIncrementUsage(userId: string, resourceType: ResourceType): Promise<LimitCheckResult> {
    try {
      return await this.repositories.userUsage.checkAndIncrementUsage(userId, resourceType);
    } catch (error) {
      logger.error(`Failed to check and increment usage for user ${userId}, resource ${resourceType}: ${error}`);
      return { allowed: false };
    }
  }

  /**
   * Check only the monthly agent limit without incrementing
   * Used for lifetime extensions to avoid rate limit issues
   */
  async checkMonthlyAgentLimit(userId: string): Promise<LimitCheckResult> {
    try {
      return await this.repositories.userUsage.checkMonthlyAgentLimit(userId);
    } catch (error) {
      logger.error(`Failed to check monthly agent limit for user ${userId}: ${error}`);
      return { allowed: false };
    }
  }

  /**
   * Increment monthly agent usage by 1 without hitting rate limits
   * Used for lifetime extensions
   */
  async incrementMonthlyAgentUsage(userId: string): Promise<void> {
    try {
      await this.repositories.userUsage.incrementMonthlyAgentUsage(userId);
    } catch (error) {
      logger.error(`Failed to increment monthly agent usage for user ${userId}: ${error}`);
      throw error;
    }
  }

  /**
   * Upgrade user from anonymous to GitHub tier
   * Only upgrades if user is currently on anonymous tier (doesn't downgrade paying users)
   */
  async upgradeToGitHubTier(userId: string): Promise<void> {
    try {
      const result = await this.repositories.prisma.user.updateMany({
        where: { id: userId, userLimitsTierId: LIMIT_TIER_ANONYMOUS },
        data: { userLimitsTierId: LIMIT_TIER_GITHUB }
      });

      if (result.count > 0) {
        logger.info(`Upgraded user ${userId} from anonymous to GitHub tier`);
      } else {
        logger.debug(`User ${userId} not on anonymous tier, skipping upgrade`);
      }
    } catch (error) {
      logger.error(`Failed to upgrade user ${userId} to GitHub tier: ${error}`);
      throw error;
    }
  }
}
