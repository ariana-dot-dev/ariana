import { BaseChannel } from './base';
import { eventBus } from '@/events/emitter';
import type { ChannelName } from '../protocol';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['ws', 'project-collaborators']);

export class ProjectCollaboratorsChannel extends BaseChannel {
  channelName: ChannelName = 'project-collaborators';

  protected setupListeners(): void {
    eventBus.onEvent('project:collaborators:changed', async ({ projectId }) => {
      const params = { projectId };
      try {
        // Find subscribers watching this project
        for (const [key, subs] of this.subscribers) {
          const subParams = this.parseParamsFromKey(key);
          if (!subParams || subParams.projectId !== projectId) continue;
          if (subs.size === 0) continue;

          const firstSub = subs.values().next().value;
          if (!firstSub) continue;
          const snapshot = await this.getSnapshot(firstSub.userId, subParams);
          this.broadcastDelta(subParams, { op: 'replace', item: snapshot });
        }
      } catch (err) {
        logger.error`Delta failed for project-collaborators ${projectId}: ${err}`;
      }
    });
  }

  async getSnapshot(userId: string, params: Record<string, any>): Promise<any> {
    const { projectId } = params;

    const members = await this.services.projects.getProjectMembers(projectId);

    const collaborators = await Promise.all(
      members.map(async (member: any) => {
        const user = await this.services.users.getUserWithProfile(member.userId);
        return {
          userId: member.userId,
          role: member.role,
          profile: user && !user.isAnonymous
            ? {
                name: user.githubProfile?.name || 'Unknown',
                image: user.githubProfile?.image || null,
              }
            : null,
        };
      })
    );

    return { collaborators };
  }

  async checkAccess(userId: string, params: Record<string, any>): Promise<boolean> {
    const { projectId } = params;
    return await this.services.projects.isProjectMember(projectId, userId);
  }
}
