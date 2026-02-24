-- AlterTable
ALTER TABLE "User" ADD COLUMN     "claudeCodeRefreshToken" TEXT,
ADD COLUMN     "claudeCodeTokenExpiry" TIMESTAMP(3);
