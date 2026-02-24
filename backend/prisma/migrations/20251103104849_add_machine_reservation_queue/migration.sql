-- CreateTable
CREATE TABLE "MachineReservationQueue" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedMachineId" TEXT,
    "assignedIpv4" TEXT,
    "assignedSharedKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineReservationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MachineReservationQueue_agentId_key" ON "MachineReservationQueue"("agentId");

-- CreateIndex
CREATE INDEX "MachineReservationQueue_status_requestedAt_idx" ON "MachineReservationQueue"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "MachineReservationQueue_agentId_idx" ON "MachineReservationQueue"("agentId");
