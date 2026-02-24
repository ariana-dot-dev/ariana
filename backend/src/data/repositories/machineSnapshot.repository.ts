import { PrismaClient, type MachineSnapshot, type MachineSnapshotQueue, type MachineSnapshotLock } from '../../../generated/prisma';

export class MachineSnapshotRepository {
  constructor(private prisma: PrismaClient) {}

  // ============================================================
  // SNAPSHOT CRUD
  // ============================================================

  async create(machineId: string, status: string, priority: boolean = false): Promise<MachineSnapshot> {
    const retentionDays = parseInt(process.env.SNAPSHOT_RETENTION_DAYS || '30');
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    return await this.prisma.machineSnapshot.create({
      data: {
        id: crypto.randomUUID(),
        machineId,
        status,
        expiresAt,
        priority
      }
    });
  }

  async findById(id: string): Promise<MachineSnapshot | null> {
    return await this.prisma.machineSnapshot.findUnique({ where: { id } });
  }

  /**
   * Create a completed snapshot record referencing existing R2 data.
   * Used to carry over a source snapshot to a new machine after restore.
   */
  async createCompleted(machineId: string, r2Key: string, sizeBytes: bigint | null): Promise<MachineSnapshot> {
    const retentionDays = parseInt(process.env.SNAPSHOT_RETENTION_DAYS || '30');
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    return await this.prisma.machineSnapshot.create({
      data: {
        id: crypto.randomUUID(),
        machineId,
        status: 'completed',
        r2Key,
        sizeBytes,
        expiresAt,
        completedAt: new Date()
      }
    });
  }

  async updateStatus(
    id: string,
    status: string,
    data?: { r2Key?: string; sizeBytes?: bigint; error?: string; retryCount?: number }
  ): Promise<void> {
    await this.prisma.machineSnapshot.update({
      where: { id },
      data: {
        status,
        ...(status === 'completed' ? { completedAt: new Date() } : {}),
        ...data
      }
    });
  }

  async incrementRetryCount(id: string): Promise<number> {
    const updated = await this.prisma.machineSnapshot.update({
      where: { id },
      data: { retryCount: { increment: 1 } }
    });
    return updated.retryCount;
  }

  async getLatestCompletedSnapshot(machineId: string): Promise<MachineSnapshot | null> {
    return await this.prisma.machineSnapshot.findFirst({
      where: { machineId, status: 'completed' },
      orderBy: { completedAt: 'desc' }
    });
  }

  async hasCompletedSnapshot(machineId: string): Promise<boolean> {
    const count = await this.prisma.machineSnapshot.count({
      where: { machineId, status: 'completed' }
    });
    return count > 0;
  }

  /**
   * Get all completed snapshots except the latest one (for soft delete scheduling).
   */
  async getOldCompletedSnapshots(machineId: string): Promise<MachineSnapshot[]> {
    const all = await this.prisma.machineSnapshot.findMany({
      where: { machineId, status: 'completed' },
      orderBy: { completedAt: 'desc' }
    });
    return all.slice(1); // All except latest
  }

  /**
   * Schedule a snapshot for deletion after a delay.
   */
  async scheduleForDeletion(snapshotId: string, deleteAfter: Date): Promise<void> {
    await this.prisma.machineSnapshot.update({
      where: { id: snapshotId },
      data: { deleteAfter }
    });
  }

  /**
   * Get snapshots that are ready to be deleted (deleteAfter has passed).
   */
  async getSnapshotsReadyForDeletion(): Promise<MachineSnapshot[]> {
    return await this.prisma.machineSnapshot.findMany({
      where: {
        deleteAfter: { lte: new Date() }
      }
    });
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.prisma.machineSnapshot.delete({ where: { id } });
  }

  /**
   * Count other snapshot records that share the same r2Key (excluding the given snapshot ID).
   * Used to prevent deleting R2 data that is still referenced by another record (e.g. carried-over snapshots).
   */
  async countByR2Key(r2Key: string, excludeId: string): Promise<number> {
    return await this.prisma.machineSnapshot.count({
      where: { r2Key, id: { not: excludeId } }
    });
  }

  async getExpiredSnapshots(): Promise<MachineSnapshot[]> {
    return await this.prisma.machineSnapshot.findMany({
      where: { expiresAt: { lt: new Date() } }
    });
  }

  // ============================================================
  // LOCK MANAGEMENT (Machine-level lock for in-progress snapshots)
  // ============================================================

  /**
   * Try to acquire lock for a machine. Returns the lock if acquired, null if already locked.
   */
  async tryAcquireLock(machineId: string, snapshotId: string): Promise<MachineSnapshotLock | null> {
    try {
      return await this.prisma.machineSnapshotLock.create({
        data: {
          id: crypto.randomUUID(),
          machineId,
          snapshotId,
          retryCount: 0
        }
      });
    } catch (error: any) {
      // Unique constraint violation = lock already exists
      if (error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get the current lock for a machine.
   */
  async getLock(machineId: string): Promise<MachineSnapshotLock | null> {
    return await this.prisma.machineSnapshotLock.findUnique({
      where: { machineId }
    });
  }

  /**
   * Release the lock for a machine.
   */
  async releaseLock(machineId: string): Promise<void> {
    await this.prisma.machineSnapshotLock.deleteMany({
      where: { machineId }
    });
  }

  /**
   * Update retry count on lock.
   */
  async updateLockRetryCount(machineId: string, retryCount: number): Promise<void> {
    await this.prisma.machineSnapshotLock.update({
      where: { machineId },
      data: { retryCount }
    });
  }

  /**
   * Get stale locks (held for longer than maxAgeMs).
   */
  async getStaleLocks(maxAgeMs: number): Promise<MachineSnapshotLock[]> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    return await this.prisma.machineSnapshotLock.findMany({
      where: { acquiredAt: { lt: cutoff } }
    });
  }

  // ============================================================
  // QUEUE MANAGEMENT (Single-slot queue per machine)
  // ============================================================

  /**
   * Get the queued snapshot for a machine.
   */
  async getQueuedItem(machineId: string): Promise<MachineSnapshotQueue | null> {
    return await this.prisma.machineSnapshotQueue.findUnique({
      where: { machineId }
    });
  }

  /**
   * Add or replace the queued snapshot for a machine.
   * Uses upsert to handle the single-slot queue behavior.
   */
  async setQueuedItem(machineId: string, priority: boolean): Promise<MachineSnapshotQueue> {
    return await this.prisma.machineSnapshotQueue.upsert({
      where: { machineId },
      create: {
        id: crypto.randomUUID(),
        machineId,
        priority
      },
      update: {
        priority,
        createdAt: new Date()
      }
    });
  }

  /**
   * Remove the queued snapshot for a machine.
   */
  async removeQueuedItem(machineId: string): Promise<void> {
    await this.prisma.machineSnapshotQueue.deleteMany({
      where: { machineId }
    });
  }

  /**
   * Get machines that have something queued but no lock.
   */
  async getQueuedMachinesWithoutLock(): Promise<MachineSnapshotQueue[]> {
    const locks = await this.prisma.machineSnapshotLock.findMany({
      select: { machineId: true }
    });
    const lockedMachineIds = locks.map(l => l.machineId);

    return await this.prisma.machineSnapshotQueue.findMany({
      where: lockedMachineIds.length > 0 ? { machineId: { notIn: lockedMachineIds } } : {},
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' }
      ]
    });
  }

}
