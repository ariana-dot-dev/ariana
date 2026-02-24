import { PrismaClient, type AgentContextEvent } from '../../../generated/prisma';
import { randomUUID } from 'crypto';
import { emitAgentEventsChanged } from '@/websocket/emit-helpers';

export class AgentContextEventRepository {
    constructor(private prisma: PrismaClient) {}

    private async createAndBumpVersion(eventData: any, agentId: string): Promise<AgentContextEvent> {
        const result = await this.prisma.agentContextEvent.create({ data: eventData });
        await this.prisma.agent.update({
            where: { id: agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        return result;
    }

    async createContextWarning(data: {
        agentId: string;
        taskId: string | null;
        contextUsedPercent: number;
        contextRemainingPercent: number;
        inputTokens: number;
        cacheTokens: number;
        contextWindow: number;
    }): Promise<AgentContextEvent> {
        const result = await this.createAndBumpVersion({
            id: randomUUID(),
            ...data,
            type: 'context_warning',
            createdAt: new Date()
        }, data.agentId);
        emitAgentEventsChanged(data.agentId, { addedContextEventIds: [result.id] });
        return result;
    }

    async createCompactionStart(data: {
        agentId: string;
        taskId: string | null;
        contextUsedPercent: number;
        triggerReason: string;
    }): Promise<AgentContextEvent> {
        const result = await this.createAndBumpVersion({
            id: randomUUID(),
            ...data,
            type: 'compaction_start',
            createdAt: new Date()
        }, data.agentId);
        emitAgentEventsChanged(data.agentId, { addedContextEventIds: [result.id] });
        return result;
    }

    async createCompactionComplete(data: {
        agentId: string;
        taskId: string | null;
        summary: string;
        tokensBefore: number;
        tokensAfter: number | null;
        tokensSaved: number | null;
    }): Promise<AgentContextEvent> {
        const result = await this.createAndBumpVersion({
            id: randomUUID(),
            ...data,
            type: 'compaction_complete',
            createdAt: new Date()
        }, data.agentId);
        emitAgentEventsChanged(data.agentId, { addedContextEventIds: [result.id] });
        return result;
    }

    async findByIds(ids: string[]): Promise<AgentContextEvent[]> {
        return this.prisma.agentContextEvent.findMany({
            where: { id: { in: ids } },
            orderBy: { createdAt: 'asc' }
        });
    }

    async getAgentContextEvents(agentId: string): Promise<AgentContextEvent[]> {
        return this.prisma.agentContextEvent.findMany({
            where: { agentId },
            orderBy: { createdAt: 'asc' }
        });
    }

    async getAgentContextEventsPaginated(
        agentId: string,
        opts: { limit: number; beforeTimestamp?: Date }
    ): Promise<AgentContextEvent[]> {
        const where: any = { agentId };
        if (opts.beforeTimestamp) where.createdAt = { lt: opts.beforeTimestamp };
        return this.prisma.agentContextEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: opts.limit,
        });
    }

    async deleteAgentContextEvents(agentId: string): Promise<void> {
        await this.prisma.agentContextEvent.deleteMany({
            where: { agentId }
        });
    }
}
