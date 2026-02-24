-- AlterTable: Add LUX active session fields to Agent
ALTER TABLE "Agent" ADD COLUMN "luxActiveTask" TEXT;
ALTER TABLE "Agent" ADD COLUMN "luxActiveSessionId" TEXT;

-- AlterTable: Add reason field to LuxUsageRecord
ALTER TABLE "LuxUsageRecord" ADD COLUMN "reason" TEXT;
