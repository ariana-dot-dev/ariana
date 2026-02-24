/*
  Warnings:

  - You are about to drop the `AgentCompaction` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."AgentCompaction" DROP CONSTRAINT "AgentCompaction_taskId_fkey";

-- DropTable
DROP TABLE "public"."AgentCompaction";

-- CreateTable
CREATE TABLE "AgentContextEvent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "taskId" TEXT,
    "contextUsedPercent" INTEGER,
    "contextRemainingPercent" INTEGER,
    "inputTokens" INTEGER,
    "cacheTokens" INTEGER,
    "contextWindow" INTEGER,
    "summary" TEXT,
    "tokensBefore" INTEGER,
    "tokensAfter" INTEGER,
    "tokensSaved" INTEGER,
    "triggerReason" TEXT,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "AgentContextEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentContextEvent_agentId_idx" ON "AgentContextEvent"("agentId");

-- CreateIndex
CREATE INDEX "AgentContextEvent_createdAt_idx" ON "AgentContextEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AgentContextEvent_type_idx" ON "AgentContextEvent"("type");
