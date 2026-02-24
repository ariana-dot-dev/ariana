import { PrismaClient, type AgentUploadProgress } from '../../../generated/prisma';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['db', 'agentUpload']);

export class AgentUploadRepository {
  constructor(private prisma: PrismaClient) {}

  // Initialize upload tracking
  async initUpload(agentId: string, totalChunks: number): Promise<void> {
    await this.prisma.agentUploadProgress.upsert({
      where: { agentId },
      create: {
        id: `upload-${agentId}`,
        agentId,
        totalChunks,
        chunksReceived: 0
      },
      update: {
        totalChunks,
        chunksReceived: 0
      }
    });
  }

  // Increment chunk received counter
  async recordChunkReceived(agentId: string): Promise<number> {
    const result = await this.prisma.agentUploadProgress.update({
      where: { agentId },
      data: {
        chunksReceived: { increment: 1 }
      }
    });
    return result.chunksReceived;
  }

  async getProgress(agentId: string): Promise<AgentUploadProgress | null> {
    return await this.prisma.agentUploadProgress.findUnique({
      where: { agentId }
    });
  }

  async deleteProgress(agentId: string): Promise<void> {
    await this.prisma.agentUploadProgress.delete({
      where: { agentId }
    }).catch(() => {
      // Ignore if not found
    });
  }

  // Cleanup old progress (older than 10 minutes)
  async cleanupOldProgress(): Promise<{ progressDeleted: number }> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const progress = await this.prisma.agentUploadProgress.deleteMany({
      where: {
        createdAt: { lt: tenMinutesAgo }
      }
    });

    if (progress.count > 0) {
      logger.info(`Cleaned up old upload progress: ${progress.count} records`);
    }

    return {
      progressDeleted: progress.count
    };
  }
}
