import { PrismaClient, type AgentReset } from '../../../generated/prisma';
import { emitAgentEventsChanged } from '@/websocket/emit-helpers';

export class AgentResetRepository {
    constructor(private prisma: PrismaClient) {}

    async createReset(reset: {
        id: string;
        agentId: string;
        taskId?: string | null;
        createdAt?: Date;
    }): Promise<AgentReset> {
        const now = new Date();

        const result = await this.prisma.agentReset.create({
            data: {
                id: reset.id,
                agentId: reset.agentId,
                taskId: reset.taskId || null,
                createdAt: reset.createdAt || now
            }
        });
        await this.prisma.agent.update({
            where: { id: reset.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        emitAgentEventsChanged(reset.agentId, { addedResetIds: [result.id] });
        return result;
    }

    async findByIds(ids: string[]): Promise<AgentReset[]> {
        return await this.prisma.agentReset.findMany({
            where: { id: { in: ids } },
            orderBy: { createdAt: 'asc' }
        });
    }

    async getAgentResets(agentId: string): Promise<AgentReset[]> {
        return await this.prisma.agentReset.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' }
        });
    }

    async getAgentResetsPaginated(
        agentId: string,
        opts: { limit: number; beforeTimestamp?: Date }
    ): Promise<AgentReset[]> {
        const where: any = { agentId };
        if (opts.beforeTimestamp) where.createdAt = { lt: opts.beforeTimestamp };
        return await this.prisma.agentReset.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: opts.limit,
        });
    }

    async copyResetsFromAgent(sourceAgentId: string, targetAgentId: string, promptIdMapping: Map<string, string>): Promise<number> {
        const sourceResets = await this.prisma.agentReset.findMany({
            where: { agentId: sourceAgentId },
            orderBy: { createdAt: 'asc' }
        });

        const copiedResets = sourceResets.map(reset => ({
            id: crypto.randomUUID(),
            agentId: targetAgentId,
            taskId: reset.taskId ? promptIdMapping.get(reset.taskId) || null : null,
            createdAt: reset.createdAt
        }));

        if (copiedResets.length > 0) {
            await this.prisma.agentReset.createMany({
                data: copiedResets
            });
            await this.prisma.agent.update({
                where: { id: targetAgentId },
                data: { eventsVersion: { increment: 1 } }
            });
        }

        return copiedResets.length;
    }
}
