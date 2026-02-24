import { PrismaClient, type UserLimits } from '../../../generated/prisma';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['limits']);

export class UserLimitsRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<UserLimits | null> {
    const result = await this.prisma.userLimits.findUnique({
      where: { id }
    });

    if (result) {
      logger.debug`Found limit tier ${id}: ${result.label}`;
    } else {
      logger.debug`Limit tier not found: ${id}`;
    }

    return result;
  }

  async findAll(): Promise<UserLimits[]> {
    return await this.prisma.userLimits.findMany();
  }

  async create(data: {
    id: string;
    label: string;
    maxProjectsTotal: number;
    maxProjectsPerMinute: number;
    maxProjectsPer24Hours: number;
    maxAgentsPerMonth: number;
    maxAgentsPerMinute: number;
    maxAgentsPer24Hours: number;
    maxSpecificationsTotal: number;
    maxSpecificationsPerMinute: number;
    maxSpecificationsPer24Hours: number;
    maxPromptsPerMinute: number;
    maxPromptsPer24Hours: number;
  }): Promise<UserLimits> {
    logger.info`Creating limit tier ${data.id}: ${data.label}`;

    return await this.prisma.userLimits.create({
      data
    });
  }

  async update(id: string, data: Partial<Omit<UserLimits, 'id'>>): Promise<UserLimits> {
    logger.info`Updating limit tier ${id}`;

    return await this.prisma.userLimits.update({
      where: { id },
      data
    });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.userLimits.delete({
        where: { id }
      });
      logger.info`Deleted limit tier ${id}`;
      return true;
    } catch (error) {
      logger.error`Failed to delete limit tier ${id}: ${error}`;
      return false;
    }
  }
}
