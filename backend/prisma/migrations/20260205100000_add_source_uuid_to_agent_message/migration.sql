-- AlterTable
ALTER TABLE "AgentMessage" ADD COLUMN "sourceUuid" TEXT;

-- CreateIndex
CREATE INDEX "AgentMessage_agentId_sourceUuid_idx" ON "AgentMessage"("agentId", "sourceUuid");
