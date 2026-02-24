-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "desktopUrl" TEXT;
ALTER TABLE "Agent" ADD COLUMN "streamingToken" TEXT;
ALTER TABLE "Agent" ADD COLUMN "streamingHostId" TEXT;
ALTER TABLE "Agent" ADD COLUMN "streamingAppId" TEXT;

-- AlterTable
ALTER TABLE "ParkedMachine" ADD COLUMN "desktopUrl" TEXT;
ALTER TABLE "ParkedMachine" ADD COLUMN "streamingToken" TEXT;
ALTER TABLE "ParkedMachine" ADD COLUMN "streamingHostId" TEXT;
ALTER TABLE "ParkedMachine" ADD COLUMN "streamingAppId" TEXT;

-- AlterTable
ALTER TABLE "MachineReservationQueue" ADD COLUMN "assignedDesktopUrl" TEXT;
ALTER TABLE "MachineReservationQueue" ADD COLUMN "assignedStreamingToken" TEXT;
ALTER TABLE "MachineReservationQueue" ADD COLUMN "assignedStreamingHostId" TEXT;
ALTER TABLE "MachineReservationQueue" ADD COLUMN "assignedStreamingAppId" TEXT;
