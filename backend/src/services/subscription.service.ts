import type { RepositoryContainer } from '@/data/repositories';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['subscription-service']);

export class SubscriptionService {
  constructor(private repositories: RepositoryContainer) {}

  /**
   * Get the current subscription plan ID for a user
   * Returns the plan ID or "free" as default
   */
  async getCurrentPlan(userId: string): Promise<string> {
    try {
      const user = await this.repositories.users.findById(userId);

      if (!user) {
        logger.warn`User not found, returning free plan - userId: ${userId}`;
        return 'free';
      }

      const planId = user.subscriptionPlanId || 'free';

      logger.debug`Current subscription plan retrieved - userId: ${userId}, planId: ${planId}`;

      return planId;
    } catch (error) {
      logger.error`Failed to get current subscription plan - userId: ${userId}, error: ${error}`;
      return 'free';
    }
  }
}
