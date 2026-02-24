-- CreateTable
CREATE TABLE "AgentUploadProgress" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "chunksReceived" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentUploadProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentUploadProgress_agentId_key" ON "AgentUploadProgress"("agentId");

-- CreateIndex
CREATE INDEX "AgentUploadProgress_agentId_idx" ON "AgentUploadProgress"("agentId");

-- CreateIndex
CREATE INDEX "AgentUploadProgress_createdAt_idx" ON "AgentUploadProgress"("createdAt");
