import type { RepositoryContainer } from '@/data/repositories';
import type { Project, ProjectMember } from '@shared/types';
import { ProjectRole } from '@shared/types';

export class ProjectService {
  constructor(private repositories: RepositoryContainer) {}

  // Create a new project
  async createProject(data: {
    name: string;
    repositoryId?: string;
    cloneUrl?: string;
  }): Promise<Project> {
    // Create project
    const project = await this.repositories.projects.createProject({
      name: data.name,
      repositoryId: data.repositoryId,
      cloneUrl: data.cloneUrl
    });

    return project;
  }

  // Get project by ID
  async getProject(projectId: string): Promise<Project | null> {
    return this.repositories.projects.findById(projectId);
  }

  // Get user's projects
  async getUserProjects(userId: string): Promise<Project[]> {
    return this.repositories.projects.findByUserId(userId);
  }

  // Check if user is a member of project
  async isProjectMember(projectId: string, userId: string): Promise<boolean> {
    return this.repositories.projectMembers.userHasAccess(projectId, userId);
  }

  // Get all members of a project
  async getProjectMembers(projectId: string): Promise<ProjectMember[]> {
    return this.repositories.projectMembers.findByProjectId(projectId);
  }

  // Get project by repository ID
  async getProjectByRepository(repositoryId: string): Promise<Project | null> {
    return this.repositories.projects.findByRepositoryId(repositoryId);
  }

  // Get project by repository ID and user access
  async getProjectByRepositoryAndUser(repositoryId: string, userId: string): Promise<Project | null> {
    return this.repositories.projects.findByRepositoryAndUser(repositoryId, userId);
  }

  // Upsert member to project (add or update role)
  async upsertProjectMember(data: {
    projectId: string;
    userId: string;
    role: ProjectRole;
  }): Promise<ProjectMember> {
    return this.repositories.projectMembers.upsertMember({
      projectId: data.projectId,
      userId: data.userId,
      role: data.role
    });
  }

  // Remove member from project
  async removeProjectMember(projectId: string, userId: string): Promise<void> {
    await this.repositories.projectMembers.removeMember(projectId, userId);
  }

  // Update project's repository ID
  async updateProjectRepository(projectId: string, repositoryId: string): Promise<void> {
    await this.repositories.projects.updateProjectRepository(projectId, repositoryId);
  }

  // Delete project and its members
  async deleteProject(projectId: string): Promise<void> {
    await this.repositories.projects.deleteProject(projectId);
  }

  // Get total projects count
  async getTotalProjectsCount(): Promise<number> {
    return this.repositories.projects.count();
  }
}