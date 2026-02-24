-- CreateTable
CREATE TABLE "public"."DashboardSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "totalProjects" INTEGER NOT NULL,
    "totalAgents" INTEGER NOT NULL,
    "agentsWithPushAndPR" INTEGER NOT NULL,
    "totalCommits" INTEGER NOT NULL,
    "pushedCommits" INTEGER NOT NULL,
    "usersByAgentCount" JSONB NOT NULL,
    "usersByPromptCount" JSONB NOT NULL,
    "usersByPRCount" JSONB NOT NULL,
    "retentionNoGap" JSONB NOT NULL,
    "retentionGap1Day" JSONB NOT NULL,
    "retentionGap3Days" JSONB NOT NULL,
    "retentionGap7Days" JSONB NOT NULL,
    "sessionDurationDist" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DashboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DashboardSnapshot_snapshotDate_key" ON "public"."DashboardSnapshot"("snapshotDate");

-- CreateIndex
CREATE INDEX "DashboardSnapshot_snapshotDate_idx" ON "public"."DashboardSnapshot"("snapshotDate");

-- CreateIndex
CREATE INDEX "DashboardSnapshot_createdAt_idx" ON "public"."DashboardSnapshot"("createdAt");
