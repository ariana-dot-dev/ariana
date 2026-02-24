/*
  Warnings:

  - You are about to drop the `ForkBundleChunk` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ForkBundleFinalized` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."ForkBundleChunk";

-- DropTable
DROP TABLE "public"."ForkBundleFinalized";

-- CreateTable
CREATE TABLE "MachineSnapshot" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "r2Key" TEXT,
    "sizeBytes" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "error" TEXT,

    CONSTRAINT "MachineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineSnapshot_machineId_status_idx" ON "MachineSnapshot"("machineId", "status");

-- CreateIndex
CREATE INDEX "MachineSnapshot_machineId_completedAt_idx" ON "MachineSnapshot"("machineId", "completedAt");

-- CreateIndex
CREATE INDEX "MachineSnapshot_expiresAt_idx" ON "MachineSnapshot"("expiresAt");

-- CreateIndex
CREATE INDEX "MachineSnapshot_status_idx" ON "MachineSnapshot"("status");
