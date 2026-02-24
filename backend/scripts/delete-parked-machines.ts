#!/usr/bin/env bun
/**
 * Delete all parked/parking machines from database and Hetzner
 *
 * Deletes machines with status "launching" or "ready"
 * Machines with status "claimed" are skipped (in use by agents)
 */

import { PrismaClient } from '../generated/prisma';
import { machineSDK } from '../agents-server/src/machineSDK';

const prisma = new PrismaClient();

async function main() {
  console.log('Finding parked machines (status: launching or ready)...\n');

  const machines = await prisma.parkedMachine.findMany({
    where: {
      status: { in: ['launching', 'ready'] }
    }
  });

  if (machines.length === 0) {
    console.log('No parked machines found');
    return;
  }

  console.log(`Found ${machines.length} parked machines:\n`);

  for (const m of machines) {
    console.log(`${m.status.padEnd(10)} ${m.machineName || 'no-name-yet'} (${m.ipv4 || 'no-ip-yet'})`);
  }

  const forceDelete = process.env.FORCE_DELETE === 'true';
  if (!forceDelete) {
    console.log('\nRun with FORCE_DELETE=true to proceed');
    return;
  }

  console.log('\nDeleting...\n');

  const batchSize = 20;
  for (let i = 0; i < machines.length; i += batchSize) {
    const batch = machines.slice(i, i + batchSize);

    await Promise.all(batch.map(async (m) => {
      const name = m.machineName || m.machineId;

      if (name) {
        try {
          await machineSDK.deleteMachine(name);
          console.log(`Deleted from Hetzner: ${name}`);
        } catch (error) {
          console.log(`Failed to delete from Hetzner: ${name} - ${(error as Error).message}`);
        }
      }

      await prisma.parkedMachine.delete({ where: { id: m.id } });
      console.log(`Deleted from DB: ${m.id}`);
    }));
  }

  console.log('\nDone');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
