-- AlterTable
-- Remove activity tracking fields that are now handled by frontend keep-alive mechanism
ALTER TABLE "Agent" DROP COLUMN "hasFilesyncEnabled",
DROP COLUMN "hasPortForwardingEnabled",
DROP COLUMN "lastActivityAt";
