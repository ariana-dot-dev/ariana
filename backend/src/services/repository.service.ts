// Simplified Repository service - no database permissions, uses GitHub only
import type { RepositoryContainer } from '../data/repositories';
import type { Repository } from '../../shared/types';

export class RepositoryService {
  constructor(private repositories: RepositoryContainer) {}

  // Create or update repository from GitHub data
  async upsertRepository(repoData: {
    id: string;
    githubId: number;
    name: string;
    fullName: string;
    description?: string;
    url: string;
    lastCommitAt?: Date;
  }): Promise<Repository> {
    return this.repositories.repositories.upsertRepository(repoData);
  }

  // Get repository by ID
  async getRepositoryById(repositoryId: string): Promise<Repository | null> {
    return this.repositories.repositories.findById(repositoryId);
  }

  // Get repository by GitHub ID
  async getRepositoryByGithubId(githubId: number): Promise<Repository | null> {
    return this.repositories.repositories.findByGithubId(githubId);
  }

  // Update repository metadata (no permission check - done at API level)
  async updateRepositoryMetadata(
    repositoryId: string,
    updates: {
      name?: string;
      fullName?: string;
      description?: string;
      url?: string;
      lastCommitAt?: Date;
    }
  ): Promise<void> {
    await this.repositories.repositories.updateRepository(repositoryId, updates);
  }

  // Update repository base branch
  async updateBaseBranch(repositoryId: string, baseBranch: string): Promise<Repository | null> {
    await this.repositories.repositories.updateRepository(repositoryId, { baseBranch });
    return this.repositories.repositories.findById(repositoryId);
  }

  async deleteRepository(repositoryId: string): Promise<void> {
    await this.repositories.repositories.deleteRepository(repositoryId);
  }
}
