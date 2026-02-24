import type { PrismaClient, AgentAttachments } from 'generated/prisma';
import crypto from 'crypto';

export class AgentAttachmentsRepository {
  constructor(private prisma: PrismaClient) {}

  async getAttachments(agentId: string): Promise<AgentAttachments | null> {
    return await this.prisma.agentAttachments.findUnique({
      where: { agentId }
    });
  }

  async upsertAttachments(
    agentId: string,
    data: {
      claudeDirectoryZip?: string;
      pendingDiff?: string;
      totalDiff?: string;
    }
  ): Promise<AgentAttachments> {
    const result = await this.prisma.agentAttachments.upsert({
      where: { agentId },
      create: {
        id: crypto.randomUUID(),
        agentId,
        claudeDirectoryZip: data.claudeDirectoryZip || null,
        pendingDiff: data.pendingDiff || null,
        totalDiff: data.totalDiff || null,
        updatedAt: new Date()
      },
      update: {
        ...(data.claudeDirectoryZip !== undefined && { claudeDirectoryZip: data.claudeDirectoryZip }),
        ...(data.pendingDiff !== undefined && { pendingDiff: data.pendingDiff }),
        ...(data.totalDiff !== undefined && { totalDiff: data.totalDiff }),
        updatedAt: new Date()
      }
    });

    return result;
  }

  async deleteAttachments(agentId: string): Promise<void> {
    await this.prisma.agentAttachments.deleteMany({
      where: { agentId }
    });
  }
}
