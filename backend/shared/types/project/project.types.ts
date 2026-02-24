// Project domain types are now provided by Prisma
// This file only contains enums and helper types

// Project role enum - matches GitHub repository permissions exactly
// VISITOR is a special Ariana-only role (below READ) for users with agent access but no project membership
export enum ProjectRole {
  ADMIN = 'admin',
  MAINTAIN = 'maintain',
  WRITE = 'write',
  TRIAGE = 'triage',
  READ = 'read',
  VISITOR = 'visitor'  // Ariana-only: can access shared agents but cannot create agents/specs
}


// API types - using Prisma types directly
export namespace ProjectAPI {
  export interface CreateRequest {
    name: string;
    repositoryId?: string;
  }

  export interface CreateFromGitHubRequest {
    githubUrl?: string;
    githubRepositoryId?: number;
    localFolderName?: string;
    cloneUrl?: string;
  }

  export interface CreateFromGitHubResponse {
    success: boolean;
    project?: {
      id: string;
      name: string;
      repositoryId: string | null;
      cloneUrl: string | null;
      createdAt: Date | null;
      updatedAt: Date | null;
    };
    repository?: {
      id: string;
      githubId: number;
    };
    message?: string;
    error?: string;
  }

  export interface UpdateRequest {
    name?: string;
    repositoryId?: string | null;
  }

  export interface AddMemberRequest {
    userId: string;
    role: ProjectRole;
  }
}