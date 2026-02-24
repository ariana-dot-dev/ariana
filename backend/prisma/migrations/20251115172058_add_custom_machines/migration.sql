-- CreateTable
CREATE TABLE "PendingMachineRegistration" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingMachineRegistration_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "CustomMachine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sharedKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "os" TEXT NOT NULL,
    "arch" TEXT NOT NULL,
    "cpuCount" INTEGER NOT NULL,
    "memoryGB" INTEGER NOT NULL,
    "currentAgentId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomMachine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingMachineRegistration_userId_idx" ON "PendingMachineRegistration"("userId");

-- CreateIndex
CREATE INDEX "PendingMachineRegistration_status_idx" ON "PendingMachineRegistration"("status");

-- CreateIndex
CREATE INDEX "PendingMachineRegistration_expiresAt_idx" ON "PendingMachineRegistration"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomMachine_currentAgentId_key" ON "CustomMachine"("currentAgentId");

-- CreateIndex
CREATE INDEX "CustomMachine_userId_idx" ON "CustomMachine"("userId");

-- CreateIndex
CREATE INDEX "CustomMachine_status_idx" ON "CustomMachine"("status");

-- CreateIndex
CREATE INDEX "CustomMachine_currentAgentId_idx" ON "CustomMachine"("currentAgentId");

-- AddForeignKey
ALTER TABLE "PendingMachineRegistration" ADD CONSTRAINT "PendingMachineRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomMachine" ADD CONSTRAINT "CustomMachine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CustomMachine" ADD CONSTRAINT "CustomMachine_currentAgentId_fkey" FOREIGN KEY ("currentAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
