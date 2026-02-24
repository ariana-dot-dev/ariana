import { PrismaClient, Prisma, type AgentPrompt } from '../../../generated/prisma';
import { emitAgentEventsChanged } from '@/websocket/emit-helpers';

export class AgentPromptRepository {
    constructor(private prisma: PrismaClient) {}

    async copyPromptsFromAgent(sourceAgentId: string, targetAgentId: string): Promise<{ count: number; idMapping: Map<string, string> }> {
        // Get all prompts from source agent
        const sourcePrompts = await this.prisma.agentPrompt.findMany({
            where: { agentId: sourceAgentId },
            orderBy: { createdAt: 'asc' }
        });

        // Create ID mapping: oldPromptId -> newPromptId
        const idMapping = new Map<string, string>();

        // Copy prompts to target agent with new IDs
        const copiedPrompts = sourcePrompts.map(prompt => {
            const newId = crypto.randomUUID();
            idMapping.set(prompt.id, newId);

            return {
                id: newId,
                agentId: targetAgentId,
                prompt: prompt.prompt,
                status: prompt.status,
                model: prompt.model,
                createdAt: prompt.createdAt
            };
        });

        if (copiedPrompts.length > 0) {
            await this.prisma.agentPrompt.createMany({
                data: copiedPrompts
            });
            await this.prisma.agent.update({
                where: { id: targetAgentId },
                data: { eventsVersion: { increment: 1 } }
            });
        }

        return { count: copiedPrompts.length, idMapping };
    }

    async queuePrompt(agentId: string, prompt: string, model?: string): Promise<string> {
        const id = crypto.randomUUID();
        const now = new Date();

        await this.prisma.agentPrompt.create({
            data: {
                id,
                agentId,
                prompt,
                model: model || null,
                status: 'queued',
                createdAt: now
            }
        });

        // Update agent's last prompt info for UI display + bump eventsVersion
        await this.prisma.agent.update({
            where: { id: agentId },
            data: {
                lastPromptText: prompt,
                lastPromptAt: now,
                eventsVersion: { increment: 1 }
            }
        });

        emitAgentEventsChanged(agentId, { addedPromptIds: [id] });
        return id;
    }

    async getQueuedPrompts(agentId: string): Promise<AgentPrompt[]> {
        return await this.prisma.agentPrompt.findMany({
            where: {
                agentId,
                status: 'queued'
            },
            orderBy: { createdAt: 'asc' }
        });
    }

    async getQueuedOrRunningPrompts(agentId: string): Promise<AgentPrompt[]> {
        return await this.prisma.agentPrompt.findMany({
            where: {
                agentId,
                status: {
                    in: ['queued', 'running']
                }
            },
            orderBy: { createdAt: 'asc' }
        });
    }

    async updatePromptStatusToRunning(promptId: string): Promise<void> {
        const prompt = await this.prisma.agentPrompt.update({
            where: { id: promptId },
            data: { status: 'running' },
            select: { id: true, agentId: true }
        });
        await this.prisma.agent.update({
            where: { id: prompt.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        emitAgentEventsChanged(prompt.agentId, { modifiedPromptIds: [promptId] });
    }

    async updatePromptStatusToFinished(promptId: string): Promise<void> {
        const prompt = await this.prisma.agentPrompt.update({
            where: { id: promptId },
            data: { status: 'finished' },
            select: { id: true, agentId: true }
        });
        await this.prisma.agent.update({
            where: { id: prompt.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        emitAgentEventsChanged(prompt.agentId, { modifiedPromptIds: [promptId] });
    }

    async updatePromptStatusToFailed(promptId: string): Promise<void> {
        const prompt = await this.prisma.agentPrompt.update({
            where: { id: promptId },
            data: { status: 'failed' },
            select: { id: true, agentId: true }
        });
        await this.prisma.agent.update({
            where: { id: prompt.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        emitAgentEventsChanged(prompt.agentId, { modifiedPromptIds: [promptId] });
    }

    async finishRunningPromptsForAgent(agentId: string): Promise<void> {
        const result = await this.prisma.agentPrompt.updateMany({
            where: {
                agentId,
                status: 'running'
            },
            data: { status: 'finished' }
        });
        if (result.count > 0) {
            await this.prisma.agent.update({
                where: { id: agentId },
                data: { eventsVersion: { increment: 1 } }
            });
            // Bulk op — no specific IDs, triggers full refresh
            emitAgentEventsChanged(agentId);
        }
    }

    async failActivePromptsForAgent(agentId: string): Promise<number> {
        const result = await this.prisma.agentPrompt.updateMany({
            where: {
                agentId,
                status: {
                    in: ['queued', 'running']
                }
            },
            data: { status: 'failed' }
        });
        if (result.count > 0) {
            await this.prisma.agent.update({
                where: { id: agentId },
                data: { eventsVersion: { increment: 1 } }
            });
            // Bulk op — no specific IDs, triggers full refresh
            emitAgentEventsChanged(agentId);
        }
        return result.count;
    }

    async getRunningPrompts(agentId: string): Promise<AgentPrompt[]> {
        return await this.prisma.agentPrompt.findMany({
            where: {
                agentId,
                status: 'running'
            },
            orderBy: { createdAt: 'asc' }
        });
    }

    async getPromptById(promptId: string): Promise<AgentPrompt | null> {
        return await this.prisma.agentPrompt.findUnique({
            where: { id: promptId }
        });
    }

    async deletePrompt(promptId: string): Promise<void> {
        const prompt = await this.prisma.agentPrompt.delete({
            where: { id: promptId }
        });
        await this.prisma.agent.update({
            where: { id: prompt.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        // No specific IDs for delete — triggers full snapshot refresh for subscribers
        emitAgentEventsChanged(prompt.agentId);
    }

    async prioritizePrompt(promptId: string): Promise<void> {
        // Get the oldest queued prompt for this agent to determine the earliest timestamp
        const prompt = await this.prisma.agentPrompt.findUnique({
            where: { id: promptId }
        });
        if (!prompt) return;

        // Get the oldest queued/running prompt timestamp
        const oldestPrompt = await this.prisma.agentPrompt.findFirst({
            where: {
                agentId: prompt.agentId,
                status: { in: ['queued', 'running'] }
            },
            orderBy: { createdAt: 'asc' }
        });

        if (oldestPrompt && oldestPrompt.id !== promptId) {
            // Set this prompt's timestamp to 1ms before the oldest one
            const newTimestamp = new Date(oldestPrompt.createdAt!.getTime() - 1);
            await this.prisma.agentPrompt.update({
                where: { id: promptId },
                data: { createdAt: newTimestamp }
            });
            await this.prisma.agent.update({
                where: { id: prompt.agentId },
                data: { eventsVersion: { increment: 1 } }
            });
        }
    }

    async cancelOtherQueuedPrompts(agentId: string, exceptPromptId: string): Promise<number> {
        const result = await this.prisma.agentPrompt.deleteMany({
            where: {
                agentId,
                status: 'queued',
                id: { not: exceptPromptId }
            }
        });
        if (result.count > 0) {
            await this.prisma.agent.update({
                where: { id: agentId },
                data: { eventsVersion: { increment: 1 } }
            });
            // Bulk delete — no specific IDs, triggers full refresh
            emitAgentEventsChanged(agentId);
        }
        return result.count;
    }

    async getAllPrompts(agentId: string): Promise<AgentPrompt[]> {
        return await this.prisma.agentPrompt.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' }
        });
    }

    async findMany(where?: Prisma.AgentPromptWhereInput, options?: { orderBy?: Prisma.AgentPromptOrderByWithRelationInput, limit?: number }): Promise<AgentPrompt[]> {
        return await this.prisma.agentPrompt.findMany({
            where,
            orderBy: options?.orderBy,
            take: options?.limit
        });
    }

    async delete(where: Prisma.AgentPromptWhereInput): Promise<void> {
        await this.prisma.agentPrompt.deleteMany({ where });
    }

    async create(data: Prisma.AgentPromptUncheckedCreateInput): Promise<AgentPrompt> {
        const result = await this.prisma.agentPrompt.create({ data });
        await this.prisma.agent.update({
            where: { id: result.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        return result;
    }
}