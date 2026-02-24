import { PrismaClient, type MachineReservationQueue } from '../../../generated/prisma';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['db', 'machine-reservation-queue']);

export class MachineReservationQueueRepository {
  constructor(private prisma: PrismaClient) {}

  async createReservation(agentId: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.prisma.machineReservationQueue.create({
      data: {
        id,
        agentId,
        status: 'queued',
        requestedAt: new Date()
      }
    });
    logger.info`Created reservation ${id} for agent ${agentId}`;
    return id;
  }

  async getReservation(id: string): Promise<MachineReservationQueue | null> {
    return await this.prisma.machineReservationQueue.findUnique({
      where: { id }
    });
  }

  async getReservationByAgentId(agentId: string): Promise<MachineReservationQueue | null> {
    return await this.prisma.machineReservationQueue.findUnique({
      where: { agentId }
    });
  }

  async getQueuePosition(id: string): Promise<number> {
    const reservation = await this.getReservation(id);
    if (!reservation) return -1;

    return await this.prisma.machineReservationQueue.count({
      where: {
        status: 'queued',
        requestedAt: { lte: reservation.requestedAt }
      }
    });
  }

  async markAssigned(id: string, machineId: string, ipv4: string, url: string | null, desktopUrl: string | null, sharedKey: string, streamingToken: string | null, streamingHostId: string | null, streamingAppId: string | null): Promise<void> {
    await this.prisma.machineReservationQueue.update({
      where: { id },
      data: {
        status: 'assigned',
        assignedMachineId: machineId,
        assignedIpv4: ipv4,
        assignedUrl: url,
        assignedDesktopUrl: desktopUrl,
        assignedStreamingToken: streamingToken,
        assignedStreamingHostId: streamingHostId,
        assignedStreamingAppId: streamingAppId,
        assignedSharedKey: sharedKey
      }
    });
    logger.info`[DESKTOP_URL_TRACE] markAssigned reservation ${id}: desktopUrl=${desktopUrl || 'null'}, streamingToken=${streamingToken ? 'yes' : 'null'}, hostId=${streamingHostId || 'null'}, appId=${streamingAppId || 'null'}`;
    logger.info`Marked reservation ${id} as assigned to machine ${machineId} (URL: ${url || 'none'})`;
  }

  async markFulfilled(id: string): Promise<void> {
    await this.prisma.machineReservationQueue.update({
      where: { id },
      data: { status: 'fulfilled' }
    });
    logger.info`Marked reservation ${id} as fulfilled`;
  }

  async deleteReservation(agentId: string): Promise<void> {
    await this.prisma.machineReservationQueue.deleteMany({
      where: { agentId }
    });
    logger.info`Deleted reservation(s) for agent ${agentId}`;
  }

  async countQueuedReservations(): Promise<number> {
    return await this.prisma.machineReservationQueue.count({
      where: { status: 'queued' }
    });
  }
}
