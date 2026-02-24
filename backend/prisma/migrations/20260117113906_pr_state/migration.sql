/*
  Warnings:

  - You are about to drop the column `prTargetBranch` on the `Agent` table. All the data in the column will be lost.
  - You are about to drop the `PushAndPrRequest` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "prTargetBranch",
ADD COLUMN     "prBaseBranch" TEXT,
ADD COLUMN     "prLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "prNumber" INTEGER,
ADD COLUMN     "prState" TEXT;

-- DropTable
DROP TABLE "public"."PushAndPrRequest";

-- CreateIndex
CREATE INDEX "Agent_prState_idx" ON "Agent"("prState");
