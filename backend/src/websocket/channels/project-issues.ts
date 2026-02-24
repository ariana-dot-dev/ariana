import { BaseChannel } from './base';
import { eventBus } from '@/events/emitter';
import type { ChannelName } from '../protocol';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['ws', 'project-issues']);

export class ProjectIssuesChannel extends BaseChannel {
  channelName: ChannelName = 'project-issues';

  protected setupListeners(): void {
    eventBus.onEvent('project:issues:changed', async ({ projectId }) => {
      try {
        for (const [key, subs] of this.subscribers) {
          const params = this.parseParamsFromKey(key);
          if (!params || params.projectId !== projectId) continue;
          if (subs.size === 0) continue;

          const firstSub = subs.values().next().value;
          if (!firstSub) continue;
          const snapshot = await this.getSnapshot(firstSub.userId, params);
          this.broadcastDelta(params, { op: 'replace', item: snapshot });
        }
      } catch (err) {
        logger.error`Delta failed for project-issues ${projectId}: ${err}`;
      }
    });
  }

  async getSnapshot(userId: string, params: Record<string, any>): Promise<any> {
    const { projectId } = params;

    const project = await this.services.projects.getProject(projectId);
    if (!project || !project.repositoryId) {
      return { issues: [] };
    }

    const repository = await this.services.repositories.getRepositoryById(project.repositoryId);
    if (!repository) {
      return { issues: [] };
    }

    try {
      const issues = await this.services.github.getRepositoryIssues(userId, repository.fullName);
      return { issues: issues || [] };
    } catch (error: any) {
      if (error.code === 'GITHUB_AUTH_REQUIRED') {
        return { issues: [], error: 'GITHUB_AUTH_REQUIRED' };
      }
      return { issues: [] };
    }
  }

  async checkAccess(userId: string, params: Record<string, any>): Promise<boolean> {
    const { projectId } = params;
    return await this.services.projects.isProjectMember(projectId, userId);
  }
}
