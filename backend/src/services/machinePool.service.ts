import { getLogger } from '../utils/logger';
import { RepositoryContainer } from '../data/repositories';
import { machineSDK } from '../../agents-server/src/machineSDK';

const logger = getLogger(['machinePool']);

const PARKED_MACHINES_TARGET = parseInt(process.env.PARKED_MACHINES_TARGET || '2', 10);
const MAX_CONCURRENT_LAUNCHES = parseInt(process.env.MAX_CONCURRENT_LAUNCHES || '3', 10); // Limit concurrent machine creations
const LAUNCH_DELAY_MS = parseInt(process.env.LAUNCH_DELAY_MS || '2000', 10); // Delay between batches

export interface ParkingMetrics {
  totalAttempts: number;
  successfulParks: number;
  failedParks: number;
  lastFailureTime: Date | null;
  lastFailureReason: string | null;
  currentPoolSize: number;
  poolTarget: number;
}

export interface MachineResult {
  machine: {
    id: string;
    name: string;
    state: string;
    region: string;
    private_ip: string;
    created_at: string;
    updated_at: string;
    instance_id: string;
  };
  agentServerUrl: string;
  sharedKey: string;
}

export class MachinePoolService {
  private repositories: RepositoryContainer;
  private isPopulatingParkedMachines = false;

  // Semaphore for limiting concurrent machine creations
  private activeMachineCreations = 0;
  private machineCreationQueue: Array<() => void> = [];

  // Metrics tracking
  private parkingMetrics: ParkingMetrics = {
    totalAttempts: 0,
    successfulParks: 0,
    failedParks: 0,
    lastFailureTime: null,
    lastFailureReason: null,
    currentPoolSize: 0,
    poolTarget: PARKED_MACHINES_TARGET
  };

  constructor(repositories: RepositoryContainer) {
    this.repositories = repositories;
  }

  // Semaphore implementation for rate limiting
  private async acquireCreationSlot(): Promise<void> {
    if (this.activeMachineCreations < MAX_CONCURRENT_LAUNCHES) {
      this.activeMachineCreations++;
      return Promise.resolve();
    }

    // Wait in queue
    return new Promise(resolve => {
      this.machineCreationQueue.push(resolve);
    });
  }

  private releaseCreationSlot(): void {
    this.activeMachineCreations--;

    // Process queue
    if (this.machineCreationQueue.length > 0) {
      const next = this.machineCreationQueue.shift();
      if (next) {
        this.activeMachineCreations++;
        next();
      }
    }
  }

  // REMOVED: waitMachineLaunch() - no longer needed with queue system

  async getParkingMetrics(): Promise<ParkingMetrics> {
    // Update current pool size from DB before returning
    const count = await this.repositories.parkedMachines.countByStatus('ready');
    this.parkingMetrics.currentPoolSize = count;
    return { ...this.parkingMetrics };
  }

  async getActiveMachineCount(): Promise<number> {
    const parkedReady = await this.repositories.parkedMachines.countByStatus('ready');
    const parkedLaunching = await this.repositories.parkedMachines.countByStatus('launching');
    const parkedClaimed = await this.repositories.parkedMachines.countByStatus('claimed');
    const activeAgents = await this.repositories.agents.countActiveAgents();

    const total = parkedReady + parkedLaunching + parkedClaimed + activeAgents;

    logger.debug`Active machines: ${parkedReady} ready + ${parkedLaunching} launching + ${parkedClaimed} claimed + ${activeAgents} agents = ${total} total`;

    return total;
  }


  async populateParkedMachines(): Promise<void> {
    // Queue check to prevent concurrent runs
    if (this.isPopulatingParkedMachines) {
      logger.debug`Already populating parked machines, skipping`;
      return;
    }

    this.isPopulatingParkedMachines = true;
    try {
      const currentCount = await this.repositories.parkedMachines.countByStatus('ready');
      const launchingCount = await this.repositories.parkedMachines.countByStatus('launching');

      // Count both ready and launching towards our target
      const totalInProgress = currentCount + launchingCount;

      if (totalInProgress < PARKED_MACHINES_TARGET) {
        const toCreate = PARKED_MACHINES_TARGET - totalInProgress;
        logger.info`Populating parked machines: need ${toCreate}, currently have ${currentCount} ready + ${launchingCount} launching`;

        // Launch machines in batches to avoid rate limiting
        await this.launchMachinesInBatches(toCreate);
      } else {
        logger.debug`Parked machines sufficient: have ${currentCount} ready + ${launchingCount} launching, target ${PARKED_MACHINES_TARGET}`;
      }
    } finally {
      this.isPopulatingParkedMachines = false;
    }
  }

  private async launchMachinesInBatches(count: number): Promise<void> {
    const batches = Math.ceil(count / MAX_CONCURRENT_LAUNCHES);

    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      const batchStart = batchIndex * MAX_CONCURRENT_LAUNCHES;
      const batchSize = Math.min(MAX_CONCURRENT_LAUNCHES, count - batchStart);

      logger.info`Launching batch ${batchIndex + 1}/${batches}: ${batchSize} machines`;

      // Create DB records for this batch (makes them visible as "launching")
      const parkingPromises = [];
      for (let i = 0; i < batchSize; i++) {
        parkingPromises.push(this.parkMachineAndWaitForRecord());
      }

      // Wait for this batch's DB records to be created
      await Promise.all(parkingPromises);

      // Add delay before next batch (except after the last batch)
      if (batchIndex < batches - 1) {
        logger.info`Waiting ${LAUNCH_DELAY_MS}ms before next batch...`;
        await new Promise(resolve => setTimeout(resolve, LAUNCH_DELAY_MS));
      }
    }
  }

  private async parkMachineAndWaitForRecord(): Promise<void> {
    // Start the machine creation but only wait for the DB record to be created
    // This makes the machine visible in the pool immediately
    const dbRecordPromise = this.repositories.parkedMachines.createParkedMachine({
      machineId: null,
      machineName: null,
      ipv4: null,
      status: 'launching'
    });

    const dbRecord = await dbRecordPromise;
    logger.info`Created DB record ${dbRecord.id} for launching machine`;

    // Now continue with machine creation in the background (don't await)
    this.finishParkingMachine(dbRecord.id).catch(error => {
      logger.error`Error finishing machine parking for ${dbRecord.id}: ${error instanceof Error ? error.message : String(error)}`;
    });
  }

  private async finishParkingMachine(dbRecordId: string): Promise<void> {
    // Track attempt
    this.parkingMetrics.totalAttempts++;

    // Acquire a slot in the semaphore to limit concurrent API calls
    await this.acquireCreationSlot();

    let createdMachineName: string | null = null;
    try {
      const machine = await machineSDK.createMachine();

      if (machine) {
        createdMachineName = machine.name;

        // Warm cert-gateway routes in parallel before marking the machine as ready.
        // Both subdomains use on-demand TLS (Caddy/ACME), so the first HTTPS request
        // triggers certificate provisioning (~10-25s). By doing it here during parking,
        // certs are already cached when an agent claims this machine.
        await Promise.all([
          // Warm desktop URL TLS cert
          machine.desktopUrl ? (async () => {
            try {
              const certStart = Date.now();
              await fetch(machine.desktopUrl!, { method: 'HEAD', signal: AbortSignal.timeout(60000) });
              logger.info`TLS cert warmed for ${machine.desktopUrl} (${Date.now() - certStart}ms)`;
            } catch (e) {
              logger.warn`TLS cert warm failed for ${machine.desktopUrl}: ${e instanceof Error ? e.message : e}`;
            }
          })() : Promise.resolve(),

          // Warm agent-server URL through cert-gateway (verify /health responds via HTTPS)
          // Without this, the first health check after assignment takes ~23s of retries.
          // If this fails after all attempts, the machine should NOT be marked as ready
          // since agents won't be able to reach it via HTTPS either.
          machine.url ? (async () => {
            const start = Date.now();
            for (let i = 1; i <= 30; i++) {
              try {
                const res = await fetch(`${machine.url}/health`, { signal: AbortSignal.timeout(5000) });
                if (res.ok) {
                  logger.info`Agent-server URL health verified for ${machine.url} (${Date.now() - start}ms, attempt ${i})`;
                  return;
                }
              } catch {}
              if (i < 30) await new Promise(r => setTimeout(r, 1000));
            }
            throw new Error(`Agent-server URL health check failed after 30 attempts for ${machine.url}`);
          })() : Promise.resolve(),
        ]);

        // Update the placeholder record IN PLACE with actual machine info
        // URL comes from create.sh script, sharedKey is pre-generated during createMachine
        await this.repositories.parkedMachines.updateMachineInfo(dbRecordId, {
          machineId: machine.name,
          machineName: machine.name,
          ipv4: machine.ipv4,
          url: machine.url,
          desktopUrl: machine.desktopUrl,
          streamingToken: machine.streamingToken,
          streamingHostId: machine.streamingHostId,
          streamingAppId: machine.streamingAppId,
          sharedKey: machine.sharedKey,
          status: 'ready'
        });

        logger.info`[DESKTOP_URL_TRACE] Storing to ParkedMachine: desktopUrl=${machine.desktopUrl || 'null'}, streamingToken=${!!machine.streamingToken}, hostId=${machine.streamingHostId || 'null'}, appId=${machine.streamingAppId || 'null'}`;
        logger.info`Parked machine ready: ${machine.name} (${machine.ipv4}) URL: ${machine.url || 'none'}`;

        // Track success
        this.parkingMetrics.successfulParks++;
        const count = await this.repositories.parkedMachines.countByStatus('ready');
        this.parkingMetrics.currentPoolSize = count;
      } else {
        // Delete the failed record
        await this.repositories.parkedMachines.deleteById(dbRecordId);

        // Track failure
        this.parkingMetrics.failedParks++;
        this.parkingMetrics.lastFailureTime = new Date();
        this.parkingMetrics.lastFailureReason = 'Machine creation returned null';
        const count = await this.repositories.parkedMachines.countByStatus('ready');
        this.parkingMetrics.currentPoolSize = count;

        logger.error`Failed to park machine: creation returned null`;
      }
    } catch (error) {
      // Delete the failed DB record
      try {
        await this.repositories.parkedMachines.deleteById(dbRecordId);
      } catch (deleteError) {
        logger.warn`Failed to delete DB record ${dbRecordId}: ${deleteError}`;
      }

      // Destroy the Hetzner machine if it was created (prevents orphaned machines)
      if (createdMachineName) {
        try {
          logger.info`Destroying failed machine ${createdMachineName} after parking failure`;
          await machineSDK.deleteMachine(createdMachineName);
        } catch (deleteError) {
          logger.warn`Failed to destroy Hetzner machine ${createdMachineName}: ${deleteError}`;
        }
      }

      // Track failure
      this.parkingMetrics.failedParks++;
      this.parkingMetrics.lastFailureTime = new Date();
      this.parkingMetrics.lastFailureReason = error instanceof Error ? error.message : String(error);
      const count = await this.repositories.parkedMachines.countByStatus('ready');
      this.parkingMetrics.currentPoolSize = count;

      logger.error`Failed to park machine: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      // Always release the semaphore slot
      this.releaseCreationSlot();
    }
  }

  async startupProcedure(): Promise<void> {
    logger.info`Starting MachinePoolService startup procedure`;

    try {
      // Step 1: Ensure SSH key exists
      logger.info`Setting up SSH key...`;
      await machineSDK.ensureSSHKey();

      // Step 2: Reset interrupted machine reservations
      // 'processing' reservations were interrupted mid-assignment, reset them to 'queued'
      // Note: PROVISIONING agents will have their polling loops restarted by ClaudeAgentService
      logger.info`Resetting interrupted machine reservations...`;
      await this.resetInterruptedReservations();

      // Step 3: Clean up stuck PROVISIONED agents (from interrupted uploads)
      logger.info`Cleaning up stuck PROVISIONED agents...`;
      await this.cleanupStuckProvisionedAgents();

      // Step 4: Clean up all existing machines
      if (process.env.NODE_ENV === 'development') {
        logger.info`DEVELOPMENT: Cleaning up existing machines...`;
        await this.cleanupAllMachines();
      }

      // Step 5: Clean up stuck "launching" machines from previous server runs
      // These machines will NEVER become ready because their background processes died
      logger.info`Cleaning up stuck launching machines...`;
      await this.cleanupStuckLaunchingMachines();

      // Step 6: Populate parked machines
      logger.info`Populating parked machines...`;
      await this.populateParkedMachines();

      logger.info`MachinePoolService startup procedure completed successfully`;
    } catch (error) {
      logger.error`Startup procedure failed: ${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }

  private async resetInterruptedReservations(): Promise<void> {
    try {
      // 1. Delete reservations for trashed agents
      // First find all trashed agents with reservations
      const trashedAgents = await this.repositories.prisma.agent.findMany({
        where: { isTrashed: true },
        select: { id: true }
      });

      if (trashedAgents.length > 0) {
        const trashedResult = await this.repositories.prisma.machineReservationQueue.deleteMany({
          where: {
            agentId: {
              in: trashedAgents.map(a => a.id)
            }
          }
        });

        if (trashedResult.count > 0) {
          logger.info`Deleted ${trashedResult.count} reservation(s) for trashed agents`;
        }
      }

      // 2. Reset 'processing' reservations back to 'queued'
      // These were interrupted during machine assignment (mid-launch)
      // 'queued' reservations are fine and don't need any action
      const result = await this.repositories.prisma.machineReservationQueue.updateMany({
        where: {
          status: 'processing'
        },
        data: {
          status: 'queued'
        }
      });

      if (result.count > 0) {
        logger.info`Reset ${result.count} interrupted reservation(s) back to queued`;
      }
    } catch (error) {
      logger.error`Failed to reset interrupted reservations: ${error}`;
      // Don't throw - this shouldn't block startup
    }
  }

  private async cleanupStuckProvisionedAgents(): Promise<void> {
    try {
      const agents = await this.repositories.agents.getAllAgents();
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      let cleanedCount = 0;

      for (const agent of agents) {
        // Check if agent is stuck in PROVISIONED state
        if (agent.state === 'provisioned' && agent.provisionedAt) {
          // If provisioned more than 10 minutes ago, it's likely stuck
          if (agent.provisionedAt < tenMinutesAgo) {
            logger.warn`Found stuck agent ${agent.id} in PROVISIONED state since ${agent.provisionedAt}`;

            // Delete the machine if it exists
            if (agent.machineId) {
              try {
                await machineSDK.deleteMachine(agent.machineId);
                logger.info`Deleted machine ${agent.machineId} for stuck agent ${agent.id}`;
              } catch (error) {
                logger.warn`Failed to delete machine ${agent.machineId}: ${error}`;
              }
            }

            // Mark agent as ERROR
            await this.repositories.agents.updateAgentFields(agent.id, {
              state: 'error',
              machineId: null
            });

            cleanedCount++;
            logger.info`Marked stuck agent ${agent.id} as ERROR`;
          }
        }
      }

      if (cleanedCount > 0) {
        logger.info`Cleaned up ${cleanedCount} stuck PROVISIONED agent(s)`;
      }
    } catch (error) {
      logger.error`Failed to cleanup stuck PROVISIONED agents: ${error}`;
      // Don't throw - this shouldn't block startup
    }
  }

  private async cleanupStuckLaunchingMachines(): Promise<void> {
    // On server restart, any machines in "launching" state are orphaned
    // Their background finishParkingMachine() tasks died with the old server process
    // These machines will NEVER become ready, so we must delete them
    try {
      const launchingMachines = await this.repositories.prisma.parkedMachine.findMany({
        where: { status: 'launching' }
      });

      if (launchingMachines.length === 0) {
        return;
      }

      logger.warn`Found ${launchingMachines.length} stuck launching machine(s) from previous server run - deleting`;

      for (const machine of launchingMachines) {
        try {
          // If the machine was partially created in Hetzner, delete it
          if (machine.machineId) {
            try {
              await machineSDK.deleteMachine(machine.machineId);
              logger.info`Deleted Hetzner machine ${machine.machineId} for stuck launching record`;
            } catch (hetznerError) {
              // Machine might not exist in Hetzner, that's OK
              logger.debug`Could not delete Hetzner machine ${machine.machineId}: ${hetznerError}`;
            }
          }

          // Delete the DB record
          await this.repositories.parkedMachines.deleteById(machine.id);
          logger.info`Deleted stuck launching machine record ${machine.id}`;
        } catch (error) {
          logger.error`Failed to cleanup stuck launching machine ${machine.id}: ${error}`;
        }
      }

      logger.info`Cleaned up ${launchingMachines.length} stuck launching machine(s)`;
    } catch (error) {
      logger.error`Failed to cleanup stuck launching machines: ${error}`;
      // Don't throw - this shouldn't block startup
    }
  }

  // REMOVED: getNewMachine() - now handled by queue-based reservation system
  // See MachineReservationQueueService.processQueue() for the new implementation

  async cleanupAllMachines(): Promise<void> {
    const workerId = process.env.WORKER_ID || '0';

    // Only run on worker 0 to avoid duplicate deletions
    if (workerId !== '0') {
      logger.debug`Worker ${workerId}: Skipping machine cleanup (only worker 0 runs it)`;
      return;
    }

    logger.debug`Cleaning up all existing machines from pool...`;
    try {
      // In DEV mode, the database might be reset, so we need to delete ALL machines from Hetzner
      // not just the ones in the database. This ensures clean startup.
      logger.info`Deleting all machines from Hetzner (not just DB records)...`;
      await machineSDK.deleteAllMachines();

      // Clean up database records (in case DB wasn't reset)
      await this.repositories.parkedMachines.deleteAllMachines();

      logger.debug`Machine pool cleanup completed`;
    } catch (error) {
      logger.error`Failed to cleanup machine pool: ${error}`;
      throw error;
    }
  }

  async deleteMachine(machineId: string): Promise<void> {
    // delete-machine.sh handles unregistering from cert-gateway
    await machineSDK.deleteMachine(machineId);
  }

  async getMachineInfo(machineId: string): Promise<{ ipv4: string } | null> {
    // Machine info is now stored in the Agent table, not in machineSDK
    // This method shouldn't be called anymore but kept for compatibility
    // The ipv4 should be retrieved directly from the agent record
    return null;
  }
}
