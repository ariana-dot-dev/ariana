-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "blockedByAutomationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "pendingCommitTriggered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pendingPushPrTriggered" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PushAndPrRequest" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createPR" BOOLEAN NOT NULL DEFAULT false,
    "prTitle" TEXT,
    "prBody" TEXT,
    "prTargetBranch" TEXT,
    "includeShareLink" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "prUrl" TEXT,
    "pushedCommits" INTEGER,

    CONSTRAINT "PushAndPrRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PushAndPrRequest_agentId_idx" ON "PushAndPrRequest"("agentId");

-- CreateIndex
CREATE INDEX "PushAndPrRequest_status_idx" ON "PushAndPrRequest"("status");

-- CreateIndex
CREATE INDEX "PushAndPrRequest_createdAt_idx" ON "PushAndPrRequest"("createdAt");
