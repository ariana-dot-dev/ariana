-- AlterTable
ALTER TABLE "PersonalEnvironment" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "PersonalEnvironment_isDefault_idx" ON "PersonalEnvironment"("isDefault");
