import { BaseChannel } from './base';
import { eventBus } from '@/events/emitter';
import type { ChannelName } from '../protocol';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['ws', 'agent-summaries']);

export class AgentSummariesChannel extends BaseChannel {
  channelName: ChannelName = 'agent-summaries';

  protected setupListeners(): void {
    eventBus.onEvent('agent:summary:changed', async ({ agentId }) => {
      // Find all subscriptions whose agentIds list includes this agent
      for (const [key, subs] of this.subscribers) {
        const params = this.parseParamsFromKey(key);
        if (!params) continue;
        const agentIds: string[] = params.agentIds || [];
        if (!agentIds.includes(agentId)) continue;
        if (subs.size === 0) continue;

        try {
          const firstSub = subs.values().next().value;
          if (!firstSub) continue;
          const summary = await this.fetchSingleSummary(firstSub.userId, agentId);
          if (summary) {
            this.broadcastDelta(params, { op: 'modify', itemId: agentId, item: summary });
          }
        } catch (err) {
          logger.error`Delta failed for agent-summaries ${agentId}: ${err}`;
        }
      }
    });
  }

  private async fetchSingleSummary(userId: string, agentId: string): Promise<any | null> {
    const hasAccess = await this.services.userAgentAccesses.hasReadAccess(userId, agentId);
    if (!hasAccess) return null;

    const agent = await this.services.agents.getAgent(agentId);
    if (!agent) return null;

    const commits = await this.services.agents.getAgentCommits(agentId);
    const activeCommits = commits.filter((c: any) => !c.isDeleted);

    let additions = 0;
    let deletions = 0;
    for (const commit of activeCommits) {
      additions += commit.additions || 0;
      deletions += commit.deletions || 0;
    }

    const lastCommit = activeCommits.length > 0
      ? activeCommits.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
      : null;

    return {
      agentId,
      lastCommitSha: lastCommit?.commitSha || null,
      lastCommitUrl: lastCommit?.commitUrl || null,
      lastCommitAt: lastCommit?.createdAt || null,
      additions,
      deletions,
    };
  }

  async getSnapshot(userId: string, params: Record<string, any>): Promise<any> {
    const agentIds: string[] = params.agentIds || [];
    const summaries: any[] = [];

    for (const agentId of agentIds) {
      const summary = await this.fetchSingleSummary(userId, agentId);
      if (summary) summaries.push(summary);
    }

    return { summaries };
  }

  async checkAccess(_userId: string, _params: Record<string, any>): Promise<boolean> {
    // Access is checked per-agent in getSnapshot/fetchSingleSummary
    return true;
  }
}
