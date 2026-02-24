import { getLogger } from '../utils/logger';
import type { DashboardSnapshotService } from './dashboardSnapshot.service';
import type { MachineSnapshotService } from './machineSnapshot.service';

const logger = getLogger(['scheduled-jobs']);

export class ScheduledJobsService {
  private lastSnapshotDate: string | null = null;
  private lastMachineSnapshotCleanup: string | null = null;

  constructor(
    private dashboardSnapshot: DashboardSnapshotService,
    private machineSnapshots: MachineSnapshotService
  ) {
    this.startScheduledJobs();
  }

  /**
   * Start all scheduled jobs
   * Only runs on worker 0 to prevent duplicate operations
   */
  private startScheduledJobs(): void {
    const workerId = process.env.WORKER_ID || '0';

    // Only run scheduled jobs on worker 0 to prevent duplicate operations
    if (workerId !== '0') {
      logger.info(`Worker ${workerId}: Skipping scheduled jobs (only worker 0 runs them)`);
      return;
    }

    logger.info(`Worker ${workerId}: Starting scheduled jobs`);

    // Daily dashboard snapshot capture
    // Check every hour if we need to capture today's snapshot
    this.startDailySnapshotJob();

    // Machine snapshot cleanup - run daily
    this.startMachineSnapshotCleanupJob();
  }

  /**
   * Start the daily snapshot job
   * Checks every hour if a snapshot needs to be captured for today
   */
  private startDailySnapshotJob(): void {
    const HOUR_IN_MS = 60 * 60 * 1000;

    // Run immediately on startup
    this.checkAndCaptureSnapshot();

    // Then check every hour
    setInterval(async () => {
      await this.checkAndCaptureSnapshot();
    }, HOUR_IN_MS);

    logger.info('Daily snapshot job started (checks every hour)');
  }

  /**
   * Check if we need to capture a snapshot and do so if needed
   */
  private async checkAndCaptureSnapshot(): Promise<void> {
    try {
      const today = new Date();
      const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD

      // Skip if we already captured today
      if (this.lastSnapshotDate === todayString) {
        logger.debug(`Snapshot already captured for ${todayString}, skipping`);
        return;
      }

      // Check if snapshot exists in database
      const hasSnapshot = await this.dashboardSnapshot
        .getSnapshotsByDateRange(
          new Date(todayString + 'T00:00:00Z'),
          new Date(todayString + 'T23:59:59Z')
        )
        .then(snapshots => snapshots.length > 0);

      if (hasSnapshot) {
        logger.info(`Snapshot already exists for ${todayString}, skipping`);
        this.lastSnapshotDate = todayString;
        return;
      }

      logger.info(`Capturing dashboard snapshot for ${todayString}...`);
      await this.dashboardSnapshot.captureSnapshot();
      this.lastSnapshotDate = todayString;
      logger.info(`Dashboard snapshot captured successfully for ${todayString}`);
    } catch (error) {
      logger.error('Failed to capture dashboard snapshot', { error });
    }
  }

  /**
   * Manually trigger a snapshot capture (for testing or manual runs)
   */
  async captureSnapshotNow(): Promise<void> {
    logger.info('Manual snapshot capture triggered');
    await this.dashboardSnapshot.captureSnapshot();
  }

  /**
   * Cleanup old dashboard snapshots
   * Can be called manually or scheduled
   */
  async cleanupOldSnapshots(retentionDays: number = 365): Promise<void> {
    logger.info(`Starting cleanup of dashboard snapshots older than ${retentionDays} days`);
    const deletedCount = await this.dashboardSnapshot.cleanupOldSnapshots(retentionDays);
    logger.info(`Cleanup completed: deleted ${deletedCount} old dashboard snapshots`);
  }

  /**
   * Start the machine snapshot cleanup job
   * Runs daily to delete expired machine snapshots from R2
   */
  private startMachineSnapshotCleanupJob(): void {
    const HOUR_IN_MS = 60 * 60 * 1000;

    // Run immediately on startup
    this.checkAndCleanupMachineSnapshots();

    // Then check every hour
    setInterval(async () => {
      await this.checkAndCleanupMachineSnapshots();
    }, HOUR_IN_MS);

    logger.info('Machine snapshot cleanup job started (checks every hour)');
  }

  /**
   * Check if we need to run machine snapshot cleanup and do so if needed
   */
  private async checkAndCleanupMachineSnapshots(): Promise<void> {
    try {
      const today = new Date();
      const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD

      // Only run cleanup once per day
      if (this.lastMachineSnapshotCleanup === todayString) {
        return;
      }

      logger.info(`Running machine snapshot cleanup for ${todayString}...`);
      const result = await this.machineSnapshots.cleanupExpiredSnapshots();
      this.lastMachineSnapshotCleanup = todayString;

      if (result.deleted > 0) {
        logger.info(`Machine snapshot cleanup completed: deleted ${result.deleted} expired snapshot(s)`);
      }
    } catch (error) {
      logger.error('Failed to cleanup machine snapshots', { error });
    }
  }

  /**
   * Manually trigger machine snapshot cleanup
   */
  async cleanupMachineSnapshotsNow(): Promise<{ deleted: number }> {
    logger.info('Manual machine snapshot cleanup triggered');
    return await this.machineSnapshots.cleanupExpiredSnapshots();
  }
}
