-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalEnvironmentAutomation" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "PersonalEnvironmentAutomation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationEvent" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "taskId" TEXT,
    "trigger" TEXT NOT NULL,
    "output" TEXT,
    "isStartTruncated" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'running',
    "exitCode" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Automation_projectId_idx" ON "Automation"("projectId");

-- CreateIndex
CREATE INDEX "Automation_userId_idx" ON "Automation"("userId");

-- CreateIndex
CREATE INDEX "Automation_createdAt_idx" ON "Automation"("createdAt");

-- CreateIndex
CREATE INDEX "PersonalEnvironmentAutomation_environmentId_idx" ON "PersonalEnvironmentAutomation"("environmentId");

-- CreateIndex
CREATE INDEX "PersonalEnvironmentAutomation_automationId_idx" ON "PersonalEnvironmentAutomation"("automationId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalEnvironmentAutomation_environmentId_automationId_key" ON "PersonalEnvironmentAutomation"("environmentId", "automationId");

-- CreateIndex
CREATE INDEX "AutomationEvent_agentId_idx" ON "AutomationEvent"("agentId");

-- CreateIndex
CREATE INDEX "AutomationEvent_automationId_idx" ON "AutomationEvent"("automationId");

-- CreateIndex
CREATE INDEX "AutomationEvent_taskId_idx" ON "AutomationEvent"("taskId");

-- CreateIndex
CREATE INDEX "AutomationEvent_status_idx" ON "AutomationEvent"("status");

-- CreateIndex
CREATE INDEX "AutomationEvent_createdAt_idx" ON "AutomationEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PersonalEnvironmentAutomation" ADD CONSTRAINT "PersonalEnvironmentAutomation_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "PersonalEnvironment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PersonalEnvironmentAutomation" ADD CONSTRAINT "PersonalEnvironmentAutomation_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "AutomationEvent" ADD CONSTRAINT "AutomationEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "AgentPrompt"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
