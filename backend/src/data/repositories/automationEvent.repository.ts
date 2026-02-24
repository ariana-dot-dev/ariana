import { PrismaClient, type AutomationEvent } from '../../../generated/prisma';
import { emitAgentEventsChanged } from '@/websocket/emit-helpers';

export class AutomationEventRepository {
  constructor(private prisma: PrismaClient) {}

  async createEvent(event: {
    agentId: string;
    automationId: string;
    taskId: string | null;
    trigger: string;
    output?: string | null;
    isStartTruncated?: boolean;
    status: string;
    startedAt?: Date;
    finishedAt?: Date;
    exitCode?: number | null;
  }): Promise<AutomationEvent> {
    const id = crypto.randomUUID();
    const now = new Date();

    const result = await this.prisma.automationEvent.create({
      data: {
        id,
        agentId: event.agentId,
        automationId: event.automationId,
        taskId: event.taskId,
        trigger: event.trigger,
        output: event.output || null,
        isStartTruncated: event.isStartTruncated || false,
        status: event.status,
        startedAt: event.startedAt || now,
        finishedAt: event.finishedAt || null,
        exitCode: event.exitCode ?? null,
        createdAt: now
      }
    });
    await this.prisma.agent.update({
      where: { id: event.agentId },
      data: { eventsVersion: { increment: 1 } }
    });
    emitAgentEventsChanged(event.agentId, { addedAutomationEventIds: [result.id] });
    return result;
  }

  async updateEvent(id: string, updates: {
    output?: string;
    isStartTruncated?: boolean;
    status?: string;
    exitCode?: number;
    finishedAt?: Date;
  }): Promise<AutomationEvent> {
    const result = await this.prisma.automationEvent.update({
      where: { id },
      data: updates
    });
    await this.prisma.agent.update({
      where: { id: result.agentId },
      data: { eventsVersion: { increment: 1 } }
    });
    emitAgentEventsChanged(result.agentId, { modifiedAutomationEventIds: [result.id] });
    return result;
  }

  async getEventById(id: string): Promise<AutomationEvent | null> {
    return await this.prisma.automationEvent.findUnique({
      where: { id }
    });
  }

  async findByIds(ids: string[]): Promise<AutomationEvent[]> {
    return await this.prisma.automationEvent.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: 'asc' }
    });
  }

  async getEventsForAgent(agentId: string): Promise<AutomationEvent[]> {
    return await this.prisma.automationEvent.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' }
    });
  }

  async getEventsForAgentPaginated(
    agentId: string,
    opts: { limit: number; beforeTimestamp?: Date }
  ): Promise<AutomationEvent[]> {
    const where: any = { agentId };
    if (opts.beforeTimestamp) where.createdAt = { lt: opts.beforeTimestamp };
    return await this.prisma.automationEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit,
    });
  }

  async getRunningEventsForAgent(agentId: string): Promise<AutomationEvent[]> {
    return await this.prisma.automationEvent.findMany({
      where: {
        agentId,
        status: 'running'
      },
      orderBy: { createdAt: 'asc' }
    });
  }

  async killRunningEventsForAgent(agentId: string): Promise<number> {
    const result = await this.prisma.automationEvent.updateMany({
      where: {
        agentId,
        status: 'running'
      },
      data: {
        status: 'killed',
        finishedAt: new Date()
      }
    });
    if (result.count > 0) {
      await this.prisma.agent.update({
        where: { id: agentId },
        data: { eventsVersion: { increment: 1 } }
      });
      emitAgentEventsChanged(agentId);
    }
    return result.count;
  }

  async deleteEventsForAgent(agentId: string): Promise<void> {
    await this.prisma.automationEvent.deleteMany({
      where: { agentId }
    });
  }

  /**
   * Check if a specific automation is currently running for an agent
   */
  async isAutomationRunning(agentId: string, automationId: string): Promise<boolean> {
    const runningEvent = await this.prisma.automationEvent.findFirst({
      where: {
        agentId,
        automationId,
        status: 'running'
      }
    });
    return runningEvent !== null;
  }

  /**
   * Get the most recent completed event for a specific automation and agent
   * Only returns 'finished' or 'failed' events (not 'running')
   */
  async getLatestCompletedEvent(agentId: string, automationId: string): Promise<AutomationEvent | null> {
    return await this.prisma.automationEvent.findFirst({
      where: {
        agentId,
        automationId,
        status: { in: ['finished', 'failed'] }
      },
      orderBy: { finishedAt: 'desc' }
    });
  }
}
