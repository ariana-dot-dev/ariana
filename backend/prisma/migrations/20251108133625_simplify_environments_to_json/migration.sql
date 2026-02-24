-- DropForeignKey
ALTER TABLE "EnvironmentSecretFile" DROP CONSTRAINT "EnvironmentSecretFile_environmentId_fkey";

-- DropIndex
DROP INDEX "PersonalEnvironment_isDefault_idx";

-- DropIndex
DROP INDEX "PersonalEnvironment_projectId_userId_name_key";

-- AlterTable
ALTER TABLE "PersonalEnvironment" DROP COLUMN "envContents",
DROP COLUMN "isDefault",
DROP COLUMN "name",
ADD COLUMN "data" TEXT NOT NULL DEFAULT '{}';

-- DropTable
DROP TABLE "EnvironmentSecretFile";
