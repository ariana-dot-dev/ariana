import type { PrismaClient, AgentPortDomain } from 'generated/prisma';
import crypto from 'crypto';

export class AgentPortDomainRepository {
  constructor(private prisma: PrismaClient) {}

  async findByAgent(agentId: string): Promise<AgentPortDomain[]> {
    return await this.prisma.agentPortDomain.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' }
    });
  }

  async findByAgentAndPort(agentId: string, port: number): Promise<AgentPortDomain | null> {
    return await this.prisma.agentPortDomain.findUnique({
      where: {
        agentId_port: { agentId, port }
      }
    });
  }

  async countByAgent(agentId: string): Promise<number> {
    return await this.prisma.agentPortDomain.count({
      where: { agentId }
    });
  }

  async create(data: {
    agentId: string;
    port: number;
    machineName: string;
    subdomain: string;
    url: string | null;
  }): Promise<AgentPortDomain> {
    return await this.prisma.agentPortDomain.create({
      data: {
        id: crypto.randomUUID(),
        agentId: data.agentId,
        port: data.port,
        machineName: data.machineName,
        subdomain: data.subdomain,
        url: data.url,
      }
    });
  }

  async deleteByAgentAndPort(agentId: string, port: number): Promise<void> {
    await this.prisma.agentPortDomain.delete({
      where: {
        agentId_port: { agentId, port }
      }
    });
  }

  async deleteByAgent(agentId: string): Promise<void> {
    await this.prisma.agentPortDomain.deleteMany({
      where: { agentId }
    });
  }
}
