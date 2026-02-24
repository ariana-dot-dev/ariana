-- DropForeignKey
ALTER TABLE "ProjectSpecification" DROP CONSTRAINT "ProjectSpecification_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectSpecification" DROP CONSTRAINT "ProjectSpecification_userId_fkey";

-- AlterTable
ALTER TABLE "UserLimits" DROP COLUMN "maxSpecificationsPer24Hours",
DROP COLUMN "maxSpecificationsPerMinute",
DROP COLUMN "maxSpecificationsTotal";

-- AlterTable
ALTER TABLE "UserUsage" DROP COLUMN "specificationsLast24Hours",
DROP COLUMN "specificationsLastMinute",
DROP COLUMN "specificationsTotal";

-- DropTable
DROP TABLE "ProjectSpecification";
