import { PrismaClient, type SubscriptionPlan } from '../../../generated/prisma';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['subscriptionPlan']);

export class SubscriptionPlanRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<SubscriptionPlan | null> {
    try {
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id },
        include: {
          userLimit: true,
        },
      });

      if (plan) {
        logger.debug`Found subscription plan: ${id}`;
      } else {
        logger.debug`Subscription plan not found: ${id}`;
      }

      return plan as any;
    } catch (error) {
      logger.error`Failed to find subscription plan ${id}: ${error}`;
      return null;
    }
  }

  async findAll(): Promise<SubscriptionPlan[]> {
    try {
      const plans = await this.prisma.subscriptionPlan.findMany({
        include: {
          userLimit: true,
        },
        orderBy: {
          id: 'asc',
        },
      });

      logger.debug`Found ${plans.length} subscription plans`;
      return plans as any;
    } catch (error) {
      logger.error`Failed to find subscription plans: ${error}`;
      return [];
    }
  }

  async create(data: {
    id: string;
    label: string;
    stripePriceId?: string | null;
    stripePriceIdTest?: string | null;
    userLimitId: string;
  }): Promise<SubscriptionPlan> {
    try {
      const plan = await this.prisma.subscriptionPlan.create({
        data,
      });

      logger.info`Created subscription plan: ${plan.id} - ${plan.label}`;
      return plan;
    } catch (error) {
      logger.error`Failed to create subscription plan: ${error}`;
      throw error;
    }
  }

  async update(id: string, data: Partial<{
    label: string;
    stripePriceId: string | null;
    stripePriceIdTest: string | null;
    userLimitId: string;
  }>): Promise<SubscriptionPlan | null> {
    try {
      const plan = await this.prisma.subscriptionPlan.update({
        where: { id },
        data,
      });

      logger.info`Updated subscription plan: ${id}`;
      return plan;
    } catch (error) {
      logger.error`Failed to update subscription plan ${id}: ${error}`;
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.subscriptionPlan.delete({
        where: { id },
      });

      logger.info`Deleted subscription plan: ${id}`;
      return true;
    } catch (error) {
      logger.error`Failed to delete subscription plan ${id}: ${error}`;
      return false;
    }
  }
}
