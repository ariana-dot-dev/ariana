/*
  Warnings:

  - You are about to drop the column `currentCheckpointSha` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the column `isInitialUncommitted` on the `AgentCommit` table. All the data in the column will be lost.
  - You are about to drop the `AgentDiff` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "public"."Agent_currentCheckpointSha_idx";

-- DropIndex
DROP INDEX "public"."AgentCommit_isInitialUncommitted_idx";

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "currentCheckpointSha",
ADD COLUMN     "gitHistoryLastPushedCommitSha" TEXT,
ADD COLUMN     "startCommitSha" TEXT;

-- AlterTable
ALTER TABLE "AgentCommit" DROP COLUMN "isInitialUncommitted",
ADD COLUMN     "commitPatch" TEXT,
ADD COLUMN     "title" TEXT;

-- DropTable
DROP TABLE "public"."AgentDiff";

-- CreateTable
CREATE TABLE "AgentAttachments" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "claudeDirectoryZip" TEXT,
    "pendingDiff" TEXT,
    "totalDiff" TEXT,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "AgentAttachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentAttachments_agentId_key" ON "AgentAttachments"("agentId");

-- CreateIndex
CREATE INDEX "AgentAttachments_agentId_idx" ON "AgentAttachments"("agentId");

-- CreateIndex
CREATE INDEX "AgentAttachments_updatedAt_idx" ON "AgentAttachments"("updatedAt");

-- AddForeignKey
ALTER TABLE "AgentAttachments" ADD CONSTRAINT "AgentAttachments_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
