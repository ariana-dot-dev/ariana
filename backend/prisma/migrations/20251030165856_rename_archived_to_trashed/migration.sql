-- Rename isArchived to isTrashed
ALTER TABLE "Agent" RENAME COLUMN "isArchived" TO "isTrashed";

-- Rename archivedAt to trashedAt
ALTER TABLE "Agent" RENAME COLUMN "archivedAt" TO "trashedAt";

-- Rename indexes
DROP INDEX IF EXISTS "Agent_isArchived_idx";
DROP INDEX IF EXISTS "Agent_archivedAt_idx";
CREATE INDEX "Agent_isTrashed_idx" ON "Agent"("isTrashed");
CREATE INDEX "Agent_trashedAt_idx" ON "Agent"("trashedAt");
