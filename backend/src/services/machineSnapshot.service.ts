import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { RepositoryContainer } from '@/data/repositories';
import type { MachineSnapshot, MachineSnapshotLock } from '../../generated/prisma';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['snapshot']);

const MAX_RETRIES = 10;
const LOCK_STALE_MS = 15 * 60 * 1000; // 15 minutes

// Errors that indicate the machine is gone — retrying is pointless
const NON_RETRYABLE_PATTERNS = [
  'Machine info not found',
  'Machine not found',
];

export type SendToAgentServerFn = (machineId: string, endpoint: string, body?: any, timeoutMs?: number) => Promise<Response>;

/**
 * Snapshot State Machine
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                         MACHINE                                 │
 * │                                                                 │
 * │   ┌──────────┐     ┌──────────────────────────────────────┐    │
 * │   │  QUEUED  │     │           LOCKED (in_progress)       │    │
 * │   │  (0 or 1 │     │                                      │    │
 * │   │ snapshot)│     │  snapshot running                    │    │
 * │   └────┬─────┘     │  ├─ attempt 1 → fail → retry        │    │
 * │        │           │  ├─ attempt 2 → fail → retry        │    │
 * │        │           │  ├─ ...                              │    │
 * │        │           │  └─ attempt 10 → fail → GIVE UP     │    │
 * │        │           │                    OR                │    │
 * │        │           │       any attempt → success → DONE  │    │
 * │        │           └──────────────────────────────────────┘    │
 * │        │                         │                              │
 * │        │                         │ lock released                │
 * │        │                         ▼                              │
 * │        └──────► gets promoted ───┘                              │
 * │                                                                 │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Trigger Logic:
 * When triggerSnapshot(machineId, priority) is called:
 *
 * Is machine locked (snapshot in progress)?
 * ├─ YES:
 * │   └─ Is new snapshot priority (pre-archival)?
 * │       ├─ YES: Cancel current → Start new one immediately (acquires lock)
 * │       └─ NO:
 * │           └─ Queue it (replaces any existing queued item)
 * │
 * └─ NO (not locked):
 *     └─ Start snapshot immediately (acquires lock)
 */
export class MachineSnapshotService {
  private s3Client: S3Client;
  private bucketName: string;
  private sendToAgentServer: SendToAgentServerFn;

  constructor(
    private repositoryContainer: RepositoryContainer,
    sendToAgentServer: SendToAgentServerFn
  ) {
    this.bucketName = process.env.R2_BUCKET_NAME || 'ariana-snapshots';
    this.s3Client = this.createR2Client();
    this.sendToAgentServer = sendToAgentServer;
  }

  private createR2Client(): S3Client {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error('R2 credentials not configured: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY required');
    }

    return new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey }
    });
  }

  // ============================================================
  // PUBLIC API - Main entry points
  // ============================================================

  /**
   * Trigger a snapshot for a machine (fire-and-forget).
   * Used by cron for periodic snapshots.
   *
   * - No lock? Start + execute in background
   * - Lock exists? Queue it (will run when current finishes)
   */
  async triggerSnapshot(machineId: string): Promise<void> {
    const lock = await this.repositoryContainer.machineSnapshots.getLock(machineId);

    if (lock) {
      logger.info`[TRIGGER] machineId=${machineId} state=LOCKED lockSnapshotId=${lock.snapshotId} action=QUEUE`;
      await this.repositoryContainer.machineSnapshots.setQueuedItem(machineId, false);
    } else {
      logger.info`[TRIGGER] machineId=${machineId} state=IDLE action=START`;
      const snapshot = await this.startSnapshot(machineId);
      if (snapshot) {
        logger.info`[TRIGGER] machineId=${machineId} snapshotId=${snapshot.id} action=EXECUTE_ASYNC`;
        this.processSnapshotAttempt(machineId, snapshot).catch(err =>
          logger.error`[TRIGGER] machineId=${machineId} error=${err}`
        );
      }
    }
  }

  /**
   * Create a snapshot and wait for completion (blocking).
   * Used before archival - must complete before machine is deleted.
   * Retries lock acquisition to handle race conditions with periodic snapshots.
   */
  async createSnapshotNow(machineId: string): Promise<void> {
    const MAX_LOCK_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_LOCK_ATTEMPTS; attempt++) {
      // Cancel any in-progress snapshot
      const lock = await this.repositoryContainer.machineSnapshots.getLock(machineId);
      if (lock) {
        logger.info`[PRIORITY] machineId=${machineId} attempt=${attempt} action=CANCEL_EXISTING lockSnapshotId=${lock.snapshotId}`;
        await this.cancelCurrentSnapshot(machineId, lock);
      }

      // Start and execute synchronously
      const snapshot = await this.startSnapshot(machineId);
      if (snapshot) {
        await this.processSnapshotWithRetries(machineId, snapshot);
        return;
      }

      // Lock acquisition failed (race condition), retry
      if (attempt < MAX_LOCK_ATTEMPTS) {
        logger.warn`[PRIORITY] machineId=${machineId} attempt=${attempt} status=LOCK_RACE retrying`;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    throw new Error(`Failed to create snapshot - could not acquire lock after ${MAX_LOCK_ATTEMPTS} attempts`);
  }

  /**
   * Process queued snapshots and handle stale locks.
   * Called periodically by the cron job.
   */
  async processQueue(): Promise<void> {
    // Step 1: Clean up stale locks (stuck > 15 min)
    await this.cleanupStaleLocks();

    // Step 2: Process scheduled deletions
    const { deleted } = await this.processScheduledDeletions();
    if (deleted > 0) {
      logger.info`[QUEUE] Deleted ${deleted} scheduled snapshot(s)`;
    }

    // Step 3: Safety net - promote any orphaned queued items (rare)
    const queuedItems = await this.repositoryContainer.machineSnapshots.getQueuedMachinesWithoutLock();
    for (const item of queuedItems) {
      logger.info`[QUEUE] Promoting orphaned snapshot for ${item.machineId}`;
      await this.repositoryContainer.machineSnapshots.removeQueuedItem(item.machineId);
      const snapshot = await this.startSnapshot(item.machineId);
      if (snapshot) {
        this.processSnapshotAttempt(item.machineId, snapshot).catch(err =>
          logger.error`[QUEUE] Snapshot failed for ${item.machineId}: ${err}`
        );
      }
    }
  }

  // ============================================================
  // SNAPSHOT PROCESSING
  // ============================================================

  /**
   * Start a new snapshot: create record and acquire lock.
   */
  private async startSnapshot(machineId: string): Promise<MachineSnapshot | null> {
    logger.info`[START] machineId=${machineId} action=CREATE_RECORD`;
    const snapshot = await this.repositoryContainer.machineSnapshots.create(machineId, 'in_progress', false);

    logger.info`[START] snapshotId=${snapshot.id} action=ACQUIRE_LOCK`;
    const lock = await this.repositoryContainer.machineSnapshots.tryAcquireLock(machineId, snapshot.id);
    if (!lock) {
      logger.warn`[START] snapshotId=${snapshot.id} status=LOCK_FAILED (race condition)`;
      await this.repositoryContainer.machineSnapshots.updateStatus(snapshot.id, 'failed', {
        error: 'Failed to acquire lock - another snapshot started'
      });
      return null;
    }

    logger.info`[START] snapshotId=${snapshot.id} status=LOCK_ACQUIRED`;
    return snapshot;
  }

  /**
   * Process a snapshot with retries (blocking, used for createSnapshotNow).
   */
  private async processSnapshotWithRetries(machineId: string, snapshot: MachineSnapshot): Promise<void> {
    let lastError: string = 'Unknown error';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      // Use warn level so retry attempts are visible even with LOG_LEVEL=error
      logger.warn`[PROCESS] Attempt ${attempt}/${MAX_RETRIES} for snapshot ${snapshot.id}`;

      try {
        const success = await this.executeSnapshotRequest(machineId, snapshot);
        if (success) {
          // Success! Release lock and return
          await this.repositoryContainer.machineSnapshots.releaseLock(machineId);
          await this.promoteQueuedIfExists(machineId);
          return;
        }
        lastError = 'Snapshot request returned failure';
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logger.error`[PROCESS] Attempt ${attempt} failed: ${lastError}`;

        // Bail immediately on non-retryable errors (machine gone, archived, etc.)
        if (NON_RETRYABLE_PATTERNS.some(p => lastError.includes(p))) {
          logger.warn`[PROCESS] snapshotId=${snapshot.id} status=NON_RETRYABLE error=${lastError}`;
          break;
        }
      }

      // Update retry count - wrap in try-catch to not break retry loop on DB errors
      try {
        await this.repositoryContainer.machineSnapshots.incrementRetryCount(snapshot.id);
        await this.repositoryContainer.machineSnapshots.updateLockRetryCount(machineId, attempt);
      } catch (dbError) {
        const dbErrorMsg = dbError instanceof Error ? dbError.message : String(dbError);
        logger.error`[PROCESS] Failed to update retry count (continuing anyway): ${dbErrorMsg}`;
      }

      // Small delay before retry
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // All retries exhausted
    try {
      await this.repositoryContainer.machineSnapshots.updateStatus(snapshot.id, 'failed', {
        error: `Failed after ${MAX_RETRIES} attempts: ${lastError}`
      });
      await this.repositoryContainer.machineSnapshots.releaseLock(machineId);
      await this.promoteQueuedIfExists(machineId);
    } catch (cleanupError) {
      const cleanupErrorMsg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      logger.error`[PROCESS] Failed to cleanup after retries exhausted: ${cleanupErrorMsg}`;
    }

    throw new Error(`Snapshot failed after ${MAX_RETRIES} attempts: ${lastError}`);
  }

  /**
   * Process a snapshot with retries (non-blocking, used for cron).
   * Retries with exponential backoff (5s, 10s, 20s, 40s, max 60s) on failure.
   */
  private async processSnapshotAttempt(machineId: string, snapshot: MachineSnapshot): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      logger.info`[EXEC] snapshotId=${snapshot.id} machineId=${machineId} status=SENDING_REQUEST attempt=${attempt}/${MAX_RETRIES}`;
      try {
        const success = await this.executeSnapshotRequest(machineId, snapshot);
        if (success) {
          logger.info`[EXEC] snapshotId=${snapshot.id} status=SUCCESS releasing_lock`;
          await this.repositoryContainer.machineSnapshots.releaseLock(machineId);
          await this.promoteQueuedIfExists(machineId);
          return;
        }
        logger.warn`[EXEC] snapshotId=${snapshot.id} status=FAILED_RESPONSE`;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        logger.error`[EXEC] snapshotId=${snapshot.id} status=ERROR error=${errMsg}`;

        // Bail immediately on non-retryable errors (machine gone, archived, etc.)
        if (NON_RETRYABLE_PATTERNS.some(p => errMsg.includes(p))) {
          logger.warn`[EXEC] snapshotId=${snapshot.id} status=NON_RETRYABLE error=${errMsg}`;
          break;
        }
      }

      // Update retry count - wrap in try-catch to handle DB errors gracefully
      let newRetryCount = 0;
      try {
        newRetryCount = await this.repositoryContainer.machineSnapshots.incrementRetryCount(snapshot.id);
        await this.repositoryContainer.machineSnapshots.updateLockRetryCount(machineId, newRetryCount);
        logger.info`[EXEC] snapshotId=${snapshot.id} retryCount=${newRetryCount}/${MAX_RETRIES}`;
      } catch (dbError) {
        const dbErrorMsg = dbError instanceof Error ? dbError.message : String(dbError);
        logger.error`[EXEC] snapshotId=${snapshot.id} status=DB_ERROR error=${dbErrorMsg}`;
        // Assume max retries reached if we can't track - fail safely
        newRetryCount = MAX_RETRIES;
      }

      if (newRetryCount >= MAX_RETRIES) {
        break;
      }

      // Exponential backoff: 5s, 10s, 20s, 40s, capped at 60s
      const delay = Math.min(5000 * Math.pow(2, attempt - 1), 60000);
      logger.info`[EXEC] snapshotId=${snapshot.id} status=RETRY_WAITING delay=${delay}ms`;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // All retries exhausted
    logger.error`[EXEC] snapshotId=${snapshot.id} status=GAVE_UP`;
    try {
      await this.repositoryContainer.machineSnapshots.updateStatus(snapshot.id, 'failed', {
        error: `Failed after ${MAX_RETRIES} attempts`
      });
      await this.repositoryContainer.machineSnapshots.releaseLock(machineId);
      await this.promoteQueuedIfExists(machineId);
    } catch (cleanupError) {
      const cleanupErrorMsg = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      logger.error`[EXEC] snapshotId=${snapshot.id} status=CLEANUP_ERROR error=${cleanupErrorMsg}`;
    }
  }

  /**
   * Execute the actual snapshot request to agent server.
   */
  private async executeSnapshotRequest(machineId: string, snapshot: MachineSnapshot): Promise<boolean> {
    logger.info`[HTTP] snapshotId=${snapshot.id} action=GET_PRESIGNED_CHUNK_URLS`;
    const presignedUploadUrls = await this.getPresignedChunkUploadUrls(snapshot.id);

    logger.info`[HTTP] snapshotId=${snapshot.id} action=POST_CREATE_SNAPSHOT timeout=600s chunks=${presignedUploadUrls.length}`;
    const response = await this.sendToAgentServer(machineId, '/create-snapshot', {
      presignedUploadUrls,
      chunkSizeBytes: 200 * 1024 * 1024, // 200MB
      snapshotId: snapshot.id
    }, 600000);

    const result = await response.json();

    if (result.success) {
      const reportedSize = BigInt(result.sizeBytes || 0);
      const r2Prefix = `snapshots/${snapshot.id}/`;
      const sizeMB = (Number(reportedSize) / 1024 / 1024).toFixed(2);
      const reportedChunkCount = result.chunkCount || 0;

      // Log chunk manifest from agent (checksums for cross-verification during restore)
      if (Array.isArray(result.chunks)) {
        for (let i = 0; i < result.chunks.length; i++) {
          const c = result.chunks[i];
          logger.info`[HTTP] snapshotId=${snapshot.id} chunk=${i} size=${c.size} sha256=${c.sha256}`;
        }
      }

      // Verify: list all chunks under prefix, sum sizes, compare to reported total
      try {
        const listResponse = await this.s3Client.send(new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: r2Prefix
        }));

        const objects = listResponse.Contents || [];
        if (objects.length === 0) {
          logger.error`[HTTP] snapshotId=${snapshot.id} status=NO_CHUNKS_FOUND prefix=${r2Prefix}`;
          return false;
        }

        if (reportedChunkCount > 0 && objects.length !== reportedChunkCount) {
          logger.error`[HTTP] snapshotId=${snapshot.id} status=CHUNK_COUNT_MISMATCH reported=${reportedChunkCount} actual=${objects.length}`;
          await this.deleteChunks(r2Prefix);
          return false;
        }

        const actualSize = objects.reduce((sum, obj) => sum + BigInt(obj.Size || 0), BigInt(0));
        if (actualSize !== reportedSize) {
          logger.error`[HTTP] snapshotId=${snapshot.id} status=SIZE_MISMATCH reported=${reportedSize} actual=${actualSize}`;
          await this.deleteChunks(r2Prefix);
          return false;
        }

        logger.info`[HTTP] snapshotId=${snapshot.id} status=VERIFIED size=${sizeMB}MB chunks=${objects.length}`;
      } catch (verifyError) {
        const verifyErrorMsg = verifyError instanceof Error ? verifyError.message : String(verifyError);
        logger.error`[HTTP] snapshotId=${snapshot.id} status=VERIFY_FAILED error=${verifyErrorMsg}`;
        return false;
      }

      await this.markCompleted(snapshot.id, reportedSize);
      return true;
    } else {
      const errorMsg = typeof result.error === 'string'
        ? result.error
        : (result.error?.error || result.error?.message || JSON.stringify(result.error) || 'Unknown error');
      logger.error`[HTTP] snapshotId=${snapshot.id} status=FAILED error=${errorMsg}`;

      // Throw for non-retryable errors so retry loops bail out immediately
      if (NON_RETRYABLE_PATTERNS.some(p => errorMsg.includes(p))) {
        throw new Error(errorMsg);
      }
      return false;
    }
  }

  /**
   * Cancel the current in-progress snapshot.
   */
  private async cancelCurrentSnapshot(machineId: string, lock: MachineSnapshotLock): Promise<void> {
    // Tell agent server to cancel (best effort - machine might be unreachable)
    try {
      await this.sendToAgentServer(machineId, '/create-snapshot/cancel', {}, 10000);
      logger.info`[CANCEL] Sent cancel request to machine ${machineId}`;
    } catch (error) {
      logger.warn`[CANCEL] Failed to send cancel to machine (continuing anyway): ${error}`;
    }

    // Mark snapshot as cancelled
    await this.repositoryContainer.machineSnapshots.updateStatus(lock.snapshotId, 'cancelled', {
      error: 'Cancelled for priority snapshot'
    });

    // Release the lock
    await this.repositoryContainer.machineSnapshots.releaseLock(machineId);

    // Small delay to let cancellation propagate
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * If there's a queued item, start and execute it.
   */
  private async promoteQueuedIfExists(machineId: string): Promise<void> {
    const queued = await this.repositoryContainer.machineSnapshots.getQueuedItem(machineId);
    if (queued) {
      logger.info`[PROMOTE] machineId=${machineId} action=DEQUEUE_AND_START`;
      await this.repositoryContainer.machineSnapshots.removeQueuedItem(machineId);
      const snapshot = await this.startSnapshot(machineId);
      if (snapshot) {
        logger.info`[PROMOTE] snapshotId=${snapshot.id} action=EXECUTE_ASYNC`;
        this.processSnapshotAttempt(machineId, snapshot).catch(err =>
          logger.error`[PROMOTE] snapshotId=${snapshot.id} error=${err}`
        );
      }
    }
  }

  // ============================================================
  // CLEANUP & MAINTENANCE
  // ============================================================

  /**
   * Clean up stale locks (held for > 15 minutes).
   */
  private async cleanupStaleLocks(): Promise<void> {
    const staleLocks = await this.repositoryContainer.machineSnapshots.getStaleLocks(LOCK_STALE_MS);

    for (const lock of staleLocks) {
      logger.warn`[STALE] Cleaning up stale lock for machine ${lock.machineId} (snapshot ${lock.snapshotId})`;

      // Mark the snapshot as failed
      await this.repositoryContainer.machineSnapshots.updateStatus(lock.snapshotId, 'failed', {
        error: 'Lock held too long - snapshot presumed stuck'
      });

      // Release the lock
      await this.repositoryContainer.machineSnapshots.releaseLock(lock.machineId);

      // Promote queued if exists
      await this.promoteQueuedIfExists(lock.machineId);
    }

    if (staleLocks.length > 0) {
      logger.warn`[STALE] Cleaned up ${staleLocks.length} stale lock(s)`;
    }
  }

  /**
   * Mark snapshot as completed and schedule old snapshots for deletion.
   */
  private async markCompleted(snapshotId: string, sizeBytes: bigint): Promise<void> {
    const r2Key = `snapshots/${snapshotId}/`;
    await this.repositoryContainer.machineSnapshots.updateStatus(snapshotId, 'completed', { r2Key, sizeBytes });

    // Schedule old snapshots for deletion (5 min delay to allow ongoing forks to complete)
    const snapshot = await this.repositoryContainer.machineSnapshots.findById(snapshotId);
    if (snapshot) {
      const oldSnapshots = await this.repositoryContainer.machineSnapshots.getOldCompletedSnapshots(snapshot.machineId);
      const deleteAfter = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now
      for (const old of oldSnapshots) {
        if (!old.deleteAfter) { // Don't reschedule if already scheduled
          await this.repositoryContainer.machineSnapshots.scheduleForDeletion(old.id, deleteAfter);
          logger.info`[CLEANUP] Scheduled snapshot ${old.id} for deletion at ${deleteAfter.toISOString()}`;
        }
      }
    }
  }

  /**
   * Delete a snapshot from R2 and database.
   * Only deletes R2 objects if no other snapshot record references the same r2Key
   * (carried-over snapshots share R2 data with the original).
   */
  private async deleteSnapshot(snapshot: MachineSnapshot): Promise<void> {
    if (snapshot.r2Key) {
      // Check if other snapshot records share the same R2 data
      const sharedCount = await this.repositoryContainer.machineSnapshots.countByR2Key(snapshot.r2Key, snapshot.id);
      if (sharedCount === 0) {
        try {
          if (snapshot.r2Key.endsWith('/')) {
            // Chunked snapshot: delete all objects under the prefix
            await this.deleteChunks(snapshot.r2Key);
          } else {
            // Legacy single-file snapshot
            await this.s3Client.send(new DeleteObjectCommand({
              Bucket: this.bucketName,
              Key: snapshot.r2Key
            }));
          }
        } catch (error) {
          logger.error`Failed to delete R2 object(s) ${snapshot.r2Key}: ${error}`;
        }
      } else {
        logger.info`Skipping R2 deletion for snapshot ${snapshot.id}: ${sharedCount} other record(s) share r2Key ${snapshot.r2Key}`;
      }
    }
    await this.repositoryContainer.machineSnapshots.deleteSnapshot(snapshot.id);
  }

  /**
   * Delete all chunk objects under a prefix.
   */
  private async deleteChunks(prefix: string): Promise<void> {
    const listResponse = await this.s3Client.send(new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix
    }));
    const objects = listResponse.Contents || [];
    for (const obj of objects) {
      if (obj.Key) {
        await this.s3Client.send(new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: obj.Key
        }));
      }
    }
  }

  /**
   * Process scheduled deletions (snapshots where deleteAfter has passed).
   */
  async processScheduledDeletions(): Promise<{ deleted: number }> {
    const ready = await this.repositoryContainer.machineSnapshots.getSnapshotsReadyForDeletion();
    let deleted = 0;
    for (const snapshot of ready) {
      await this.deleteSnapshot(snapshot);
      logger.info`[CLEANUP] Deleted scheduled snapshot ${snapshot.id}`;
      deleted++;
    }
    return { deleted };
  }

  /**
   * Cleanup expired snapshots (30 day retention).
   */
  async cleanupExpiredSnapshots(): Promise<{ deleted: number }> {
    const expired = await this.repositoryContainer.machineSnapshots.getExpiredSnapshots();
    let deleted = 0;
    for (const snapshot of expired) {
      await this.deleteSnapshot(snapshot);
      deleted++;
    }
    if (deleted > 0) {
      logger.info`[CLEANUP] Deleted ${deleted} expired snapshot(s)`;
    }
    return { deleted };
  }

  // ============================================================
  // PUBLIC GETTERS (for external use)
  // ============================================================

  /**
   * Get presigned upload URLs for chunked snapshot upload.
   * Generates URLs for keys: snapshots/{id}/chunk-00.zst, chunk-01.zst, etc.
   */
  async getPresignedChunkUploadUrls(snapshotId: string, count: number = 15): Promise<string[]> {
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      const chunkKey = `snapshots/${snapshotId}/chunk-${String(i).padStart(2, '0')}.zst`;
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: chunkKey,
        ContentType: 'application/zstd'
      });
      urls.push(await getSignedUrl(this.s3Client, command, { expiresIn: 3600 }));
    }
    return urls;
  }

  /**
   * Get presigned download URLs for all chunks under a snapshot prefix.
   * Lists objects under the prefix, sorts by key, generates download URL for each.
   */
  async getPresignedChunkDownloadUrls(r2Prefix: string): Promise<string[]> {
    const listResponse = await this.s3Client.send(new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: r2Prefix
    }));

    const objects = (listResponse.Contents || [])
      .filter(obj => obj.Key)
      .sort((a, b) => a.Key!.localeCompare(b.Key!));

    const urls: string[] = [];
    for (const obj of objects) {
      const command = new GetObjectCommand({ Bucket: this.bucketName, Key: obj.Key! });
      urls.push(await getSignedUrl(this.s3Client, command, { expiresIn: 3600 }));
    }
    return urls;
  }

  /**
   * Get presigned download URL for a single R2 object (legacy single-file snapshots).
   */
  async getPresignedDownloadUrl(r2Key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: r2Key });
    return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  /**
   * Check if machine has a completed snapshot.
   */
  async hasSnapshot(machineId: string): Promise<boolean> {
    return await this.repositoryContainer.machineSnapshots.hasCompletedSnapshot(machineId);
  }

  /**
   * Get latest completed snapshot for a machine.
   */
  async getLatestSnapshot(machineId: string): Promise<MachineSnapshot | null> {
    return await this.repositoryContainer.machineSnapshots.getLatestCompletedSnapshot(machineId);
  }

  /**
   * Get a snapshot by ID.
   */
  async getSnapshotById(snapshotId: string): Promise<MachineSnapshot | null> {
    return await this.repositoryContainer.machineSnapshots.findById(snapshotId);
  }

  /**
   * Create a completed snapshot record for a new machine, referencing the same R2 data
   * as a source snapshot. Used after restore so the new machine is immediately forkable.
   */
  async createCarriedOverSnapshot(machineId: string, r2Key: string, sizeBytes: bigint | null): Promise<void> {
    await this.repositoryContainer.machineSnapshots.createCompleted(machineId, r2Key, sizeBytes);
  }
}
