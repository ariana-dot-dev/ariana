import { PrismaClient, Prisma, type AgentCommit } from '../../../generated/prisma';
import crypto from 'crypto';
import { emitAgentEventsChanged, emitAgentSummaryChanged } from '@/websocket/emit-helpers';

export class AgentCommitRepository {
    constructor(private prisma: PrismaClient) {}

    async createCommit(commit: {
        id: string;
        agentId: string;
        projectId: string;
        commitSha: string;
        commitMessage: string;
        commitUrl: string | null;
        branchName: string;
        title?: string | null;
        commitPatch?: string | null;
        taskId?: string;
        filesChanged: number;
        additions: number;
        deletions: number;
        createdAt?: Date;
        pushed?: boolean;
        pushedAt?: Date | null;
    }): Promise<AgentCommit> {
        const now = new Date();

        const result = await this.prisma.agentCommit.create({
            data: {
                id: commit.id,
                agentId: commit.agentId,
                projectId: commit.projectId,
                commitSha: commit.commitSha,
                commitMessage: commit.commitMessage,
                commitUrl: commit.commitUrl,
                branchName: commit.branchName,
                title: commit.title || null,
                commitPatch: commit.commitPatch || null,
                taskId: commit.taskId,
                filesChanged: commit.filesChanged,
                additions: commit.additions,
                deletions: commit.deletions,
                createdAt: commit.createdAt || now,
                pushed: commit.pushed ?? false,
                pushedAt: commit.pushedAt ?? null
            }
        });

        // Update agent's last commit info for UI display + bump eventsVersion
        await this.prisma.agent.update({
            where: { id: commit.agentId },
            data: {
                lastCommitSha: commit.commitSha,
                lastCommitUrl: commit.commitUrl,
                lastCommitAt: now,
                eventsVersion: { increment: 1 }
            }
        });

        emitAgentEventsChanged(commit.agentId, { addedCommitIds: [result.id] });
        emitAgentSummaryChanged(commit.agentId);
        return result;
    }

    async upsertCommit(commit: {
        agentId: string;
        projectId: string;
        commitSha: string;
        commitMessage: string;
        commitUrl: string | null;
        branchName: string;
        title?: string | null;
        commitPatch?: string | null;
        taskId?: string | null;
        filesChanged: number;
        additions: number;
        deletions: number;
        timestamp: number;
        pushed: boolean;
        pushedAt?: Date | null;
    }): Promise<AgentCommit> {
        const createdAt = new Date(commit.timestamp);

        const result = await this.prisma.agentCommit.upsert({
            where: {
                agentId_commitSha: {
                    agentId: commit.agentId,
                    commitSha: commit.commitSha
                }
            },
            create: {
                id: crypto.randomUUID(),
                agentId: commit.agentId,
                projectId: commit.projectId,
                commitSha: commit.commitSha,
                commitMessage: commit.commitMessage,
                commitUrl: commit.commitUrl,
                branchName: commit.branchName,
                title: commit.title || null,
                commitPatch: commit.commitPatch || null,
                taskId: commit.taskId || null,
                filesChanged: commit.filesChanged,
                additions: commit.additions,
                deletions: commit.deletions,
                createdAt,
                pushed: commit.pushed,
                pushedAt: commit.pushedAt || null,
                isDeleted: false
            },
            update: {
                commitMessage: commit.commitMessage,
                commitUrl: commit.commitUrl,
                branchName: commit.branchName,
                title: commit.title || null,
                commitPatch: commit.commitPatch || null,
                taskId: commit.taskId || null,
                filesChanged: commit.filesChanged,
                additions: commit.additions,
                deletions: commit.deletions,
                pushed: commit.pushed,
                pushedAt: commit.pushedAt || null
            }
        });
        await this.prisma.agent.update({
            where: { id: commit.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        // Upsert: could be add or modify, send as add (frontend deduplicates by ID)
        emitAgentEventsChanged(commit.agentId, { addedCommitIds: [result.id] });
        emitAgentSummaryChanged(commit.agentId);
        return result;
    }

    async getAgentCommits(agentId: string): Promise<AgentCommit[]> {
        return await this.prisma.agentCommit.findMany({
            where: { agentId },
            orderBy: { createdAt: 'desc' },
        });
    }

    async getAgentCommitsPaginated(
        agentId: string,
        opts: { limit: number; beforeTimestamp?: Date }
    ): Promise<AgentCommit[]> {
        const where: any = { agentId };
        if (opts.beforeTimestamp) where.createdAt = { lt: opts.beforeTimestamp };
        return await this.prisma.agentCommit.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: opts.limit,
        });
    }

    async findMany(where?: Prisma.AgentCommitWhereInput, options?: { orderBy?: 'ASC' | 'DESC' }): Promise<AgentCommit[]> {
        return await this.prisma.agentCommit.findMany({
            where,
            orderBy: options?.orderBy ? { createdAt: options.orderBy.includes('DESC') ? 'desc' : 'asc' } : undefined,
        });
    }

    async delete(where: Prisma.AgentCommitWhereInput): Promise<void> {
        await this.prisma.agentCommit.deleteMany({ where });
    }

    async create(data: Prisma.AgentCommitCreateInput): Promise<AgentCommit> {
        return await this.prisma.agentCommit.create({
            data
        });
    }

    async findOne(where: Prisma.AgentCommitWhereInput): Promise<AgentCommit | null> {
        return await this.prisma.agentCommit.findFirst({ where });
    }

    async markCommitsAsDeleted(agentId: string, afterTimestamp: number, revertedToSha: string): Promise<void> {
        const now = new Date();
        const result = await this.prisma.agentCommit.updateMany({
            where: {
                agentId,
                createdAt: {
                    gt: new Date(afterTimestamp)
                },
                commitSha: {
                    not: revertedToSha
                }
            },
            data: {
                isDeleted: true,
                deletedAt: now,
                isReverted: true,
                revertedAt: now,
                revertedByCheckpoint: revertedToSha
            }
        });
        if (result.count > 0) {
            await this.prisma.agent.update({
                where: { id: agentId },
                data: { eventsVersion: { increment: 1 } }
            });
            // Bulk op — no specific IDs, triggers full refresh
            emitAgentEventsChanged(agentId);
            emitAgentSummaryChanged(agentId);
        }
    }

    async unmarkCommitsAsDeleted(agentId: string): Promise<void> {
        const result = await this.prisma.agentCommit.updateMany({
            where: {
                agentId,
                isDeleted: true
            },
            data: {
                isDeleted: false,
                deletedAt: null
            }
        });
        if (result.count > 0) {
            await this.prisma.agent.update({
                where: { id: agentId },
                data: { eventsVersion: { increment: 1 } }
            });
            // Bulk op — no specific IDs, triggers full refresh
            emitAgentEventsChanged(agentId);
            emitAgentSummaryChanged(agentId);
        }
    }

    async update(commitId: string, fields: Partial<AgentCommit>): Promise<void> {
        const commit = await this.prisma.agentCommit.update({
            where: { id: commitId },
            data: fields,
            select: { agentId: true }
        });
        await this.prisma.agent.update({
            where: { id: commit.agentId },
            data: { eventsVersion: { increment: 1 } }
        });
        emitAgentEventsChanged(commit.agentId, { modifiedCommitIds: [commitId] });
        emitAgentSummaryChanged(commit.agentId);
    }

    async count(): Promise<number> {
        return await this.prisma.agentCommit.count();
    }

    async getUnpushedCommits(agentId: string): Promise<AgentCommit[]> {
        return await this.prisma.agentCommit.findMany({
            where: {
                agentId,
                pushed: false,
                isDeleted: false
            },
            orderBy: { createdAt: 'asc' }
        });
    }
}
