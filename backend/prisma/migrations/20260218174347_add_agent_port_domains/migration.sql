-- CreateTable
CREATE TABLE "AgentPortDomain" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "machineName" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPortDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentPortDomain_agentId_idx" ON "AgentPortDomain"("agentId");

-- CreateIndex
CREATE INDEX "AgentPortDomain_machineName_idx" ON "AgentPortDomain"("machineName");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPortDomain_agentId_port_key" ON "AgentPortDomain"("agentId", "port");
