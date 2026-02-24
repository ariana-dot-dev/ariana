import { getLogger } from '../utils/logger';
import { RepositoryContainer } from '../data/repositories';
import type { MachinePoolService } from './machinePool.service';

const logger = getLogger(['machine-reservation-queue']);

export class MachineReservationQueueService {
  constructor(
    private repositories: RepositoryContainer,
    private machinePoolService: MachinePoolService
  ) {}

  /**
   * Process queue: match ready machines to queued reservations
   * Runs on worker 0 every 2 seconds
   * Returns number of assignments made
   */
  async processQueue(): Promise<number> {
    let assignmentsCount = 0;

    // Process ONE reservation at a time to avoid race conditions
    // The while loop continues until no more matches are possible
    while (true) {
      const assignment = await this.repositories.prisma.$transaction(async (tx) => {
        // Find oldest queued reservation
        const reservation = await tx.machineReservationQueue.findFirst({
          where: { status: 'queued' },
          orderBy: { requestedAt: 'asc' } // FIFO!
        });

        if (!reservation) {
          logger.debug('No queued reservations found');
          return null; // No queued reservations
        }

        // Check if agent is trashed
        const agent = await tx.agent.findUnique({
          where: { id: reservation.agentId },
          select: { isTrashed: true }
        });

        if (!agent || agent.isTrashed) {
          logger.debug`Reservation ${reservation.id} is for trashed agent ${reservation.agentId}, deleting...`;
          // Delete this reservation and try next one
          await tx.machineReservationQueue.delete({
            where: { id: reservation.id }
          });
          return null;
        }

        logger.debug`Found queued reservation ${reservation.id} for agent ${reservation.agentId}`;

        // Find oldest ready machine (must have sharedKey - server already running)
        const machine = await tx.parkedMachine.findFirst({
          where: { status: 'ready' },
          orderBy: { createdAt: 'asc' } // FIFO for machines too
        });

        if (!machine || !machine.machineId || !machine.ipv4 || !machine.sharedKey) {
          logger.debug('No ready machines available (need machineId, ipv4, and sharedKey)');
          return null; // No ready machines
        }

        logger.debug`Found ready machine ${machine.machineId} (${machine.ipv4}) URL: ${machine.url || 'none'}`;
        logger.info`[DESKTOP_URL_TRACE] ParkedMachine from DB: desktopUrl=${machine.desktopUrl || 'null'}, streamingToken=${machine.streamingToken ? 'yes' : 'null'}, hostId=${machine.streamingHostId || 'null'}, appId=${machine.streamingAppId || 'null'}`;


        // Atomic assignment: mark BOTH machine as claimed AND reservation as processing
        // This prevents the next loop iteration from picking up the same reservation
        await tx.parkedMachine.update({
          where: { id: machine.id },
          data: {
            status: 'claimed',
            claimedAt: new Date(),
            claimedByAgentId: reservation.agentId
          }
        });

        await tx.machineReservationQueue.update({
          where: { id: reservation.id },
          data: { status: 'processing' }
        });

        // Return both for processing outside transaction
        return { reservation, machine };
      });

      if (!assignment) {
        break; // No more matches possible
      }

      assignmentsCount++;
      logger.info`Processing assignment: machine ${assignment.machine.machineId} -> agent ${assignment.reservation.agentId}`;

      // Server is already running from parking phase - just use the stored sharedKey
      const sharedKey = assignment.machine.sharedKey!;

      // Mark reservation as assigned with machine details
      await this.repositories.machineReservationQueue.markAssigned(
        assignment.reservation.id,
        assignment.machine.machineId!,
        assignment.machine.ipv4!,
        assignment.machine.url || null,
        assignment.machine.desktopUrl || null,
        sharedKey,
        assignment.machine.streamingToken || null,
        assignment.machine.streamingHostId || null,
        assignment.machine.streamingAppId || null
      );

      // Remove machine from pool
      await this.repositories.parkedMachines.deleteMachine(assignment.machine.machineId!);

      logger.info`[DESKTOP_URL_TRACE] markAssigned called with desktopUrl=${assignment.machine.desktopUrl || 'null'}, streamingToken=${assignment.machine.streamingToken ? 'yes' : 'null'}`;
      logger.info`Assigned machine ${assignment.machine.machineId} to agent ${assignment.reservation.agentId} (server already running)`;

      // Trigger pool repopulation
      this.machinePoolService.populateParkedMachines().catch(error => {
        logger.error`Failed to repopulate parked machines: ${error}`;
      });
    }

    return assignmentsCount;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    queuedCount: number;
    readyMachines: number;
  }> {
    const queuedCount = await this.repositories.machineReservationQueue.countQueuedReservations();
    const readyMachines = await this.repositories.parkedMachines.countByStatus('ready');

    return { queuedCount, readyMachines };
  }
}
