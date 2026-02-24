-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "environmentId" TEXT;

-- CreateTable
CREATE TABLE "PersonalEnvironment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contents" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalEnvironment_projectId_idx" ON "PersonalEnvironment"("projectId");

-- CreateIndex
CREATE INDEX "PersonalEnvironment_userId_idx" ON "PersonalEnvironment"("userId");

-- CreateIndex
CREATE INDEX "PersonalEnvironment_isDefault_idx" ON "PersonalEnvironment"("isDefault");

-- CreateIndex
CREATE INDEX "PersonalEnvironment_createdAt_idx" ON "PersonalEnvironment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalEnvironment_projectId_userId_name_key" ON "PersonalEnvironment"("projectId", "userId", "name");

-- CreateIndex
CREATE INDEX "Agent_environmentId_idx" ON "Agent"("environmentId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "PersonalEnvironment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PersonalEnvironment" ADD CONSTRAINT "PersonalEnvironment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PersonalEnvironment" ADD CONSTRAINT "PersonalEnvironment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
