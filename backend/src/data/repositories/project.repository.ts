import { PrismaClient, Prisma, type Project } from '../../../generated/prisma';

export class ProjectRepository {
  constructor(private prisma: PrismaClient) {}

  async createProject(data: {
    name: string;
    repositoryId?: string | null;
    cloneUrl?: string | null;
  }): Promise<Project> {
    const id = `proj_${crypto.randomUUID()}`;
    const now = new Date();

    return await this.prisma.project.create({
      data: {
        id,
        name: data.name,
        repositoryId: data.repositoryId || null,
        cloneUrl: data.cloneUrl || null,
        createdAt: now,
        updatedAt: now
      }
    });
  }

  async updateProjectCloneUrl(projectId: string, cloneUrl: string): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        cloneUrl,
        updatedAt: new Date()
      }
    });
  }

  async findById(projectId: string): Promise<Project | null> {
    return await this.prisma.project.findUnique({
      where: { id: projectId }
    });
  }

  async findByUserId(userId: string): Promise<Project[]> {
    return await this.prisma.project.findMany({
      where: {
        members: {
          some: {
            userId: userId
          }
        }
      }
    });
  }

  async findByRepositoryId(repositoryId: string): Promise<Project | null> {
    return await this.prisma.project.findFirst({
      where: { repositoryId }
    });
  }

  async findByRepositoryAndUser(repositoryId: string, userId: string): Promise<Project | null> {
    return await this.prisma.project.findFirst({
      where: {
        repositoryId,
        members: {
          some: {
            userId: userId
          }
        }
      }
    });
  }

  async updateProjectRepository(projectId: string, repositoryId: string): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        repositoryId,
        updatedAt: new Date()
      }
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    // Get all agents for this project to find their prompts
    const agents = await this.prisma.agent.findMany({
      where: { projectId },
      select: { id: true }
    });
    const agentIds = agents.map(a => a.id);

    await this.prisma.$transaction([
      // Null out Agent.currentTaskId to break the NoAction FK to AgentPrompt
      this.prisma.agent.updateMany({
        where: { projectId },
        data: { currentTaskId: null }
      }),
      // Null out taskId FKs on tables that reference AgentPrompt with NoAction
      ...(agentIds.length > 0 ? [
        this.prisma.agentMessage.updateMany({
          where: { agentId: { in: agentIds }, taskId: { not: null } },
          data: { taskId: null }
        }),
        this.prisma.agentCommit.updateMany({
          where: { agentId: { in: agentIds }, taskId: { not: null } },
          data: { taskId: null }
        }),
        this.prisma.agentReset.updateMany({
          where: { agentId: { in: agentIds }, taskId: { not: null } },
          data: { taskId: null }
        }),
        this.prisma.automationEvent.updateMany({
          where: { agentId: { in: agentIds }, taskId: { not: null } },
          data: { taskId: null }
        }),
      ] : []),
      // Now the cascade can proceed: Project -> Agent -> AgentPrompt, etc.
      this.prisma.projectMember.deleteMany({
        where: { projectId }
      }),
      this.prisma.project.delete({
        where: { id: projectId }
      })
    ]);
  }

  async count(): Promise<number> {
    return this.prisma.project.count();
  }
}