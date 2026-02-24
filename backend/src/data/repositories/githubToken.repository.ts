import { PrismaClient, Prisma, type GitHubToken } from '../../../generated/prisma';

export class GithubTokenRepository {
    constructor(private prisma: PrismaClient) {}

    async upsertToken(token: {
        id: string;
        userId: string;
        accessToken: string;
        refreshToken?: string;
        scope?: string;
        expiresAt?: Date;
    }): Promise<void> {
        const now = new Date();

        await this.prisma.gitHubToken.upsert({
            where: { id: token.id },
            update: {
                accessToken: token.accessToken,
                refreshToken: token.refreshToken || null,
                scope: token.scope || null,
                expiresAt: token.expiresAt || null
            },
            create: {
                id: token.id,
                userId: token.userId,
                accessToken: token.accessToken,
                refreshToken: token.refreshToken || null,
                scope: token.scope || null,
                tokenType: 'bearer',
                expiresAt: token.expiresAt || null,
                createdAt: now
            }
        });
    }

    async findByUserId(userId: string): Promise<GitHubToken | null> {
        return await this.prisma.gitHubToken.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });
    }

    async findById(id: string): Promise<GitHubToken | null> {
        return await this.prisma.gitHubToken.findUnique({
            where: { id }
        });
    }

    async deleteToken(id: string): Promise<void> {
        await this.prisma.gitHubToken.delete({
            where: { id }
        });
    }

    async deleteAllUserTokens(userId: string): Promise<void> {
        await this.prisma.gitHubToken.deleteMany({
            where: { userId }
        });
    }

    async updateToken(id: string, updates: {
        accessToken?: string;
        refreshToken?: string;
        scope?: string;
        expiresAt?: Date;
    }): Promise<GitHubToken | null> {
        try {
            return await this.prisma.gitHubToken.update({
                where: { id },
                data: updates
            });
        } catch {
            return null;
        }
    }

    async isTokenValid(userId: string): Promise<boolean> {
        const token = await this.findByUserId(userId);
        if (!token) return false;
        if (token.expiresAt && token.expiresAt < new Date()) return false;
        return true;
    }

    async cleanupExpiredTokens(): Promise<void> {
        const now = new Date();
        await this.prisma.gitHubToken.deleteMany({
            where: {
                expiresAt: {
                    lt: now
                }
            }
        });
    }
}