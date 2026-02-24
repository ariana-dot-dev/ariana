/*
  Warnings:

  - You are about to drop the `UserUsageLimits` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."UserUsageLimits" DROP CONSTRAINT "UserUsageLimits_userId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "userLimitsTierId" TEXT NOT NULL DEFAULT 'anonymous';

-- DropTable
DROP TABLE "public"."UserUsageLimits";

-- CreateTable
CREATE TABLE "UserLimits" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "maxProjectsTotal" INTEGER NOT NULL,
    "maxProjectsPerMinute" INTEGER NOT NULL,
    "maxProjectsPer24Hours" INTEGER NOT NULL,
    "maxAgentsPerMonth" INTEGER NOT NULL,
    "maxAgentsPerMinute" INTEGER NOT NULL,
    "maxAgentsPer24Hours" INTEGER NOT NULL,
    "maxSpecificationsTotal" INTEGER NOT NULL,
    "maxSpecificationsPerMinute" INTEGER NOT NULL,
    "maxSpecificationsPer24Hours" INTEGER NOT NULL,
    "maxPromptsPerMinute" INTEGER NOT NULL,
    "maxPromptsPer24Hours" INTEGER NOT NULL,

    CONSTRAINT "UserLimits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectsTotal" INTEGER NOT NULL DEFAULT 0,
    "projectsLastMinute" JSONB NOT NULL DEFAULT '[]',
    "projectsLast24Hours" JSONB NOT NULL DEFAULT '[]',
    "agentsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "agentsLastMinute" JSONB NOT NULL DEFAULT '[]',
    "agentsLast24Hours" JSONB NOT NULL DEFAULT '[]',
    "agentsMonthResetAt" TIMESTAMP(3),
    "specificationsTotal" INTEGER NOT NULL DEFAULT 0,
    "specificationsLastMinute" JSONB NOT NULL DEFAULT '[]',
    "specificationsLast24Hours" JSONB NOT NULL DEFAULT '[]',
    "promptsLastMinute" JSONB NOT NULL DEFAULT '[]',
    "promptsLast24Hours" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "UserUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserUsage_userId_key" ON "UserUsage"("userId");

-- CreateIndex
CREATE INDEX "UserUsage_userId_idx" ON "UserUsage"("userId");

-- Insert predefined limit tiers
INSERT INTO "UserLimits" ("id", "label", "maxProjectsTotal", "maxProjectsPerMinute", "maxProjectsPer24Hours", "maxAgentsPerMonth", "maxAgentsPerMinute", "maxAgentsPer24Hours", "maxSpecificationsTotal", "maxSpecificationsPerMinute", "maxSpecificationsPer24Hours", "maxPromptsPerMinute", "maxPromptsPer24Hours") VALUES
('anonymous', 'Anonymous User', 3, 10, 70, 3, 10, 100, 5, 10, 70, 10, 500),
('github', 'GitHub User', 5000, 10, 70, 30, 10, 100, 1000, 10, 70, 10, 500);

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_userLimitsTierId_fkey" FOREIGN KEY ("userLimitsTierId") REFERENCES "UserLimits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "UserUsage" ADD CONSTRAINT "UserUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
