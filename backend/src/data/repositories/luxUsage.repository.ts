import { PrismaClient, type LuxUsageRecord } from '../../../generated/prisma';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['luxUsage']);

export class LuxUsageRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: {
    id: string;
    userId: string;
    agentId: string;
    projectId: string;
    sessionId: string;
    model: string;
    task: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    actionsReturned: number;
    stopped: boolean;
    reason?: string | null;
  }): Promise<LuxUsageRecord> {
    return await this.prisma.luxUsageRecord.create({ data });
  }

  async getByUserId(userId: string): Promise<LuxUsageRecord[]> {
    return await this.prisma.luxUsageRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getByAgentId(agentId: string): Promise<LuxUsageRecord[]> {
    return await this.prisma.luxUsageRecord.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBySessionId(sessionId: string): Promise<LuxUsageRecord[]> {
    return await this.prisma.luxUsageRecord.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get aggregated usage stats for a user since a given date
   */
  async getUserUsageSince(userId: string, since: Date): Promise<{
    sessions: number;
    steps: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }> {
    const result = await this.prisma.luxUsageRecord.aggregate({
      where: {
        userId,
        createdAt: { gte: since },
      },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
      },
      _count: true,
    });

    // Count distinct sessions
    const sessionCount = await this.prisma.luxUsageRecord.groupBy({
      by: ['sessionId'],
      where: {
        userId,
        createdAt: { gte: since },
      },
    });

    return {
      sessions: sessionCount.length,
      steps: result._count,
      promptTokens: result._sum.promptTokens || 0,
      completionTokens: result._sum.completionTokens || 0,
      totalTokens: result._sum.totalTokens || 0,
    };
  }

  /**
   * Count steps in a specific session
   */
  async getSessionStepCount(sessionId: string): Promise<number> {
    return await this.prisma.luxUsageRecord.count({
      where: { sessionId },
    });
  }

  /**
   * Count sessions for a user since a given date
   */
  async getUserSessionCountSince(userId: string, since: Date): Promise<number> {
    const sessions = await this.prisma.luxUsageRecord.groupBy({
      by: ['sessionId'],
      where: {
        userId,
        createdAt: { gte: since },
      },
    });
    return sessions.length;
  }

  /**
   * Delete all records for a given agent (called on agent deletion)
   */
  async deleteByAgentId(agentId: string): Promise<number> {
    const result = await this.prisma.luxUsageRecord.deleteMany({
      where: { agentId },
    });
    logger.info`Deleted ${result.count} LUX usage records for agent ${agentId}`;
    return result.count;
  }
}
