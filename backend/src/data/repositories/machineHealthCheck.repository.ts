import { PrismaClient, Prisma, type MachineHealthCheck } from '../../../generated/prisma';

export class MachineHealthCheckRepository {
  constructor(private prisma: PrismaClient) {}

  async upsertHealthCheck(agentId: string, machineId: string): Promise<MachineHealthCheck> {
    const now = new Date();

    return await this.prisma.machineHealthCheck.upsert({
      where: { agentId },
      create: {
        id: crypto.randomUUID(),
        agentId,
        machineId,
        consecutiveFailures: 0,
        lastCheckAt: now,
        lastSuccessAt: now,
        createdAt: now,
        updatedAt: now
      },
      update: {
        machineId,
        lastCheckAt: now,
        updatedAt: now
      }
    });
  }

  async recordSuccess(agentId: string): Promise<void> {
    const now = new Date();

    await this.prisma.machineHealthCheck.updateMany({
      where: { agentId },
      data: {
        consecutiveFailures: 0,
        lastSuccessAt: now,
        lastCheckAt: now,
        updatedAt: now
      }
    });
  }

  async recordFailure(agentId: string): Promise<void> {
    const now = new Date();

    await this.prisma.machineHealthCheck.updateMany({
      where: { agentId },
      data: {
        consecutiveFailures: { increment: 1 },
        lastFailureAt: now,
        lastCheckAt: now,
        updatedAt: now
      }
    });
  }

  async getHealthCheck(agentId: string): Promise<MachineHealthCheck | null> {
    return await this.prisma.machineHealthCheck.findUnique({
      where: { agentId }
    });
  }

  async deleteHealthCheck(agentId: string): Promise<void> {
    await this.prisma.machineHealthCheck.deleteMany({
      where: { agentId }
    });
  }

  async getFailingAgents(threshold: number): Promise<MachineHealthCheck[]> {
    return await this.prisma.machineHealthCheck.findMany({
      where: {
        consecutiveFailures: { gte: threshold }
      }
    });
  }

  async findMany(where?: Prisma.MachineHealthCheckWhereInput): Promise<MachineHealthCheck[]> {
    return await this.prisma.machineHealthCheck.findMany({
      where
    });
  }
}
