import { getLogger } from '../utils/logger';
import { RepositoryContainer } from '../data/repositories';

const logger = getLogger(['healthCheck']);

const FAILURE_THRESHOLD = 60; // Delete agent after 60 consecutive failures

export class HealthCheckService {
  constructor(private repositories: RepositoryContainer) {}

  /**
   * Record a successful health check for an agent
   */
  async recordSuccess(agentId: string, machineId: string): Promise<void> {
    try {
      // Upsert health check record (create if doesn't exist, reset failures if exists)
      await this.repositories.machineHealthChecks.upsertHealthCheck(agentId, machineId);
      await this.repositories.machineHealthChecks.recordSuccess(agentId);
    } catch (error) {
      logger.error`Failed to record health check success for agent ${agentId}: ${error}`;
    }
  }

  /**
   * Record a failed health check for an agent
   * Returns true if agent should be deleted (exceeded threshold)
   */
  async recordFailure(agentId: string, machineId: string): Promise<boolean> {
    try {
      // Upsert health check record (create if doesn't exist)
      await this.repositories.machineHealthChecks.upsertHealthCheck(agentId, machineId);

      // Increment failure count
      await this.repositories.machineHealthChecks.recordFailure(agentId);

      // Check if threshold exceeded
      const healthCheck = await this.repositories.machineHealthChecks.getHealthCheck(agentId);

      if (healthCheck && healthCheck.consecutiveFailures >= FAILURE_THRESHOLD) {
        logger.error`Agent ${agentId} machine ${machineId} has failed ${healthCheck.consecutiveFailures} times in a row`;
        return true; // Should delete agent
      }

      return false;
    } catch (error) {
      logger.error`Failed to record health check failure for agent ${agentId}: ${error}`;
      return false;
    }
  }

  /**
   * Get health check stats for an agent
   */
  async getHealthCheck(agentId: string) {
    return await this.repositories.machineHealthChecks.getHealthCheck(agentId);
  }

  /**
   * Delete health check record for an agent
   */
  async deleteHealthCheck(agentId: string): Promise<void> {
    try {
      await this.repositories.machineHealthChecks.deleteHealthCheck(agentId);
    } catch (error) {
      logger.error`Failed to delete health check for agent ${agentId}: ${error}`;
    }
  }

  /**
   * Get all agents that have exceeded the failure threshold
   */
  async getFailingAgents(): Promise<Array<{ agentId: string; machineId: string; consecutiveFailures: number }>> {
    try {
      const failing = await this.repositories.machineHealthChecks.getFailingAgents(FAILURE_THRESHOLD);
      return failing.map(hc => ({
        agentId: hc.agentId,
        machineId: hc.machineId,
        consecutiveFailures: hc.consecutiveFailures
      }));
    } catch (error) {
      logger.error`Failed to get failing agents: ${error}`;
      return [];
    }
  }
}
