import { RepositoryContainer } from '@/data/repositories';
import { getLogger } from '../utils/logger';
import type { UserAgentAccess } from '../../generated/prisma';

const logger = getLogger(['user-agent-access']);

export class UserAgentAccessService {
  constructor(private repositories: RepositoryContainer) {}

  async grantAccess(params: {
    userId: string;
    agentId: string;
    access: 'read' | 'write';
  }): Promise<UserAgentAccess> {
    logger.info`Granting ${params.access} access to user ${params.userId} for agent ${params.agentId}`;
    return await this.repositories.userAgentAccesses.createAccess(params);
  }

  async getAccess(userId: string, agentId: string): Promise<UserAgentAccess | null> {
    return await this.repositories.userAgentAccesses.getAccess(userId, agentId);
  }

  async getUserAccesses(userId: string): Promise<UserAgentAccess[]> {
    return await this.repositories.userAgentAccesses.getUserAccesses(userId);
  }

  async getAgentAccesses(agentId: string): Promise<UserAgentAccess[]> {
    return await this.repositories.userAgentAccesses.getAgentAccesses(agentId);
  }

  async updateAccess(userId: string, agentId: string, access: 'read' | 'write'): Promise<void> {
    logger.info`Updating access for user ${userId} on agent ${agentId} to ${access}`;
    await this.repositories.userAgentAccesses.updateAccess(userId, agentId, access);
  }

  async setAllAccessToRead(agentId: string): Promise<void> {
    logger.info`Setting all accesses to read for agent ${agentId}`;
    await this.repositories.userAgentAccesses.setAllAccessToRead(agentId);
  }

  async hasWriteAccess(userId: string, agentId: string): Promise<boolean> {
    const access = await this.repositories.userAgentAccesses.getAccess(userId, agentId);
    logger.info`User ${userId} has write access to agent ${agentId}: ${access?.access === 'write'}`;
    return access?.access === 'write';
  }

  async hasReadAccess(userId: string, agentId: string): Promise<boolean> {
    const access = await this.repositories.userAgentAccesses.getAccess(userId, agentId);
    logger.info`User ${userId} has read access to agent ${agentId}: ${access !== null}`;
    return access !== null; // Has any access (read or write)
  }

  async revokeAccess(userId: string, agentId: string): Promise<void> {
    logger.info`Revoking access for user ${userId} on agent ${agentId}`;
    await this.repositories.userAgentAccesses.deleteAccess(userId, agentId);
  }
}
