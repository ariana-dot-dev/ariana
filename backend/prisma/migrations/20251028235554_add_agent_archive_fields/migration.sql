-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Agent_isArchived_idx" ON "Agent"("isArchived");

-- CreateIndex
CREATE INDEX "Agent_archivedAt_idx" ON "Agent"("archivedAt");
