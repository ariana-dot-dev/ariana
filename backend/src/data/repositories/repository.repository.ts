
import { PrismaClient, Prisma, type Repository } from '../../../generated/prisma';

export class RepositoryRepository {
  constructor(private prisma: PrismaClient) {}

  async updateRepository(
    id: string,
    updates: Partial<Repository>
  ): Promise<void> {
    await this.prisma.repository.update({
      where: { id },
      data: {
        ...updates,
        updatedAt: new Date()
      }
    });
  }

  async findByGithubId(githubId: number): Promise<Repository | null> {
    return await this.prisma.repository.findUnique({
      where: { githubId }
    });
  }

  async findByFullName(fullName: string): Promise<Repository | null> {
    return await this.prisma.repository.findFirst({
      where: { fullName }
    });
  }


  async getRepositoryFullName(repositoryId: string): Promise<string | null> {
    const repo = await this.prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { fullName: true }
    });
    return repo?.fullName || null;
  }

  async deleteRepository(repositoryId: string): Promise<void> {
    await this.prisma.repository.delete({
      where: { id: repositoryId }
    });
  }


  async upsertRepository(repo: {
    id: string;
    githubId: number;
    name: string;
    fullName: string;
    description?: string;
    url: string;
    baseBranch?: string;
    lastCommitAt?: Date;
  }): Promise<Repository> {
    const now = new Date();

    return await this.prisma.repository.upsert({
      where: { githubId: repo.githubId },
      update: {
        name: repo.name,
        fullName: repo.fullName,
        description: repo.description || null,
        url: repo.url,
        lastCommitAt: repo.lastCommitAt || null,
        lastSyncAt: now,
        updatedAt: now
      },
      create: {
        id: repo.id,
        githubId: repo.githubId,
        name: repo.name,
        fullName: repo.fullName,
        description: repo.description || null,
        url: repo.url,
        baseBranch: repo.baseBranch || 'main',
        lastCommitAt: repo.lastCommitAt || null,
        lastSyncAt: now,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async batchUpsert(repos: Array<{
    id: string;
    githubId: number;
    name: string;
    fullName: string;
    description?: string;
    url: string;
    baseBranch?: string;
    lastCommitAt?: Date;
  }>): Promise<void> {
    if (repos.length === 0) return;

    const now = new Date();

    // Prisma doesn't have a built-in batch upsert, so we'll use transactions
    await this.prisma.$transaction(
      repos.map(repo =>
        this.prisma.repository.upsert({
          where: { githubId: repo.githubId },
          update: {
            name: repo.name,
            fullName: repo.fullName,
            description: repo.description || null,
            url: repo.url,
            lastCommitAt: repo.lastCommitAt || null,
            lastSyncAt: now,
            updatedAt: now
          },
          create: {
            id: repo.id,
            githubId: repo.githubId,
            name: repo.name,
            fullName: repo.fullName,
            description: repo.description || null,
            url: repo.url,
            baseBranch: repo.baseBranch || 'main',
            lastCommitAt: repo.lastCommitAt || null,
            lastSyncAt: now,
            createdAt: now,
            updatedAt: now
          }
        })
      )
    );
  }

  async findById(id: string): Promise<Repository | null> {
    return await this.prisma.repository.findUnique({
      where: { id }
    });
  }

  async findMany(where?: Prisma.RepositoryWhereInput, options?: { orderBy?: Prisma.RepositoryOrderByWithRelationInput }): Promise<Repository[]> {
    return await this.prisma.repository.findMany({
      where,
      orderBy: options?.orderBy
    });
  }

  async exists(where: Prisma.RepositoryWhereInput): Promise<boolean> {
    const count = await this.prisma.repository.count({ where });
    return count > 0;
  }
}