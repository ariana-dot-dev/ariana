-- CreateTable
CREATE TABLE "ParkedMachine" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "machineName" TEXT NOT NULL,
    "ipv4" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'launching',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedByAgentId" TEXT,

    CONSTRAINT "ParkedMachine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MachineHealthCheck" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MachineHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParkedMachine_machineId_key" ON "ParkedMachine"("machineId");

-- CreateIndex
CREATE INDEX "ParkedMachine_status_idx" ON "ParkedMachine"("status");

-- CreateIndex
CREATE INDEX "ParkedMachine_createdAt_idx" ON "ParkedMachine"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MachineHealthCheck_agentId_key" ON "MachineHealthCheck"("agentId");

-- CreateIndex
CREATE INDEX "MachineHealthCheck_agentId_idx" ON "MachineHealthCheck"("agentId");

-- CreateIndex
CREATE INDEX "MachineHealthCheck_consecutiveFailures_idx" ON "MachineHealthCheck"("consecutiveFailures");

-- CreateIndex
CREATE INDEX "MachineHealthCheck_lastCheckAt_idx" ON "MachineHealthCheck"("lastCheckAt");
