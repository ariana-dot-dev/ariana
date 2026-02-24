-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "hasFilesyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN "hasPortForwardingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
