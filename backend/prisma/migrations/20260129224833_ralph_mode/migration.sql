-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "inRalphMode" BOOLEAN,
ADD COLUMN     "ralphModeLastPromptAt" TIMESTAMP(3),
ADD COLUMN     "ralphModeTaskDescription" TEXT;
