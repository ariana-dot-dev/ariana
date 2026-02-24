import { PrismaClient, Prisma, type ProjectMember } from '../../../generated/prisma';
import { ProjectRole } from '@shared/types';
import { emitCollaboratorsChanged } from '@/websocket/emit-helpers';

export class ProjectMemberRepository {
  constructor(private prisma: PrismaClient) {}

  async upsertMember(data: {
    projectId: string;
    userId: string;
    role: ProjectRole;
  }): Promise<ProjectMember> {
    const id = `member_${crypto.randomUUID()}`;
    const now = new Date();

    // @ts-ignore
    const result = await this.prisma.projectMember.upsert({
      where: {
        //@ts-ignore
        projectId_userId: {
          projectId: data.projectId,
          userId: data.userId
        }
      },
      update: {
        role: data.role,
        updatedAt: now
      },
      create: {
        id,
        projectId: data.projectId,
        userId: data.userId,
        role: data.role,
        createdAt: now,
        updatedAt: now
      }
    });
    emitCollaboratorsChanged(data.projectId);
    return result;
  }

  async findMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    return await this.prisma.projectMember.findFirst({
      where: {
        projectId,
        userId
      }
    });
  }

  async userHasAccess(projectId: string, userId: string): Promise<boolean> {
    const member = await this.findMember(projectId, userId);
    return !!member;
  }

  async findByProjectId(projectId: string): Promise<ProjectMember[]> {
    return await this.prisma.projectMember.findMany({
      where: { projectId }
    });
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.prisma.projectMember.deleteMany({
      where: {
        projectId,
        userId
      }
    });
    emitCollaboratorsChanged(projectId);
  }
}