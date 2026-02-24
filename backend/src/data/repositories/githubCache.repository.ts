import { PrismaClient, type GitHubCache } from '../../../generated/prisma';
import { randomUUID } from 'crypto';

export class GithubCacheRepository {
    constructor(private prisma: PrismaClient) {}

    /**
     * Get cached data by cache key
     * Returns null if not found or expired
     */
    async get(cacheKey: string): Promise<GitHubCache | null> {
        const now = new Date();

        const cached = await this.prisma.gitHubCache.findFirst({
            where: {
                cacheKey,
                expiresAt: { gt: now }
            }
        });

        return cached;
    }

    /**
     * Get cached data even if expired (for fallback during rate limits)
     */
    async getEvenIfExpired(cacheKey: string): Promise<GitHubCache | null> {
        return await this.prisma.gitHubCache.findFirst({
            where: { cacheKey },
            orderBy: { updatedAt: 'desc' }
        });
    }

    /**
     * Set cache data with TTL
     */
    async set(params: {
        cacheKey: string;
        endpoint: string;
        data: string;
        ttlMs: number;
        repositoryId?: string;
    }): Promise<void> {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + params.ttlMs);

        await this.prisma.gitHubCache.upsert({
            where: {
                id: params.cacheKey // Use cacheKey as id for simplicity
            },
            update: {
                data: params.data,
                expiresAt,
                updatedAt: now
            },
            create: {
                id: params.cacheKey,
                cacheKey: params.cacheKey,
                endpoint: params.endpoint,
                repositoryId: params.repositoryId || null,
                data: params.data,
                expiresAt,
                createdAt: now,
                updatedAt: now
            }
        });
    }

    /**
     * Delete specific cache entry
     */
    async delete(cacheKey: string): Promise<void> {
        await this.prisma.gitHubCache.deleteMany({
            where: { cacheKey }
        });
    }

    /**
     * Clean up all expired cache entries
     */
    async cleanupExpired(): Promise<number> {
        const now = new Date();
        const result = await this.prisma.gitHubCache.deleteMany({
            where: {
                expiresAt: { lt: now }
            }
        });
        return result.count;
    }

    /**
     * Delete all cache entries for a repository
     */
    async deleteByRepository(repositoryId: string): Promise<void> {
        await this.prisma.gitHubCache.deleteMany({
            where: { repositoryId }
        });
    }
}
