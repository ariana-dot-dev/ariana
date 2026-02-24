-- AlterTable
ALTER TABLE "MachineSnapshot" ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MachineSnapshotQueue" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MachineSnapshotQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineSnapshotLock" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MachineSnapshotLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MachineSnapshotQueue_machineId_key" ON "MachineSnapshotQueue"("machineId");

-- CreateIndex
CREATE INDEX "MachineSnapshotQueue_machineId_idx" ON "MachineSnapshotQueue"("machineId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineSnapshotLock_machineId_key" ON "MachineSnapshotLock"("machineId");

-- CreateIndex
CREATE INDEX "MachineSnapshotLock_machineId_idx" ON "MachineSnapshotLock"("machineId");

-- CreateIndex
CREATE INDEX "MachineSnapshotLock_acquiredAt_idx" ON "MachineSnapshotLock"("acquiredAt");
