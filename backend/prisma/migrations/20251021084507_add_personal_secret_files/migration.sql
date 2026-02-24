-- CreateTable
CREATE TABLE "PersonalSecretFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "contents" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalSecretFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalSecretFile_projectId_idx" ON "PersonalSecretFile"("projectId");

-- CreateIndex
CREATE INDEX "PersonalSecretFile_userId_idx" ON "PersonalSecretFile"("userId");

-- CreateIndex
CREATE INDEX "PersonalSecretFile_createdAt_idx" ON "PersonalSecretFile"("createdAt");

-- AddForeignKey
ALTER TABLE "PersonalSecretFile" ADD CONSTRAINT "PersonalSecretFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PersonalSecretFile" ADD CONSTRAINT "PersonalSecretFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
