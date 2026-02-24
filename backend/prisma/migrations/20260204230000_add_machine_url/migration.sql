-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "machineUrl" TEXT;

-- AlterTable
ALTER TABLE "ParkedMachine" ADD COLUMN "url" TEXT;

-- AlterTable
ALTER TABLE "MachineReservationQueue" ADD COLUMN "assignedUrl" TEXT;
