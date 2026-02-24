import { BaseChannel } from './base';
import { eventBus } from '@/events/emitter';
import type { ChannelName } from '../protocol';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['ws', 'projects-list']);

export class ProjectsListChannel extends BaseChannel {
  channelName: ChannelName = 'projects-list';

  protected setupListeners(): void {
    eventBus.onEvent('project:created', async ({ userId, projectId }) => {
      try {
        const project = await this.services.projects.getProject(projectId);
        if (!project) return;

        this.broadcastDeltaFiltered(
          (subUserId) => subUserId === userId,
          { op: 'add', item: project }
        );
      } catch (err) {
        logger.error`Delta failed for project:created ${projectId}: ${err}`;
      }
    });

    eventBus.onEvent('project:updated', async ({ projectId }) => {
      try {
        const project = await this.services.projects.getProject(projectId);
        if (!project) return;

        // Broadcast to all subscribers — they'll ignore if they don't have this project
        this.broadcastDeltaFiltered(
          () => true,
          { op: 'modify', itemId: projectId, item: project }
        );
      } catch (err) {
        logger.error`Delta failed for project:updated ${projectId}: ${err}`;
      }
    });

    eventBus.onEvent('project:deleted', ({ projectId, userId }) => {
      this.broadcastDeltaFiltered(
        (subUserId) => subUserId === userId,
        { op: 'delete', itemId: projectId }
      );
    });
  }

  async getSnapshot(userId: string, _params: Record<string, any>): Promise<any> {
    const projects = await this.services.projects.getUserProjects(userId);
    return { projects };
  }

  async checkAccess(_userId: string, _params: Record<string, any>): Promise<boolean> {
    return true; // Filtered by userId
  }
}
