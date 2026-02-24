import { BaseChannel } from './base';
import { eventBus } from '@/events/emitter';
import type { ChannelName } from '../protocol';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['ws', 'github-token-health']);

export class GitHubTokenHealthChannel extends BaseChannel {
  channelName: ChannelName = 'github-token-health';

  protected setupListeners(): void {
    eventBus.onEvent('github:token-health:changed', async ({ userId }) => {
      try {
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
        logger.error`Delta failed for github-token-health ${userId}: ${err}`;
      }
    });
  }

  async getSnapshot(userId: string, _params: Record<string, any>): Promise<any> {
    const result = await this.services.github.checkTokenHealth(userId);
    return {
      hasToken: result.hasToken,
      wasRefreshed: result.wasRefreshed,
    };
  }

  async checkAccess(_userId: string, _params: Record<string, any>): Promise<boolean> {
    return true; // Filtered by userId
  }
}
