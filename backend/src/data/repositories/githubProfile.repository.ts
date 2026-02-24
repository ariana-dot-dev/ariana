import { PrismaClient, Prisma, type GitHubProfile } from '../../../generated/prisma';

export class GitHubProfileRepository {
    constructor(private prisma: PrismaClient) {}

    async create(profile: {
        id: string;
        name: string;
        email: string;
        image: string | null;
    }): Promise<GitHubProfile> {
        const now = new Date();

        return await this.prisma.gitHubProfile.create({
            data: {
                id: profile.id,
                name: profile.name,
                email: profile.email,
                image: profile.image,
                createdAt: now,
                updatedAt: now
            }
        });
    }

    async findById(id: string): Promise<GitHubProfile | null> {
        return await this.prisma.gitHubProfile.findUnique({
            where: { id }
        });
    }

    async findByEmail(email: string): Promise<GitHubProfile | null> {
        return await this.prisma.gitHubProfile.findUnique({
            where: { email }
        });
    }

    async update(id: string, updates: {
        name?: string;
        email?: string;
        image?: string | null;
    }): Promise<GitHubProfile | null> {
        try {
            return await this.prisma.gitHubProfile.update({
                where: { id },
                data: {
                    ...updates,
                    updatedAt: new Date()
                }
            });
        } catch {
            return null;
        }
    }

    async delete(id: string): Promise<boolean> {
        try {
            await this.prisma.gitHubProfile.delete({
                where: { id }
            });
            return true;
        } catch {
            return false;
        }
    }

    async upsert(profile: {
        id: string;
        name: string;
        email: string;
        image: string | null;
    }): Promise<GitHubProfile> {
        const now = new Date();

        return await this.prisma.gitHubProfile.upsert({
            where: { id: profile.id },
            update: {
                name: profile.name,
                email: profile.email,
                image: profile.image,
                updatedAt: now
            },
            create: {
                id: profile.id,
                name: profile.name,
                email: profile.email,
                image: profile.image,
                createdAt: now,
                updatedAt: now
            }
        });
    }

    async findMany(where?: Prisma.GitHubProfileWhereInput): Promise<GitHubProfile[]> {
        return await this.prisma.gitHubProfile.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });
    }
}