/*
  Warnings:

  - You are about to drop the column `contents` on the `PersonalEnvironment` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PersonalEnvironment" DROP COLUMN "contents",
ADD COLUMN     "envContents" TEXT NOT NULL DEFAULT '';

-- CreateTable for EnvironmentSecretFile
CREATE TABLE "EnvironmentSecretFile" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "contents" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "EnvironmentSecretFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvironmentSecretFile_environmentId_idx" ON "EnvironmentSecretFile"("environmentId");

-- CreateIndex
CREATE INDEX "EnvironmentSecretFile_createdAt_idx" ON "EnvironmentSecretFile"("createdAt");

-- AddForeignKey
ALTER TABLE "EnvironmentSecretFile" ADD CONSTRAINT "EnvironmentSecretFile_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "PersonalEnvironment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Data Migration: Move PersonalSecretFile data into EnvironmentSecretFile
-- For each user+project combo with secrets, create a default environment if it doesn't exist
DO $$
DECLARE
    secret_record RECORD;
    default_env_id TEXT;
BEGIN
    -- Loop through all PersonalSecretFile records
    FOR secret_record IN
        SELECT DISTINCT "projectId", "userId"
        FROM "PersonalSecretFile"
    LOOP
        -- Check if default environment exists for this user+project
        SELECT "id" INTO default_env_id
        FROM "PersonalEnvironment"
        WHERE "projectId" = secret_record."projectId"
          AND "userId" = secret_record."userId"
          AND "isDefault" = true;

        -- If no default environment exists, create one
        IF default_env_id IS NULL THEN
            default_env_id := gen_random_uuid()::text;

            INSERT INTO "PersonalEnvironment" (
                "id", "projectId", "userId", "name", "envContents", "isDefault", "createdAt", "updatedAt"
            ) VALUES (
                default_env_id,
                secret_record."projectId",
                secret_record."userId",
                'Default',
                '',
                true,
                NOW(),
                NOW()
            );
        END IF;

        -- Move all PersonalSecretFile records for this user+project to EnvironmentSecretFile
        INSERT INTO "EnvironmentSecretFile" (
            "id", "environmentId", "path", "contents", "createdAt", "updatedAt"
        )
        SELECT
            "id",
            default_env_id,
            "path",
            "contents",
            "createdAt",
            "updatedAt"
        FROM "PersonalSecretFile"
        WHERE "projectId" = secret_record."projectId"
          AND "userId" = secret_record."userId";
    END LOOP;
END $$;

-- Drop PersonalSecretFile table
DROP TABLE "PersonalSecretFile";
