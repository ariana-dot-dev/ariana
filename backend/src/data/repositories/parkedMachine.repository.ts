import { PrismaClient, type ParkedMachine } from '../../../generated/prisma';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['db', 'parked-machine']);

export class ParkedMachineRepository {
  constructor(private prisma: PrismaClient) {}

  async createParkedMachine(data: {
    machineId: string | null;
    machineName: string | null;
    ipv4: string | null;
    sharedKey?: string | null;
    status?: string;
  }): Promise<ParkedMachine> {
    return await this.prisma.parkedMachine.create({
      data: {
        id: crypto.randomUUID(),
        machineId: data.machineId,
        machineName: data.machineName,
        ipv4: data.ipv4,
        sharedKey: data.sharedKey || null,
        status: data.status || 'launching'
      }
    });
  }

  // REMOVED: getReadyMachine() - now handled by queue processor in atomic transaction
  // REMOVED: claimMachine() - claiming now done in queue processor transaction
  // REMOVED: updateStatus() - status updates now done directly in specific methods
  // REMOVED: updateStatusById() - status updates now done directly in specific methods

  async deleteMachine(machineId: string): Promise<void> {
    await this.prisma.parkedMachine.deleteMany({
      where: { machineId }
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.parkedMachine.delete({
      where: { id }
    });
  }

  async updateMachineInfo(id: string, data: {
    machineId: string;
    machineName: string;
    ipv4: string;
    url?: string | null;
    desktopUrl?: string | null;
    streamingToken?: string | null;
    streamingHostId?: string | null;
    streamingAppId?: string | null;
    sharedKey: string;
    status: string;
  }): Promise<void> {
    // Update machine info fields
    // Only update status to 'ready' if current status is 'launching'
    // If status is 'claimed', keep it as 'claimed'
    const current = await this.prisma.parkedMachine.findUnique({
      where: { id }
    });

    if (current) {
      logger.info`[DESKTOP_URL_TRACE] updateMachineInfo ${id}: desktopUrl=${data.desktopUrl || 'null'}, streamingToken=${data.streamingToken ? 'yes' : 'null'}, hostId=${data.streamingHostId || 'null'}, appId=${data.streamingAppId || 'null'}`;
      await this.prisma.parkedMachine.update({
        where: { id },
        data: {
          machineId: data.machineId,
          machineName: data.machineName,
          ipv4: data.ipv4,
          url: data.url,
          desktopUrl: data.desktopUrl,
          streamingToken: data.streamingToken,
          streamingHostId: data.streamingHostId,
          streamingAppId: data.streamingAppId,
          sharedKey: data.sharedKey,
          status: current.status === 'launching' ? data.status : current.status
        }
      });
    }
  }

  async findById(id: string): Promise<ParkedMachine | null> {
    return await this.prisma.parkedMachine.findUnique({
      where: { id }
    });
  }

  async countByStatus(status: string): Promise<number> {
    return await this.prisma.parkedMachine.count({
      where: { status }
    });
  }

  async getAllMachines(): Promise<ParkedMachine[]> {
    return await this.prisma.parkedMachine.findMany({
      orderBy: { createdAt: 'asc' }
    });
  }

  async deleteAllMachines(): Promise<void> {
    await this.prisma.parkedMachine.deleteMany({});
  }

  // REMOVED: findMany() - use getAllMachines() or specific queries instead
}
