import { BaseChannel } from './base';
import { eventBus } from '@/events/emitter';
import type { ChannelName } from '../protocol';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['ws', 'agent-accesses']);

export class AgentAccessesChannel extends BaseChannel {
  channelName: ChannelName = 'agent-accesses';

  protected setupListeners(): void {
    eventBus.onEvent('agent:accesses:changed', async ({ userId }) => {
      try {
        // Find subscribers for this user and send replace delta
        for (const [key, subs] of this.subscribers) {
          for (const sub of subs) {
            if (sub.userId !== userId) continue;
            const params = this.parseParamsFromKey(key) || {};
            const snapshot = await this.getSnapshot(sub.userId, params);
            sub.send(JSON.stringify({
              type: 'delta',
              channel: this.channelName,
              params,
              data: { op: 'replace', item: snapshot },
            }));
          }
        }
      } catch (err) {
        logger.error`Delta failed for agent-accesses ${userId}: ${err}`;
      }
    });
  }

  async getSnapshot(userId: string, _params: Record<string, any>): Promise<any> {
    const accesses = await this.services.userAgentAccesses.getUserAccesses(userId);

    const enriched = await Promise.all(
      accesses.map(async (access: any) => {
        const agent = await this.services.agents.getAgent(access.agentId);
        let ownerId: string | null = null;
        let ownerUsername: string | null = null;

        if (agent) {
          ownerId = agent.userId;
          const owner = await this.services.users.getUserWithProfile(agent.userId);
          ownerUsername = owner?.githubProfile?.name || null;
        }

        return {
          agentId: access.agentId,
          access: access.access,
          ownerId,
          ownerUsername,
        };
      })
    );

    return { accesses: enriched };
  }

  async checkAccess(_userId: string, _params: Record<string, any>): Promise<boolean> {
    return true; // Filtered by userId
  }
}
