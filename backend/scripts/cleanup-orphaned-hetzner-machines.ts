#!/usr/bin/env bun
/**
 * Delete orphaned machines from Hetzner
 *
 * Orphaned machines are those that exist in Hetzner but not in our database
 * (neither in Agent table nor ParkedMachine table)
 */

import { PrismaClient } from '../generated/prisma';
import { execSync } from 'child_process';
import { join } from 'path';

const prisma = new PrismaClient();

interface HetznerMachine {
  name: string;
  ip: string;
}

function listHetznerMachines(): HetznerMachine[] {
  console.log('Fetching machines from Hetzner using find-machine.sh...');

  const agentsServerDir = join(__dirname, '../agents-server');
  const scriptPath = join(agentsServerDir, 'scripts/utilities/find-machine.sh');

  const output = execSync(`bash "${scriptPath}"`, {
    cwd: agentsServerDir,
    encoding: 'utf-8',
    env: process.env
  });

  const lines = output.split('\n');
  const machines: HetznerMachine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('agents-server-')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        machines.push({
          name: parts[0],
          ip: parts[2]
        });
      }
    }
  }

  return machines;
}

async function deleteMachine(machineName: string): Promise<void> {
  const agentsServerDir = join(__dirname, '../agents-server');
  const scriptPath = join(agentsServerDir, 'scripts/utilities/delete-machine.sh');

  execSync(`bash "${scriptPath}" "${machineName}"`, {
    cwd: agentsServerDir,
    encoding: 'utf-8',
    env: process.env,
    stdio: 'pipe' // Changed from 'inherit' to allow parallel execution
  });
}

// Run deletions in parallel with concurrency limit
async function deleteInParallel(machines: HetznerMachine[], concurrency: number = 10): Promise<void> {
  const results: { name: string; success: boolean; error?: string }[] = [];

  // Process in batches
  for (let i = 0; i < machines.length; i += concurrency) {
    const batch = machines.slice(i, i + concurrency);
    console.log(`\nDeleting batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(machines.length / concurrency)} (${batch.length} machines)...`);

    const batchPromises = batch.map(async (machine) => {
      try {
        await deleteMachine(machine.name);
        console.log(`  ✓ Deleted ${machine.name}`);
        results.push({ name: machine.name, success: true });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`  ✗ Failed to delete ${machine.name}: ${errorMsg}`);
        results.push({ name: machine.name, success: false, error: errorMsg });
      }
    });

    await Promise.all(batchPromises);
  }

  // Summary
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`\nDeletion summary: ${succeeded} succeeded, ${failed} failed`);
}

async function main() {
  console.log('Starting orphaned machine cleanup...\n');

  // Get all Hetzner machines
  const hetznerMachines = listHetznerMachines();
  console.log(`Found ${hetznerMachines.length} machines in Hetzner\n`);

  // Get all machines from database
  const agents = await prisma.agent.findMany({
    where: {
      machineId: { not: null }
    },
    select: {
      machineId: true,
      name: true,
      state: true
    }
  });

  const parkedMachines = await prisma.parkedMachine.findMany({
    select: {
      machineId: true,
      machineName: true,
      status: true
    }
  });

  const dbMachineIds = new Set([
    ...agents.map(a => a.machineId).filter(Boolean),
    ...parkedMachines.map(m => m.machineId || m.machineName).filter(Boolean)
  ]) as Set<string>;

  console.log(`Found ${agents.length} agents with machines in database`);
  console.log(`Found ${parkedMachines.length} parked machines in database`);
  console.log(`Total machines in DB: ${dbMachineIds.size}\n`);

  // Find orphaned machines
  const orphanedMachines = hetznerMachines.filter(m => !dbMachineIds.has(m.name));

  if (orphanedMachines.length === 0) {
    console.log('No orphaned machines found');
  } else {
    console.log(`Found ${orphanedMachines.length} orphaned machines:\n`);
    for (const machine of orphanedMachines) {
      console.log(`  ${machine.name} (${machine.ip})`);
    }

    console.log('\nDeleting orphaned machines in parallel...');

    // Delete machines in parallel with concurrency limit to avoid rate limiting
    await deleteInParallel(orphanedMachines, 10);
  }

  console.log('\nDone');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
