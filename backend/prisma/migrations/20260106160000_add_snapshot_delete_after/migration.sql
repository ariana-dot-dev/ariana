-- AlterTable
ALTER TABLE "MachineSnapshot" ADD COLUMN "deleteAfter" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "MachineSnapshot_deleteAfter_idx" ON "MachineSnapshot"("deleteAfter");
