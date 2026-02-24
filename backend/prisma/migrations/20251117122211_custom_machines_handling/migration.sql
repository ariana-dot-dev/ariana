/*
  Warnings:

  - Added the required column `ipv4` to the `CustomMachine` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "machineType" TEXT;

-- AlterTable
ALTER TABLE "CustomMachine" ADD COLUMN     "ipv4" TEXT NOT NULL;
