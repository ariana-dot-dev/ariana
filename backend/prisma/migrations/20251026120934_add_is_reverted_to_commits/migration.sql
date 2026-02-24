-- AlterTable
ALTER TABLE "AgentCommit" ADD COLUMN     "isReverted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revertedAt" TIMESTAMP(3),
ADD COLUMN     "revertedByCheckpoint" TEXT;

-- CreateIndex
CREATE INDEX "AgentCommit_isReverted_idx" ON "AgentCommit"("isReverted");
