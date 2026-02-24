import { BaseChannel } from './base';
import { eventBus } from '@/events/emitter';
import type { ChannelName } from '../protocol';
import { getLogger } from '@/utils/logger';
import type { ChatEvent } from '@shared/types';

const logger = getLogger(['ws', 'agent-events']);

export class AgentEventsChannel extends BaseChannel {
  channelName: ChannelName = 'agent-events';

  protected setupListeners(): void {
    eventBus.onEvent('agent:events:changed', async (event) => {
      const t0 = performance.now();
      const {
        agentId,
        addedMessageIds, modifiedMessageIds,
        addedCommitIds, modifiedCommitIds,
        addedResetIds,
        addedAutomationEventIds, modifiedAutomationEventIds,
        addedContextEventIds,
        addedPromptIds, modifiedPromptIds,
      } = event;

      const hasSpecificChanges = addedMessageIds || modifiedMessageIds
        || addedCommitIds || modifiedCommitIds
        || addedResetIds
        || addedAutomationEventIds || modifiedAutomationEventIds
        || addedContextEventIds
        || addedPromptIds || modifiedPromptIds;

      for (const [key, subs] of this.subscribers) {
        const params = this.parseParamsFromKey(key);
        if (!params || params.agentId !== agentId) continue;
        if (subs.size === 0) continue;

        try {
          if (!hasSpecificChanges) {
            // No specific IDs — bulk operation (e.g. revert). Full refresh.
            const firstSub = subs.values().next().value;
            if (!firstSub) continue;
            const tSnap0 = performance.now();
            const snapshot = await this.getSnapshot(firstSub.userId, params);
            const tSnap = performance.now() - tSnap0;
            this.broadcastDelta(params, { op: 'replace', item: snapshot });
            logger.info`[Perf] agent-events delta replace agent=${agentId.slice(0, 8)} snapshotTime=${tSnap.toFixed(0)}ms total=${(performance.now() - t0).toFixed(0)}ms`;
            continue;
          }

          // Fetch only the specific changed events by ID
          const tFetch0 = performance.now();
          const [
            addedMsgEvents, addedCommitEvents, addedResetEvents,
            addedAutoEvents, addedCtxEvents, addedPromptEvents,
            modifiedMsgEvents, modifiedCommitEvents, modifiedAutoEvents, modifiedPromptEvents,
          ] = await Promise.all([
            this.services.agents.getChatEventsForMessageIds(agentId, addedMessageIds || []),
            this.services.agents.getChatEventsForCommitIds(addedCommitIds || []),
            this.services.agents.getChatEventsForResetIds(addedResetIds || []),
            this.services.agents.getChatEventsForAutomationEventIds(addedAutomationEventIds || []),
            this.services.agents.getChatEventsForContextEventIds(addedContextEventIds || []),
            this.services.agents.getChatEventsForPromptIds(agentId, addedPromptIds || []),
            this.services.agents.getChatEventsForMessageIds(agentId, modifiedMessageIds || []),
            this.services.agents.getChatEventsForCommitIds(modifiedCommitIds || []),
            this.services.agents.getChatEventsForAutomationEventIds(modifiedAutomationEventIds || []),
            this.services.agents.getChatEventsForPromptIds(agentId, modifiedPromptIds || []),
          ]);
          const tFetch = performance.now() - tFetch0;

          const allAdded: ChatEvent[] = [
            ...addedMsgEvents, ...addedCommitEvents, ...addedResetEvents,
            ...addedAutoEvents, ...addedCtxEvents, ...addedPromptEvents,
          ];
          const allModified: ChatEvent[] = [
            ...modifiedMsgEvents, ...modifiedCommitEvents, ...modifiedAutoEvents,
            ...modifiedPromptEvents,
          ];

          if (allAdded.length > 0) {
            this.broadcastDelta(params, {
              op: 'add-batch',
              items: allAdded,
            });
          }

          for (const evt of allModified) {
            this.broadcastDelta(params, {
              op: 'modify',
              item: evt,
              itemId: evt.id,
            });
          }

          const tTotal = performance.now() - t0;
          if (allAdded.length > 0 || allModified.length > 0) {
            logger.info`[Perf] agent-events delta agent=${agentId.slice(0, 8)} added=${allAdded.length} modified=${allModified.length} fetchTime=${tFetch.toFixed(0)}ms total=${tTotal.toFixed(0)}ms`;
          }
        } catch (err) {
          logger.error`Delta failed for agent-events ${agentId}: ${err}`;
        }
      }
    });
  }

  async getSnapshot(userId: string, params: Record<string, any>): Promise<any> {
    const t0 = performance.now();
    const { agentId, limit: rawLimit = 80 } = params;
    const limit = Math.min(Number(rawLimit) || 80, 500);

    const tEvents0 = performance.now();
    const result = await this.services.agents.getAgentChatEventsPaginated(agentId, { limit });
    const tEvents = performance.now() - tEvents0;

    const tAgent0 = performance.now();
    const agent = await this.services.agents.getAgent(agentId);
    const tAgent = performance.now() - tAgent0;

    const eventsVersion = agent?.eventsVersion ?? 0;

    logger.info`[Perf] getSnapshot agent=${agentId.slice(0, 8)} limit=${limit} events=${result.events.length} hasMore=${result.hasMore} eventsQuery=${tEvents.toFixed(0)}ms agentQuery=${tAgent.toFixed(0)}ms total=${(performance.now() - t0).toFixed(0)}ms`;

    return {
      events: result.events,
      eventsVersion,
      hasMore: result.hasMore,
      oldestTimestamp: result.oldestTimestamp,
    };
  }

  async checkAccess(userId: string, params: Record<string, any>): Promise<boolean> {
    const { agentId } = params;
    return await this.services.userAgentAccesses.hasReadAccess(userId, agentId);
  }
}
