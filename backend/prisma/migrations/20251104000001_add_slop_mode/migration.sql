-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "inSlopModeUntil" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN "slopModeLastPromptAt" TIMESTAMP(3);
