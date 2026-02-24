
import { PrismaClient, Prisma, type Agent } from '../../../generated/prisma';
import { getLogger } from '@/utils/logger.ts';
import { generateAgentBranchName, generateAgentName } from '@/utils/agent-name-generator.ts';
import {
  AgentState,
} from '@shared/types';
import { emitAgentCreated, emitAgentUpdated, emitAgentDeleted } from '@/websocket/emit-helpers';

const logger = getLogger(['db', 'agent']);

export class AgentRepository {
  constructor(private prisma: PrismaClient) {}

  // ProjectViewContent compatible createAgent method
  async createAgentWithReturn(params: {
    projectId: string;
    userId: string;
    name?: string;
    state?: AgentState;
  }): Promise<Agent> {
    const agentId = crypto.randomUUID();
    const now = new Date();

    const generatedName = generateAgentName();
    const branchName = generateAgentBranchName(agentId, generatedName);

    const created = await this.prisma.agent.create({
      data: {
        id: agentId,
        projectId: params.projectId,
        userId: params.userId,
        name: params.name || generatedName,
        branchName: branchName,
        machineId: null,
        state: params.state || AgentState.PROVISIONING,
        isRunning: false,
        isReady: false,
        currentTaskId: null,
        createdAt: now,
        updatedAt: now
      }
    });

    emitAgentCreated(created.id, params.userId);
    return created;
  }

  async updateState(agentId: string, state: AgentState): Promise<void> {
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        state,
        updatedAt: new Date()
      }
    });
    emitAgentUpdated(agentId);
  }

  /**
   * Atomically transition agent state from expectedState to newState.
   * Returns true if transition succeeded, false if agent was not in expectedState.
   * This prevents race conditions when multiple processes try to change state.
   */
  async tryTransitionState(
    agentId: string,
    expectedStates: AgentState[],
    newState: AgentState
  ): Promise<boolean> {
    const result = await this.prisma.agent.updateMany({
      where: {
        id: agentId,
        state: { in: expectedStates.map(s => s.toString()) }
      },
      data: {
        state: newState,
        updatedAt: new Date()
      }
    });
    if (result.count > 0) emitAgentUpdated(agentId);
    return result.count > 0;
  }

  async userOwnsAgent(agentId: string, userId: string): Promise<boolean> {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { userId: true }
    });
    return agent?.userId === userId;
  }

  // Additional methods moved from ProjectViewContent
  async getAgentById(agentId: string): Promise<Agent | null> {
    return await this.prisma.agent.findUnique({
      where: { id: agentId }
    });
  }

  async getAgentByIdWithProject(agentId: string): Promise<(Agent & { project: { id: string; name: string } }) | null> {
    return await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    }) as any;
  }

  async getAgentByMachineId(machineId: string): Promise<Agent | null> {
    return await this.prisma.agent.findFirst({
      where: { machineId }
    });
  }

  async getAllAgents(): Promise<Agent[]> {
    return await this.prisma.agent.findMany({
      orderBy: { createdAt: 'desc' }
    });
  }

  async getArchivedAgentsWithQueuedPrompts(): Promise<Agent[]> {
    return await this.prisma.agent.findMany({
      where: {
        state: 'archived',
        tasks: {
          some: {
            status: { in: ['queued', 'running'] }
          }
        }
      }
    });
  }

  async updateAgentFields(agentId: string, updates: Partial<Agent>): Promise<void> {
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        ...updates,
        updatedAt: new Date()
      }
    });
    emitAgentUpdated(agentId);
  }

  async cleanupRuntimeState(agentId: string): Promise<void> {
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        isRunning: false,
        isReady: false,
        updatedAt: new Date()
      }
    });
    emitAgentUpdated(agentId);
  }

  async getProjectAgents(projectId: string, includeTrashed: boolean = false): Promise<Agent[]> {
    return await this.prisma.agent.findMany({
      where: {
        projectId,
        ...(includeTrashed ? {} : { isTrashed: false })
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getUserAgents(userId: string, includeTrashed: boolean = false): Promise<Agent[]> {
    return await this.prisma.agent.findMany({
      where: {
        userId,
        ...(includeTrashed ? {} : { isTrashed: false })
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getUserAgentsWithProjects(userId: string, includeTrashed: boolean = false): Promise<Array<Agent & { project: { id: string; name: string } }>> {
    return await this.prisma.agent.findMany({
      where: {
        userId,
        ...(includeTrashed ? {} : { isTrashed: false })
      },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    }) as any;
  }

  async getAllAgentsWithProjects(includeTrashed: boolean = false): Promise<Array<Agent & { project: { id: string; name: string } }>> {
    return await this.prisma.agent.findMany({
      where: includeTrashed ? {} : { isTrashed: false },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    }) as any;
  }

  async moveAgentsToProject(fromProjectId: string, toProjectId: string): Promise<number> {
    const result = await this.prisma.agent.updateMany({
      where: { projectId: fromProjectId },
      data: { projectId: toProjectId }
    });
    return result.count;
  }

  async addProgressUpdate(agentId: string, message: string): Promise<void> {
    logger.info `Agent ${agentId} Progress: ${message}`;
  }

  async deleteAgentAndRelatedData(agentId: string): Promise<void> {
    // Get the agent's project ID before deletion for notification
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { projectId: true, userId: true }
    });

    // Delete related data first (in a transaction for consistency)
    await this.prisma.$transaction([
      // Clear currentTaskId FK before deleting prompts/agent
      this.prisma.agent.update({
        where: { id: agentId },
        data: { currentTaskId: null }
      }),
      // Delete records that reference AgentPrompt FIRST (due to FK constraints)
      this.prisma.agentMessage.deleteMany({
        where: { agentId: agentId }
      }),
      this.prisma.agentCommit.deleteMany({
        where: { agentId: agentId }
      }),
      this.prisma.agentReset.deleteMany({
        where: { agentId: agentId }
      }),
      // Now delete AgentPrompt (after all references are removed)
      this.prisma.agentPrompt.deleteMany({
        where: { agentId: agentId }
      }),
      // Delete other related data
      // Removed: agentDiff.deleteMany - table no longer exists
      this.prisma.userAgentAccess.deleteMany({
        where: { agentId: agentId }
      }),
      this.prisma.agentUploadProgress.deleteMany({
        where: { agentId: agentId }
      }),
      // Delete LUX usage records
      this.prisma.luxUsageRecord.deleteMany({
        where: { agentId: agentId }
      }),
      // Finally delete the agent itself
      this.prisma.agent.delete({
        where: { id: agentId }
      })
    ]);

    if (agent?.userId) {
      emitAgentDeleted(agentId, agent.userId);
    }
  }

  async findMany(where?: Prisma.AgentWhereInput, options?: { orderBy?: 'ASC' | 'DESC', limit?: number, offset?: number }): Promise<Agent[]> {
    return await this.prisma.agent.findMany({
      where,
      orderBy: options?.orderBy ? { createdAt: options.orderBy.includes('DESC') ? 'desc' : 'asc' } : undefined,
      take: options?.limit,
      skip: options?.offset
    });
  }

  async update(where: Prisma.AgentWhereInput, data: Prisma.AgentUpdateInput): Promise<void> {
    await this.prisma.agent.updateMany({ where, data });
  }

  async delete(where: Prisma.AgentWhereInput): Promise<void> {
    await this.prisma.agent.deleteMany({ where });
  }

  async create(data: Prisma.AgentCreateInput): Promise<Agent> {
    return await this.prisma.agent.create({
      data
    });
  }

  async countActiveAgents(): Promise<number> {
    return await this.prisma.agent.count({
      where: {
        state: {
          in: ['provisioning', 'provisioned', 'cloning', 'ready', 'idle', 'running', 'archiving']
        }
      }
    });
  }

  async trashAgent(agentId: string): Promise<void> {
    const now = new Date();
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        isTrashed: true,
        trashedAt: now,
        updatedAt: now
      }
    });
    emitAgentUpdated(agentId);
  }

  async untrashAgent(agentId: string): Promise<void> {
    const now = new Date();
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        isTrashed: false,
        trashedAt: null,
        updatedAt: now
      }
    });
    emitAgentUpdated(agentId);
  }

  async getTrashedAgents(userId: string): Promise<Agent[]> {
    return await this.prisma.agent.findMany({
      where: {
        OR: [
          { userId: userId },
          {
            accesses: {
              some: {
                userId: userId
              }
            }
          }
        ],
        isTrashed: true
      },
      orderBy: { trashedAt: 'desc' }
    });
  }

  async count(): Promise<number> {
    return await this.prisma.agent.count();
  }

  async countTemplatesByProject(projectId: string): Promise<number> {
    return await this.prisma.agent.count({
      where: {
        projectId,
        isTemplate: true
      }
    });
  }

  async getTemplatesByProject(projectId: string, userId?: string): Promise<Agent[]> {
    // If userId provided, get both shared templates AND personal templates for that user
    // If no userId, only get shared templates
    return await this.prisma.agent.findMany({
      where: {
        projectId,
        isTemplate: true,
        isTrashed: false,
        OR: userId ? [
          { templateVisibility: 'shared' },
          { templateVisibility: 'personal', userId: userId }
        ] : [
          { templateVisibility: 'shared' }
        ]
      },
      orderBy: {
        templateMarkedAt: 'desc'
      }
    });
  }

  async makeTemplate(agentId: string, visibility: 'personal' | 'shared'): Promise<void> {
    const now = new Date();
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        isTemplate: true,
        templateVisibility: visibility,
        templateMarkedAt: now,
        updatedAt: now
      }
    });
    emitAgentUpdated(agentId);
  }

  async getEventsVersion(agentId: string): Promise<number | null> {
    const result = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { eventsVersion: true }
    });
    return result?.eventsVersion ?? null;
  }

  async removeTemplate(agentId: string): Promise<void> {
    const now = new Date();
    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        isTemplate: false,
        templateVisibility: null,
        templateMarkedAt: null,
        updatedAt: now
      }
    });
    emitAgentUpdated(agentId);
  }
}



