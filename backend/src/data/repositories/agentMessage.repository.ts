import { PrismaClient, Prisma, type AgentMessage } from '../../../generated/prisma';
import { type ToolResult, type ToolUse } from "@shared/types";

function extractToolTarget(toolName: string, input: any): string | null {
    if (!input) return null;

    switch(toolName) {
        case 'Read':
        case 'Edit':
        case 'MultiEdit':
        case 'Write':
            return input.file_path || null;
        case 'Bash':
            const cmd = input.command || '';
            return cmd.split(' ')[0] || null;
        case 'Grep':
            return input.pattern || null;
        case 'Glob':
            return input.pattern || null;
        case 'WebSearch':
            return input.query || null;
        case 'WebFetch':
            return input.url || null;
        case 'Task':
            return input.description || null;
        default:
            return null;
    }
}

export class AgentMessageRepository {
    constructor(private prisma: PrismaClient) {}

    async getAgentMessages(
        agentId: string,
    ): Promise<AgentMessage[]> {
        return await this.prisma.agentMessage.findMany({
            where: { agentId },
            orderBy: { timestamp: 'desc' },
        });
    }

    async getAgentMessagesPaginated(
        agentId: string,
        opts: { limit: number; beforeTimestamp?: Date }
    ): Promise<AgentMessage[]> {
        const where: any = { agentId };
        if (opts.beforeTimestamp) where.timestamp = { lt: opts.beforeTimestamp };
        return await this.prisma.agentMessage.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: opts.limit,
        });
    }

    async copyMessagesFromAgent(sourceAgentId: string, targetAgentId: string, promptIdMapping: Map<string, string>): Promise<number> {
        // Get all non-reverted messages from source agent
        const sourceMessages = await this.prisma.agentMessage.findMany({
            where: {
                agentId: sourceAgentId,
                isReverted: false
            },
            orderBy: { timestamp: 'asc' }
        });

        // Copy messages to target agent with new IDs and mapped taskIds
        const copiedMessages = sourceMessages.map(msg => ({
            id: crypto.randomUUID(),
            agentId: targetAgentId,
            role: msg.role,
            content: msg.content,
            model: msg.model,
            timestamp: msg.timestamp,
            tools: msg.tools === null ? Prisma.DbNull : msg.tools,
            taskId: msg.taskId ? promptIdMapping.get(msg.taskId) || null : null, // Map old prompt ID to new prompt ID
            isReverted: false,
            revertedAt: null,
            revertedByCheckpoint: null
        }));

        if (copiedMessages.length > 0) {
            await this.prisma.agentMessage.createMany({
                data: copiedMessages
            });
            await this.prisma.agent.update({
                where: { id: targetAgentId },
                data: { eventsVersion: { increment: 1 } }
            });
        }

        return copiedMessages.length;
    }

    async markAsReverted(
        agentId: string,
        messageIds: string[],
        checkpointSha: string
    ): Promise<void> {
        const now = new Date();

        await this.prisma.agentMessage.updateMany({
            where: { id: { in: messageIds } },
            data: {
                isReverted: true,
                revertedAt: now,
                revertedByCheckpoint: checkpointSha
            }
        });
        await this.prisma.agent.update({
            where: { id: agentId },
            data: { eventsVersion: { increment: 1 } }
        });
    }

    async findBySourceUuid(agentId: string, sourceUuid: string): Promise<{
        id: string,
        tools?: Array<{ use: ToolUse; result?: ToolResult }>
    } | null> {
        const existing = await this.prisma.agentMessage.findFirst({
            where: { agentId, sourceUuid },
            select: { id: true, tools: true }
        });

        return existing ? {
            id: existing.id,
            tools: existing.tools ? JSON.parse(JSON.stringify(existing.tools)) : null
        } : null;
    }

    async storePolledMessage(agentId: string, message: {
        role: 'user' | 'assistant';
        content: string;
        model?: string;
        timestamp: Date;
        tools?: Array<{ use: ToolUse; result?: ToolResult }>;
        taskId?: string | null;
        isStreaming?: boolean;
        sourceUuid?: string;
    }): Promise<string> {
        const messageId = crypto.randomUUID();

        await this.prisma.agentMessage.create({
            data: {
                id: messageId,
                agentId,
                role: message.role,
                content: message.content,
                model: message.model || null,
                timestamp: message.timestamp,
                tools: message.tools ? JSON.parse(JSON.stringify(message.tools)) : null,
                taskId: message.taskId || null,
                isStreaming: message.isStreaming || false,
                sourceUuid: message.sourceUuid || null,
                isReverted: false,
                revertedAt: null,
                revertedByCheckpoint: null
            }
        });

        // Update agent's last tool info for UI display (only for assistant messages with tools)
        if (message.role === 'assistant' && message.tools && message.tools.length > 0) {
            const lastTool = message.tools[message.tools.length - 1];
            const toolTarget = extractToolTarget(lastTool.use.name, lastTool.use.input);

            await this.prisma.agent.update({
                where: { id: agentId },
                data: {
                    lastToolName: lastTool.use.name,
                    lastToolTarget: toolTarget,
                    lastToolAt: message.timestamp,
                    eventsVersion: { increment: 1 }
                }
            });
        } else {
            await this.prisma.agent.update({
                where: { id: agentId },
                data: { eventsVersion: { increment: 1 } }
            });
        }

        return messageId;
    }

    async updatePolledMessage(message: {
        id: string;
        tools?: Array<{ use: ToolUse; result?: ToolResult }>;
    }): Promise<void> {
        const updated = await this.prisma.agentMessage.update({
            where: {
                id: message.id
            },
            data: {
                tools: message.tools ? JSON.parse(JSON.stringify(message.tools)) : null
            },
            select: { agentId: true }
        });
        await this.prisma.agent.update({
            where: { id: updated.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
    }

    /**
     * Find the current streaming message for an agent (there should be at most one).
     */
    async findStreamingMessage(agentId: string): Promise<{ id: string; content: string } | null> {
        return await this.prisma.agentMessage.findFirst({
            where: {
                agentId,
                isStreaming: true
            },
            select: { id: true, content: true }
        });
    }

    /**
     * Update a streaming message's content, or finalize it (set isStreaming=false).
     */
    async updateStreamingMessage(id: string, agentId: string, content: string, isStreaming: boolean, sourceUuid?: string): Promise<void> {
        const data: any = { content, isStreaming };
        if (sourceUuid) data.sourceUuid = sourceUuid;
        await this.prisma.agentMessage.update({
            where: { id },
            data
        });
        await this.prisma.agent.update({
            where: { id: agentId },
            data: { eventsVersion: { increment: 1 } }
        });
    }

    async findMany(where?: Prisma.AgentMessageWhereInput, options?: { orderBy?: 'ASC' | 'DESC', limit?: number, offset?: number }): Promise<AgentMessage[]> {
        return await this.prisma.agentMessage.findMany({
            where,
            orderBy: options?.orderBy ? { timestamp: options.orderBy.includes('DESC') ? 'desc' : 'asc' } : undefined,
            take: options?.limit,
            skip: options?.offset
        });
    }

    async delete(where: Prisma.AgentMessageWhereInput): Promise<void> {
        await this.prisma.agentMessage.deleteMany({ where });
    }

    async create(data: Prisma.AgentMessageCreateInput): Promise<AgentMessage> {
        return await this.prisma.agentMessage.create({
            data
        });
    }

    async markMessagesAsRevertedWithTransaction(
        agentId: string,
        checkpointSha: string,
        checkpointTimestamp: Date
    ): Promise<{ messageCount: number }> {
        const result = await this.prisma.$transaction(async (tx) => {
            const currentTime = new Date();

            const result = await tx.agentMessage.updateMany({
                where: {
                    agentId,
                    timestamp: {gt: checkpointTimestamp},
                    isReverted: false
                },
                data: {
                    isReverted: true,
                    revertedAt: currentTime,
                    revertedByCheckpoint: checkpointSha
                }
            });

            if (result.count > 0) {
                await tx.agent.update({
                    where: { id: agentId },
                    data: { eventsVersion: { increment: 1 } }
                });
            }

            return {messageCount: result.count};
        });

        return result;
    }
}
