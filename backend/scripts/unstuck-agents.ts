#!/usr/bin/env bun
/**
 * Script to unstuck agents that are stuck in PROVISIONING state
 *
 * This script:
 * 1. Finds all agents stuck in PROVISIONING state
 * 2. Cleans up their old reservations
 * 3. Creates new reservations to trigger provisioning
 *
 * Usage: bun run scripts/unstuck-agents.ts [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be done without making changes
 */

import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();
const isDryRun = process.argv.includes('--dry-run');

async function main() {
  if (isDryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  console.log('Starting unstuck agents script...');

  // Find all agents in PROVISIONING state
  const stuckAgents = await prisma.agent.findMany({
    where: {
      state: 'provisioning'
    }
  });

  console.log(`Found ${stuckAgents.length} agent(s) in PROVISIONING state`);

  if (stuckAgents.length === 0) {
    console.log('No stuck agents found. Exiting.');
    return;
  }

  let cleanedCount = 0;

  for (const agent of stuckAgents) {
    console.log(`\nProcessing agent ${agent.id} (${agent.name})...`);

    try {
      // Check if there's an old reservation
      const reservation = await prisma.machineReservationQueue.findUnique({
        where: { agentId: agent.id }
      });

      if (reservation) {
        console.log(`  Found reservation ${reservation.id} with status: ${reservation.status}`);

        if (!isDryRun) {
          // Delete the old reservation
          await prisma.machineReservationQueue.delete({
            where: { agentId: agent.id }
          });
          console.log('  ✓ Deleted old reservation');
        } else {
          console.log('  [DRY RUN] Would delete old reservation');
        }
      } else {
        console.log('  No existing reservation found');
      }

      if (!isDryRun) {
        // Reset the agent fields to clean state
        await prisma.agent.update({
          where: { id: agent.id },
          data: {
            machineId: null,
            machineIpv4: null,
            machineSharedKey: null,
            provisionedAt: null,
            // Keep state as 'provisioning' so the server picks it up
          }
        });
        console.log('  ✓ Reset agent fields');

        // Create a new reservation to trigger provisioning
        const newReservationId = crypto.randomUUID();
        await prisma.machineReservationQueue.create({
          data: {
            id: newReservationId,
            agentId: agent.id,
            status: 'queued',
            requestedAt: new Date()
          }
        });
        console.log(`  ✓ Created new reservation ${newReservationId}`);

      } else {
        console.log('  [DRY RUN] Would reset agent fields');
        console.log('  [DRY RUN] Would create new reservation');
      }

      cleanedCount++;
      console.log(`  ✅ Agent ${agent.id} ${isDryRun ? 'would be' : ''} unstuck successfully`);

    } catch (error) {
      console.error(`  ❌ Failed to unstuck agent ${agent.id}:`, error);
    }
  }

  console.log('\n===================================');
  console.log(`${isDryRun ? 'Would unstuck' : 'Unstuck'} ${cleanedCount}/${stuckAgents.length} agent(s)`);
  console.log('===================================\n');

  if (cleanedCount > 0 && !isDryRun) {
    console.log('✅ Success! The queue processor will automatically assign machines to these agents.');
    console.log('Monitor the logs to see agents progress from PROVISIONING → PROVISIONED → READY');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
