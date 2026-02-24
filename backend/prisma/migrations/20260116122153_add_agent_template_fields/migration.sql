-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "isTemplate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "templateMarkedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Agent_projectId_isTemplate_templateMarkedAt_idx" ON "Agent"("projectId", "isTemplate", "templateMarkedAt");
