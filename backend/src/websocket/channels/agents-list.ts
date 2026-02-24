import { BaseChannel } from './base';
import { eventBus } from '@/events/emitter';
import type { ChannelName } from '../protocol';
import { enrichWithCreator } from '@/api/agents/handlers';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['ws', 'agents-list']);

export class AgentsListChannel extends BaseChannel {
  channelName: ChannelName = 'agents-list';

  // Debounce agent:updated events — coalesce rapid updates per agentId
  private pendingUpdates: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly DEBOUNCE_MS = 500;

  protected setupListeners(): void {
    eventBus.onEvent('agent:created', async ({ agentId, userId }) => {
      try {
        const agent = await this.services.agents.getAgentWithProject(agentId);
        if (!agent) return;
        const enriched = await enrichWithCreator(agent, this.services);

        // Notify user-level subscribers (no projectId param)
        this.broadcastDeltaFiltered(
          (subUserId, params) => subUserId === userId && !params.projectId,
          { op: 'add', item: enriched }
        );

        // Notify project-level subscribers (with matching projectId)
        this.broadcastDeltaFiltered(
          (_subUserId, params) => params.projectId === agent.projectId,
          { op: 'add', item: enriched }
        );
      } catch (err) {
        logger.error`Delta failed for agent:created ${agentId}: ${err}`;
      }
    });

    eventBus.onEvent('agent:updated', ({ agentId }) => {
      // Debounce: coalesce rapid updates for the same agent
      const existing = this.pendingUpdates.get(agentId);
      if (existing) clearTimeout(existing);

      this.pendingUpdates.set(agentId, setTimeout(async () => {
        this.pendingUpdates.delete(agentId);
        try {
          const agent = await this.services.agents.getAgentWithProject(agentId);
          if (!agent) return;
          const enriched = await enrichWithCreator(agent, this.services);
          const userId = agent.userId;

          // Notify user-level subscribers
          this.broadcastDeltaFiltered(
            (subUserId, params) => subUserId === userId && !params.projectId,
            { op: 'modify', itemId: agentId, item: enriched }
          );

          // Notify project-level subscribers
          this.broadcastDeltaFiltered(
            (_subUserId, params) => params.projectId === agent.projectId,
            { op: 'modify', itemId: agentId, item: enriched }
          );
        } catch (err) {
          logger.error`Delta failed for agent:updated ${agentId}: ${err}`;
        }
      }, this.DEBOUNCE_MS));
    });

    eventBus.onEvent('agent:deleted', ({ agentId, userId }) => {
      // Cancel any pending update for this agent
      const pending = this.pendingUpdates.get(agentId);
      if (pending) {
        clearTimeout(pending);
        this.pendingUpdates.delete(agentId);
      }

      // For delete, we don't have the agent anymore to check projectId,
      // so broadcast to all project-level subscribers (they'll filter client-side)
      this.broadcastDeltaFiltered(
        (subUserId, params) =>
          (subUserId === userId && !params.projectId) ||
          !!params.projectId,
        { op: 'delete', itemId: agentId }
      );
    });
  }

  async getSnapshot(userId: string, params: Record<string, any>): Promise<any> {
    const projectId = params.projectId as string | undefined;
    const includeProjects = params.includeProjects === true;

    let agents: any[];

    if (projectId) {
      // Project-specific: get agents for this project (includes shared access)
      agents = await this.services.agents.getProjectAgents(projectId, userId, true);
    } else if (includeProjects) {
      agents = await this.services.agents.getUserAgentsWithProjects(userId, true);
    } else {
      agents = await this.services.agents.getUserAgents(userId, true);
    }

    const enrichedAgents = await Promise.all(
      agents.map((a: any) => enrichWithCreator(a, this.services))
    );

    // Cap at 300, most recently prompted first (stable ordering)
    enrichedAgents.sort((a: any, b: any) =>
      new Date(b.lastPromptAt ?? b.createdAt ?? 0).getTime() -
      new Date(a.lastPromptAt ?? a.createdAt ?? 0).getTime()
    );
    const capped = enrichedAgents.slice(0, 300);

    return { agents: capped };
  }

  async checkAccess(userId: string, params: Record<string, any>): Promise<boolean> {
    const projectId = params.projectId as string | undefined;
    if (projectId) {
      return await this.services.projects.isProjectMember(projectId, userId);
    }
    return true; // User-level is filtered by userId in getSnapshot
  }
}
