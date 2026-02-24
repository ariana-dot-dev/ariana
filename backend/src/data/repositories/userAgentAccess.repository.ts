import { PrismaClient, type UserAgentAccess } from '../../../generated/prisma';
import { getLogger } from '@/utils/logger.ts';
import { emitAgentAccessesChanged } from '@/websocket/emit-helpers';

const logger = getLogger(['db', 'user-agent-access']);

export class UserAgentAccessRepository {
  constructor(private prisma: PrismaClient) {}

  async createAccess(params: {
    userId: string;
    agentId: string;
    access: 'read' | 'write';
  }): Promise<UserAgentAccess> {
    const id = crypto.randomUUID();
    const now = new Date();

    const result = await this.prisma.userAgentAccess.create({
      data: {
        id,
        userId: params.userId,
        agentId: params.agentId,
        access: params.access,
        createdAt: now,
        updatedAt: now
      }
    });
    emitAgentAccessesChanged(params.userId);
    return result;
  }

  async getAccess(userId: string, agentId: string): Promise<UserAgentAccess | null> {
    return await this.prisma.userAgentAccess.findUnique({
      where: {
        userId_agentId: {
          userId,
          agentId
        }
      }
    });
  }

  async getUserAccesses(userId: string): Promise<UserAgentAccess[]> {
    return await this.prisma.userAgentAccess.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAgentAccesses(agentId: string): Promise<UserAgentAccess[]> {
    return await this.prisma.userAgentAccess.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async updateAccess(userId: string, agentId: string, access: 'read' | 'write'): Promise<void> {
    await this.prisma.userAgentAccess.update({
      where: {
        userId_agentId: {
          userId,
          agentId
        }
      },
      data: {
        access,
        updatedAt: new Date()
      }
    });
    emitAgentAccessesChanged(userId);
  }

  async setAllAccessToRead(agentId: string): Promise<void> {
    await this.prisma.userAgentAccess.updateMany({
      where: { agentId },
      data: {
        access: 'read',
        updatedAt: new Date()
      }
    });
  }

  async deleteAccess(userId: string, agentId: string): Promise<void> {
    await this.prisma.userAgentAccess.delete({
      where: {
        userId_agentId: {
          userId,
          agentId
        }
      }
    });
    emitAgentAccessesChanged(userId);
  }

  async hasWriteAccess(userId: string, agentId: string): Promise<boolean> {
    const access = await this.getAccess(userId, agentId);
    return access?.access === 'write';
  }
}
