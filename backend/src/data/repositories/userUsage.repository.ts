import { PrismaClient, type UserUsage, type Prisma } from '../../../generated/prisma';
import type { ResourceType, LimitCheckResult } from '@/services/usageLimits.service';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['limits']);

export class UserUsageRepository {
  constructor(private prisma: PrismaClient) {}

  async findByUserId(userId: string): Promise<UserUsage | null> {
    const result = await this.prisma.userUsage.findUnique({
      where: { userId }
    });

    if (result) {
      logger.debug`Found usage for user ${userId}`;
    } else {
      logger.debug`No usage found for user ${userId}`;
    }

    return result;
  }

  async create(data: {
    id: string;
    userId: string;
    projectsTotal: number;
    agentsThisMonth: number;
    agentsMonthResetAt: Date;
  }): Promise<UserUsage> {
    logger.info`Creating usage for user ${data.userId}`;

    const result = await this.prisma.userUsage.create({
      data: {
        ...data,
        updatedAt: new Date()
      }
    });

    return result;
  }

  async update(userId: string, data: Prisma.UserUsageUpdateInput): Promise<UserUsage> {
    logger.info`Updating usage for user ${userId}`;

    const result = await this.prisma.userUsage.update({
      where: { userId },
      data: {
        ...data,
        updatedAt: new Date()
      }
    });

    return result;
  }

  async delete(userId: string): Promise<boolean> {
    try {
      await this.prisma.userUsage.delete({
        where: { userId }
      });
      logger.info`Deleted usage for user ${userId}`;
      return true;
    } catch (error) {
      logger.error`Failed to delete usage for user ${userId}: ${error}`;
      return false;
    }
  }

  /**
   * Check only the monthly agent limit without incrementing or checking rate limits
   * Used for lifetime extensions to avoid triggering rate limits
   */
  async checkMonthlyAgentLimit(userId: string): Promise<LimitCheckResult> {
    logger.info`Checking monthly agent limit for user ${userId}`;

    return await this.prisma.$transaction(async (tx) => {
      // Lock the UserUsage row and join with User and UserLimits
      const result = await tx.$queryRaw<Array<any>>`
        SELECT
          u.*,
          ul."maxAgentsPerMonth"
        FROM "UserUsage" u
        INNER JOIN "User" usr ON u."userId" = usr."id"
        INNER JOIN "UserLimits" ul ON usr."userLimitsTierId" = ul."id"
        WHERE u."userId" = ${userId}
        FOR UPDATE OF u
      `;

      if (!result || result.length === 0) {
        logger.warn`No usage found for user ${userId} - user does not exist`;
        return { allowed: false, userNotFound: true };
      }

      const usage = result[0];
      const now = Date.now();

      // Check if month needs reset
      const monthResetAt = usage.agentsMonthResetAt ? new Date(usage.agentsMonthResetAt).getTime() : 0;
      let agentsThisMonth = usage.agentsThisMonth;

      if (now > monthResetAt) {
        logger.info`User ${userId} monthly agent limit would reset - was ${agentsThisMonth}`;
        agentsThisMonth = 0;
      }

      // Check monthly limit
      if (agentsThisMonth >= usage.maxAgentsPerMonth) {
        logger.warn`BLOCKED: User ${userId} exceeded agent monthly limit - ${agentsThisMonth}/${usage.maxAgentsPerMonth}`;
        return {
          allowed: false,
          limitType: 'month',
          resourceType: 'agent',
          current: agentsThisMonth,
          max: usage.maxAgentsPerMonth,
          isMonthlyLimit: true
        };
      }

      logger.info`ALLOWED: User ${userId} has monthly agent capacity - ${agentsThisMonth}/${usage.maxAgentsPerMonth}`;
      return { allowed: true };
    });
  }

  /**
   * Increment monthly agent usage by 1 without checking or updating rate limits
   * Used for lifetime extensions
   */
  async incrementMonthlyAgentUsage(userId: string): Promise<void> {
    logger.info`Incrementing monthly agent usage for user ${userId}`;

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.$queryRaw<Array<any>>`
        SELECT
          u.*
        FROM "UserUsage" u
        WHERE u."userId" = ${userId}
        FOR UPDATE OF u
      `;

      if (!result || result.length === 0) {
        logger.warn`No usage found for user ${userId}`;
        return;
      }

      const usage = result[0];
      const now = Date.now();

      // Check if month needs reset
      const monthResetAt = usage.agentsMonthResetAt ? new Date(usage.agentsMonthResetAt).getTime() : 0;
      let agentsThisMonth = usage.agentsThisMonth;
      let updateData: any = { updatedAt: new Date() };

      if (now > monthResetAt) {
        logger.info`User ${userId} monthly agent limit reset - was ${agentsThisMonth}`;
        agentsThisMonth = 0;
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);
        nextMonth.setHours(0, 0, 0, 0);
        updateData.agentsMonthResetAt = nextMonth;
      }

      // Increment monthly count only
      const newMonthTotal = agentsThisMonth + 1;
      logger.info`Incrementing monthly agent count for user ${userId}: ${newMonthTotal}`;
      updateData.agentsThisMonth = newMonthTotal;

      await tx.userUsage.update({
        where: { userId },
        data: updateData
      });
    });
  }

  /**
   * Atomically check and increment usage in a single transaction with row-level locking.
   * This prevents race conditions when multiple requests try to create resources concurrently.
   */
  async checkAndIncrementUsage(
    userId: string,
    resourceType: ResourceType
  ): Promise<LimitCheckResult> {
    logger.info`Checking ${resourceType} limit for user ${userId}`;

    return await this.prisma.$transaction(async (tx) => {
      // Lock the UserUsage row and join with User and UserLimits
      const result = await tx.$queryRaw<Array<any>>`
        SELECT
          u.*,
          ul."maxProjectsTotal",
          ul."maxProjectsPerMinute",
          ul."maxProjectsPer24Hours",
          ul."maxAgentsPerMonth",
          ul."maxAgentsPerMinute",
          ul."maxAgentsPer24Hours",
          ul."maxPromptsPerMinute",
          ul."maxPromptsPer24Hours"
        FROM "UserUsage" u
        INNER JOIN "User" usr ON u."userId" = usr."id"
        INNER JOIN "UserLimits" ul ON usr."userLimitsTierId" = ul."id"
        WHERE u."userId" = ${userId}
        FOR UPDATE OF u
      `;

      if (!result || result.length === 0) {
        logger.warn`No usage found for user ${userId} - user does not exist`;
        return { allowed: false, userNotFound: true };
      }

      const usage = result[0];
      const limit = usage; // Combined usage + limits in one object
      const now = Date.now();
      const oneMinuteAgo = now - 60 * 1000;
      const oneDayAgo = now - 24 * 60 * 60 * 1000;

      // Helper to filter timestamps
      const filterTimestamps = (timestamps: any, cutoff: number): number[] => {
        if (!timestamps) return [];
        const arr = Array.isArray(timestamps) ? timestamps : JSON.parse(timestamps as string);
        return arr.filter((ts: any) => typeof ts === 'number' && ts > cutoff);
      };

      // Helper to add timestamp
      const addTimestamp = (timestamps: any, cutoff: number): number[] => {
        const filtered = filterTimestamps(timestamps, cutoff);
        return [...filtered, now];
      };

      // Check limits and prepare update data based on resource type
      let checkResult: LimitCheckResult = { allowed: true };
      let updateData: any = { updatedAt: new Date() };

      switch (resourceType) {
        case 'project': {
          // Check total limit
          if (limit.projectsTotal >= limit.maxProjectsTotal) {
            logger.warn`BLOCKED: User ${userId} exceeded project total limit - ${limit.projectsTotal}/${limit.maxProjectsTotal}`;
            return {
              allowed: false,
              limitType: 'total',
              resourceType: 'project',
              current: limit.projectsTotal,
              max: limit.maxProjectsTotal,
              isMonthlyLimit: false
            };
          }

          // Check per-minute limit
          if (limit.maxProjectsPerMinute > 0) {
            const recentMinute = filterTimestamps(limit.projectsLastMinute, oneMinuteAgo);
            if (recentMinute.length >= limit.maxProjectsPerMinute) {
              logger.warn`BLOCKED: User ${userId} exceeded project per-minute limit - ${recentMinute.length}/${limit.maxProjectsPerMinute}`;
              return {
                allowed: false,
                limitType: 'minute',
                resourceType: 'project',
                current: recentMinute.length,
                max: limit.maxProjectsPerMinute,
                isMonthlyLimit: false
              };
            }
          }

          // Check per-day limit
          if (limit.maxProjectsPer24Hours > 0) {
            const recentDay = filterTimestamps(limit.projectsLast24Hours, oneDayAgo);
            if (recentDay.length >= limit.maxProjectsPer24Hours) {
              logger.warn`BLOCKED: User ${userId} exceeded project per-day limit - ${recentDay.length}/${limit.maxProjectsPer24Hours}`;
              return {
                allowed: false,
                limitType: 'day',
                resourceType: 'project',
                current: recentDay.length,
                max: limit.maxProjectsPer24Hours,
                isMonthlyLimit: false
              };
            }
          }

          // Passed all checks - prepare increment
          const newTotal = limit.projectsTotal + 1;
          logger.info`ALLOWED: User ${userId} project creation - new total: ${newTotal}/${limit.maxProjectsTotal}`;
          updateData.projectsTotal = newTotal;
          updateData.projectsLastMinute = addTimestamp(limit.projectsLastMinute, oneMinuteAgo);
          updateData.projectsLast24Hours = addTimestamp(limit.projectsLast24Hours, oneDayAgo);
          break;
        }

        case 'agent': {
          // Check if month needs reset
          const monthResetAt = limit.agentsMonthResetAt ? new Date(limit.agentsMonthResetAt).getTime() : 0;
          let agentsThisMonth = limit.agentsThisMonth;

          if (now > monthResetAt) {
            logger.info`User ${userId} monthly agent limit reset - was ${agentsThisMonth}`;
            agentsThisMonth = 0;
            const nextMonth = new Date();
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            nextMonth.setDate(1);
            nextMonth.setHours(0, 0, 0, 0);
            updateData.agentsMonthResetAt = nextMonth;
          }

          // Check monthly limit
          if (agentsThisMonth >= limit.maxAgentsPerMonth) {
            logger.warn`BLOCKED: User ${userId} exceeded agent monthly limit - ${agentsThisMonth}/${limit.maxAgentsPerMonth}`;
            return {
              allowed: false,
              limitType: 'month',
              resourceType: 'agent',
              current: agentsThisMonth,
              max: limit.maxAgentsPerMonth,
              isMonthlyLimit: true
            };
          }

          // Check per-minute limit
          if (limit.maxAgentsPerMinute > 0) {
            const recentMinute = filterTimestamps(limit.agentsLastMinute, oneMinuteAgo);
            if (recentMinute.length >= limit.maxAgentsPerMinute) {
              logger.warn`BLOCKED: User ${userId} exceeded agent per-minute limit - ${recentMinute.length}/${limit.maxAgentsPerMinute}`;
              return {
                allowed: false,
                limitType: 'minute',
                resourceType: 'agent',
                current: recentMinute.length,
                max: limit.maxAgentsPerMinute,
                isMonthlyLimit: false
              };
            }
          }

          // Check per-day limit
          if (limit.maxAgentsPer24Hours > 0) {
            const recentDay = filterTimestamps(limit.agentsLast24Hours, oneDayAgo);
            if (recentDay.length >= limit.maxAgentsPer24Hours) {
              logger.warn`BLOCKED: User ${userId} exceeded agent per-day limit - ${recentDay.length}/${limit.maxAgentsPer24Hours}`;
              return {
                allowed: false,
                limitType: 'day',
                resourceType: 'agent',
                current: recentDay.length,
                max: limit.maxAgentsPer24Hours,
                isMonthlyLimit: false
              };
            }
          }

          // Passed all checks - prepare increment
          const newMonthTotal = agentsThisMonth + 1;
          logger.info`ALLOWED: User ${userId} agent creation - monthly: ${newMonthTotal}/${limit.maxAgentsPerMonth}`;
          updateData.agentsThisMonth = newMonthTotal;
          updateData.agentsLastMinute = addTimestamp(limit.agentsLastMinute, oneMinuteAgo);
          updateData.agentsLast24Hours = addTimestamp(limit.agentsLast24Hours, oneDayAgo);
          break;
        }

        case 'prompt': {
          // No total limit for prompts

          // Check per-minute limit
          if (limit.maxPromptsPerMinute > 0) {
            const recentMinute = filterTimestamps(limit.promptsLastMinute, oneMinuteAgo);
            if (recentMinute.length >= limit.maxPromptsPerMinute) {
              logger.warn`BLOCKED: User ${userId} exceeded prompt per-minute limit - ${recentMinute.length}/${limit.maxPromptsPerMinute}`;
              return {
                allowed: false,
                limitType: 'minute',
                resourceType: 'prompt',
                current: recentMinute.length,
                max: limit.maxPromptsPerMinute,
                isMonthlyLimit: false
              };
            }
          }

          // Check per-day limit
          if (limit.maxPromptsPer24Hours > 0) {
            const recentDay = filterTimestamps(limit.promptsLast24Hours, oneDayAgo);
            if (recentDay.length >= limit.maxPromptsPer24Hours) {
              logger.warn`BLOCKED: User ${userId} exceeded prompt per-day limit - ${recentDay.length}/${limit.maxPromptsPer24Hours}`;
              return {
                allowed: false,
                limitType: 'day',
                resourceType: 'prompt',
                current: recentDay.length,
                max: limit.maxPromptsPer24Hours,
                isMonthlyLimit: false
              };
            }
          }

          // Passed all checks - prepare increment
          logger.info`ALLOWED: User ${userId} prompt submission`;
          updateData.promptsLastMinute = addTimestamp(limit.promptsLastMinute, oneMinuteAgo);
          updateData.promptsLast24Hours = addTimestamp(limit.promptsLast24Hours, oneDayAgo);
          break;
        }

        default:
          logger.error`BLOCKED: User ${userId} - unknown resource type: ${resourceType}`;
          return { allowed: false };
      }

      // Atomically update the usage counters (still holding the lock)
      await tx.userUsage.update({
        where: { userId },
        data: updateData
      });

      logger.debug`Successfully updated usage counters for user ${userId} (${resourceType})`;
      return checkResult;
    });
  }
}
