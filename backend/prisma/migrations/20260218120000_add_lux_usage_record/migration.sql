-- CreateTable
CREATE TABLE "LuxUsageRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "actionsReturned" INTEGER NOT NULL DEFAULT 0,
    "stopped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LuxUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LuxUsageRecord_userId_idx" ON "LuxUsageRecord"("userId");
CREATE INDEX "LuxUsageRecord_agentId_idx" ON "LuxUsageRecord"("agentId");
CREATE INDEX "LuxUsageRecord_projectId_idx" ON "LuxUsageRecord"("projectId");
CREATE INDEX "LuxUsageRecord_sessionId_idx" ON "LuxUsageRecord"("sessionId");
CREATE INDEX "LuxUsageRecord_createdAt_idx" ON "LuxUsageRecord"("createdAt");
