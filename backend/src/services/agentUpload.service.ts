import type { AgentUploadRepository } from '@/data/repositories/agentUpload.repository';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['service', 'agentUpload']);

export class AgentUploadService {
  constructor(private agentUploadRepository: AgentUploadRepository) {}

  async initUpload(agentId: string, totalChunks: number): Promise<void> {
    await this.agentUploadRepository.initUpload(agentId, totalChunks);
  }

  async recordChunkReceived(agentId: string): Promise<number> {
    return await this.agentUploadRepository.recordChunkReceived(agentId);
  }

  async getProgress(agentId: string) {
    return await this.agentUploadRepository.getProgress(agentId);
  }

  async deleteProgress(agentId: string): Promise<void> {
    await this.agentUploadRepository.deleteProgress(agentId);
  }

  async cleanupOldProgress() {
    return await this.agentUploadRepository.cleanupOldProgress();
  }
}
