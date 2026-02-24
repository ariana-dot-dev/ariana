-- CreateTable
CREATE TABLE "public"."Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repositoryId" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "githubProfileId" TEXT,
    "creationMachinePublicSshKey" TEXT,
    "claudeCodeOauthToken" TEXT,
    "anthropicApiKey" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "anonymousIdentifier" TEXT,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GitHubProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "GitHubProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Agent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "machineId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'init',
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "currentCheckpointSha" TEXT,
    "currentTaskId" TEXT,
    "branchName" TEXT NOT NULL DEFAULT '',
    "baseBranch" TEXT,
    "lastCommitSha" TEXT,
    "lastCommitUrl" TEXT,
    "lastCommitAt" TIMESTAMP(3),
    "lastCommitPushed" BOOLEAN NOT NULL DEFAULT false,
    "lastPromptText" TEXT,
    "lastPromptAt" TIMESTAMP(3),
    "lastToolName" TEXT,
    "lastToolTarget" TEXT,
    "lastToolAt" TIMESTAMP(3),
    "lifetimeUnits" INTEGER NOT NULL DEFAULT 1,
    "provisionedAt" TIMESTAMP(3),

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentCommit" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "commitMessage" TEXT NOT NULL,
    "commitUrl" TEXT,
    "branchName" TEXT NOT NULL,
    "filesChanged" INTEGER DEFAULT 0,
    "additions" INTEGER DEFAULT 0,
    "deletions" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3),
    "taskId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "pushedAt" TIMESTAMP(3),
    "isInitialUncommitted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AgentCommit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentMessage" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "tools" JSONB,
    "isReverted" BOOLEAN NOT NULL DEFAULT false,
    "revertedAt" TIMESTAMP(3),
    "revertedByCheckpoint" TEXT,
    "taskId" TEXT,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentPrompt" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "AgentPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentReset" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3),
    "taskId" TEXT,

    CONSTRAINT "AgentReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentCompaction" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3),
    "taskId" TEXT,

    CONSTRAINT "AgentCompaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GitHubCache" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "repositoryId" TEXT,
    "cacheKey" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "GitHubCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GitHubToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "scope" TEXT,
    "tokenType" TEXT DEFAULT 'bearer',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "GitHubToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProjectSpecification" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contents" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "ProjectSpecification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Repository" (
    "id" TEXT NOT NULL,
    "githubId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL DEFAULT 'main',
    "lastCommitAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserAgentAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'write',
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "UserAgentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AgentDiff" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "baseCommit" TEXT,
    "commitPatches" JSONB NOT NULL DEFAULT '[]',
    "pendingDiff" TEXT NOT NULL DEFAULT '',
    "initialUncommittedTaskCommit" JSONB,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "AgentDiff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserUsageLimits" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectsTotal" INTEGER NOT NULL DEFAULT 0,
    "projectsLastMinute" JSONB NOT NULL DEFAULT '[]',
    "projectsLast24Hours" JSONB NOT NULL DEFAULT '[]',
    "maxProjectsTotal" INTEGER NOT NULL,
    "maxProjectsPerMinute" INTEGER NOT NULL,
    "maxProjectsPer24Hours" INTEGER NOT NULL,
    "agentsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "agentsLastMinute" JSONB NOT NULL DEFAULT '[]',
    "agentsLast24Hours" JSONB NOT NULL DEFAULT '[]',
    "maxAgentsPerMonth" INTEGER NOT NULL,
    "maxAgentsPerMinute" INTEGER NOT NULL,
    "maxAgentsPer24Hours" INTEGER NOT NULL,
    "agentsMonthResetAt" TIMESTAMP(3),
    "specificationsTotal" INTEGER NOT NULL DEFAULT 0,
    "specificationsLastMinute" JSONB NOT NULL DEFAULT '[]',
    "specificationsLast24Hours" JSONB NOT NULL DEFAULT '[]',
    "maxSpecificationsTotal" INTEGER NOT NULL,
    "maxSpecificationsPerMinute" INTEGER NOT NULL,
    "maxSpecificationsPer24Hours" INTEGER NOT NULL,
    "promptsLastMinute" JSONB NOT NULL DEFAULT '[]',
    "promptsLast24Hours" JSONB NOT NULL DEFAULT '[]',
    "maxPromptsPerMinute" INTEGER NOT NULL,
    "maxPromptsPer24Hours" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "UserUsageLimits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubProfileId_key" ON "public"."User"("githubProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "User_anonymousIdentifier_key" ON "public"."User"("anonymousIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubProfile_email_key" ON "public"."GitHubProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "public"."ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "Agent_currentTaskId_idx" ON "public"."Agent"("currentTaskId");

-- CreateIndex
CREATE INDEX "Agent_userId_idx" ON "public"."Agent"("userId");

-- CreateIndex
CREATE INDEX "Agent_state_idx" ON "public"."Agent"("state");

-- CreateIndex
CREATE INDEX "Agent_projectId_idx" ON "public"."Agent"("projectId");

-- CreateIndex
CREATE INDEX "Agent_isRunning_idx" ON "public"."Agent"("isRunning");

-- CreateIndex
CREATE INDEX "Agent_currentCheckpointSha_idx" ON "public"."Agent"("currentCheckpointSha");

-- CreateIndex
CREATE INDEX "Agent_provisionedAt_idx" ON "public"."Agent"("provisionedAt");

-- CreateIndex
CREATE INDEX "AgentCommit_taskId_idx" ON "public"."AgentCommit"("taskId");

-- CreateIndex
CREATE INDEX "AgentCommit_projectId_idx" ON "public"."AgentCommit"("projectId");

-- CreateIndex
CREATE INDEX "AgentCommit_createdAt_idx" ON "public"."AgentCommit"("createdAt");

-- CreateIndex
CREATE INDEX "AgentCommit_agentId_idx" ON "public"."AgentCommit"("agentId");

-- CreateIndex
CREATE INDEX "AgentCommit_isDeleted_idx" ON "public"."AgentCommit"("isDeleted");

-- CreateIndex
CREATE INDEX "AgentCommit_pushed_idx" ON "public"."AgentCommit"("pushed");

-- CreateIndex
CREATE INDEX "AgentCommit_isInitialUncommitted_idx" ON "public"."AgentCommit"("isInitialUncommitted");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCommit_agentId_commitSha_key" ON "public"."AgentCommit"("agentId", "commitSha");

-- CreateIndex
CREATE INDEX "AgentMessage_taskId_idx" ON "public"."AgentMessage"("taskId");

-- CreateIndex
CREATE INDEX "AgentMessage_timestamp_idx" ON "public"."AgentMessage"("timestamp");

-- CreateIndex
CREATE INDEX "AgentMessage_role_idx" ON "public"."AgentMessage"("role");

-- CreateIndex
CREATE INDEX "AgentMessage_revertedAt_idx" ON "public"."AgentMessage"("revertedAt");

-- CreateIndex
CREATE INDEX "AgentMessage_isReverted_idx" ON "public"."AgentMessage"("isReverted");

-- CreateIndex
CREATE INDEX "AgentMessage_agentId_idx" ON "public"."AgentMessage"("agentId");

-- CreateIndex
CREATE INDEX "AgentPrompt_status_idx" ON "public"."AgentPrompt"("status");

-- CreateIndex
CREATE INDEX "AgentPrompt_createdAt_idx" ON "public"."AgentPrompt"("createdAt");

-- CreateIndex
CREATE INDEX "AgentPrompt_agentId_idx" ON "public"."AgentPrompt"("agentId");

-- CreateIndex
CREATE INDEX "AgentReset_agentId_idx" ON "public"."AgentReset"("agentId");

-- CreateIndex
CREATE INDEX "AgentReset_createdAt_idx" ON "public"."AgentReset"("createdAt");

-- CreateIndex
CREATE INDEX "AgentReset_taskId_idx" ON "public"."AgentReset"("taskId");

-- CreateIndex
CREATE INDEX "AgentCompaction_agentId_idx" ON "public"."AgentCompaction"("agentId");

-- CreateIndex
CREATE INDEX "AgentCompaction_createdAt_idx" ON "public"."AgentCompaction"("createdAt");

-- CreateIndex
CREATE INDEX "AgentCompaction_taskId_idx" ON "public"."AgentCompaction"("taskId");

-- CreateIndex
CREATE INDEX "GitHubCache_repositoryId_idx" ON "public"."GitHubCache"("repositoryId");

-- CreateIndex
CREATE INDEX "GitHubCache_expiresAt_idx" ON "public"."GitHubCache"("expiresAt");

-- CreateIndex
CREATE INDEX "GitHubToken_userId_idx" ON "public"."GitHubToken"("userId");

-- CreateIndex
CREATE INDEX "ProjectSpecification_createdAt_idx" ON "public"."ProjectSpecification"("createdAt");

-- CreateIndex
CREATE INDEX "ProjectSpecification_projectId_idx" ON "public"."ProjectSpecification"("projectId");

-- CreateIndex
CREATE INDEX "ProjectSpecification_userId_idx" ON "public"."ProjectSpecification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubId_key" ON "public"."Repository"("githubId");

-- CreateIndex
CREATE INDEX "Repository_githubId_idx" ON "public"."Repository"("githubId");

-- CreateIndex
CREATE INDEX "UserAgentAccess_userId_idx" ON "public"."UserAgentAccess"("userId");

-- CreateIndex
CREATE INDEX "UserAgentAccess_agentId_idx" ON "public"."UserAgentAccess"("agentId");

-- CreateIndex
CREATE INDEX "UserAgentAccess_access_idx" ON "public"."UserAgentAccess"("access");

-- CreateIndex
CREATE UNIQUE INDEX "UserAgentAccess_userId_agentId_key" ON "public"."UserAgentAccess"("userId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDiff_agentId_key" ON "public"."AgentDiff"("agentId");

-- CreateIndex
CREATE INDEX "AgentDiff_agentId_idx" ON "public"."AgentDiff"("agentId");

-- CreateIndex
CREATE INDEX "AgentDiff_updatedAt_idx" ON "public"."AgentDiff"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserUsageLimits_userId_key" ON "public"."UserUsageLimits"("userId");

-- CreateIndex
CREATE INDEX "UserUsageLimits_userId_idx" ON "public"."UserUsageLimits"("userId");

-- AddForeignKey
ALTER TABLE "public"."Project" ADD CONSTRAINT "Project_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."Repository"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_githubProfileId_fkey" FOREIGN KEY ("githubProfileId") REFERENCES "public"."GitHubProfile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."Agent" ADD CONSTRAINT "Agent_currentTaskId_fkey" FOREIGN KEY ("currentTaskId") REFERENCES "public"."AgentPrompt"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."AgentCommit" ADD CONSTRAINT "AgentCommit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."AgentPrompt"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."AgentMessage" ADD CONSTRAINT "AgentMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."AgentPrompt"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."AgentPrompt" ADD CONSTRAINT "AgentPrompt_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."AgentReset" ADD CONSTRAINT "AgentReset_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."AgentPrompt"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."AgentCompaction" ADD CONSTRAINT "AgentCompaction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."AgentPrompt"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."GitHubCache" ADD CONSTRAINT "GitHubCache_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."Repository"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."GitHubToken" ADD CONSTRAINT "GitHubToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."GitHubProfile"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ProjectSpecification" ADD CONSTRAINT "ProjectSpecification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."ProjectSpecification" ADD CONSTRAINT "ProjectSpecification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."UserAgentAccess" ADD CONSTRAINT "UserAgentAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."UserAgentAccess" ADD CONSTRAINT "UserAgentAccess_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."Agent"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."UserUsageLimits" ADD CONSTRAINT "UserUsageLimits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
