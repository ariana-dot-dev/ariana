import { RepositoryContainer } from '@/data/repositories';
import { randomBytes } from 'crypto';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['services', 'customMachine']);

export interface MachineSpecs {
  name: string;
  os: string;
  arch: string;
  cpuCount: number;
  memoryGB: number;
  ipv4: string;
  port: number; // Required - agent server port
}

export class CustomMachineService {
  constructor(private repositories: RepositoryContainer) {}

  /**
   * Generate a registration token for a user to install agents-server on their machine
   * Token is valid for 1 hour and can only be used once
   */
  async generateRegistrationToken(userId: string): Promise<{
    token: string;
    installCommand: string;
    expiresAt: Date;
  }> {
    // Generate token with amt_ prefix (Ariana Machine Token)
    const token = `amt_${randomBytes(24).toString('hex')}`;

    // Token expires in 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Create pending registration
    await this.repositories.prisma.pendingMachineRegistration.create({
      data: {
        token,
        userId,
        status: 'pending',
        expiresAt,
      },
    });

    // Build installation command - always use GitHub release install
    // Use sudo bash to ensure proper permissions on Debian/Ubuntu
    const installCommand = `curl -fsSL https://github.com/ariana-dot-dev/agent-server/releases/latest/download/install-cli.sh | sudo bash -s -- ${token}`;

    return {
      token,
      installCommand,
      expiresAt,
    };
  }

  /**
   * Register a custom machine using a registration token
   * Called by the installation script after machine specs are detected
   */
  async registerMachine(
    token: string,
    machineSpecs: MachineSpecs
  ): Promise<{
    machineId: string;
    sharedKey: string;
    config: {
      apiUrl: string;
    };
  } | null> {
    // Find and validate token
    const registration = await this.repositories.prisma.pendingMachineRegistration.findUnique({
      where: { token },
    });

    if (!registration) {
      return null;
    }

    if (registration.status !== 'pending') {
      return null;
    }

    if (new Date() > registration.expiresAt) {
      // Mark as expired
      await this.repositories.prisma.pendingMachineRegistration.update({
        where: { token },
        data: { status: 'expired' },
      });
      return null;
    }

    // Mark token as used
    await this.repositories.prisma.pendingMachineRegistration.update({
      where: { token },
      data: { status: 'used' },
    });

    // Generate machine credentials
    const machineId = `mch_${randomBytes(12).toString('hex')}`;
    const sharedKey = randomBytes(32).toString('hex');

    // Create custom machine
    await this.repositories.prisma.customMachine.create({
      data: {
        id: machineId,
        userId: registration.userId,
        name: machineSpecs.name,
        sharedKey,
        ipv4: machineSpecs.ipv4,
        port: machineSpecs.port,
        os: machineSpecs.os,
        arch: machineSpecs.arch,
        cpuCount: machineSpecs.cpuCount,
        memoryGB: machineSpecs.memoryGB,
        status: 'offline', // Will become online when service starts
      },
    });

    // Return configuration for the installation script
    return {
      machineId,
      sharedKey,
      config: {
        apiUrl: process.env.API_URL || 'https://ariana.dev',
      },
    };
  }

  /**
   * Get all custom machines for a user
   */
  async getUserMachines(userId: string) {
    return await this.repositories.prisma.customMachine.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        currentAgent: {
          select: {
            id: true,
            name: true,
            state: true,
          },
        },
      },
    });
  }

  /**
   * Get a specific custom machine by ID
   */
  async getMachine(machineId: string) {
    return await this.repositories.prisma.customMachine.findUnique({
      where: { id: machineId },
      include: {
        currentAgent: {
          select: {
            id: true,
            name: true,
            state: true,
          },
        },
      },
    });
  }

  /**
   * Update machine status (called by health check polling)
   */
  async updateMachineStatus(machineId: string, status: 'online' | 'offline' | 'in_use') {
    return await this.repositories.prisma.customMachine.update({
      where: { id: machineId },
      data: {
        status,
        lastSeenAt: new Date(),
      },
    });
  }

  /**
   * Update machine's last seen timestamp (heartbeat)
   */
  async updateLastSeen(machineId: string) {
    return await this.repositories.prisma.customMachine.update({
      where: { id: machineId },
      data: {
        lastSeenAt: new Date(),
      },
    });
  }

  /**
   * Assign an agent to a custom machine
   */
  async assignAgent(machineId: string, agentId: string) {
    return await this.repositories.prisma.customMachine.update({
      where: { id: machineId },
      data: {
        currentAgentId: agentId,
        status: 'in_use',
      },
    });
  }

  /**
   * Release an agent from a custom machine
   */
  async releaseAgent(machineId: string) {
    return await this.repositories.prisma.customMachine.update({
      where: { id: machineId },
      data: {
        currentAgentId: null,
        status: 'online',
      },
    });
  }

  /**
   * Delete a custom machine
   */
  async deleteMachine(machineId: string) {
    return await this.repositories.prisma.customMachine.delete({
      where: { id: machineId },
    });
  }

  /**
   * Verify machine ownership
   */
  async verifyOwnership(machineId: string, userId: string): Promise<boolean> {
    const machine = await this.repositories.prisma.customMachine.findUnique({
      where: { id: machineId },
      select: { userId: true },
    });

    return machine?.userId === userId;
  }

  /**
   * Get machine by shared key (for authentication)
   */
  async getMachineBySharedKey(sharedKey: string) {
    return await this.repositories.prisma.customMachine.findFirst({
      where: { sharedKey },
    });
  }

  /**
   * Find available machine for user
   * Returns a machine that is online and not currently in use
   */
  async findAvailableMachine(userId: string) {
    return await this.repositories.prisma.customMachine.findFirst({
      where: {
        userId,
        status: 'online',
        currentAgentId: null,
      },
      orderBy: {
        lastSeenAt: 'desc', // Prefer most recently seen machine
      },
    });
  }

  /**
   * Clean up expired registration tokens (can be called by a cron job)
   */
  async cleanupExpiredTokens() {
    const now = new Date();

    const result = await this.repositories.prisma.pendingMachineRegistration.updateMany({
      where: {
        status: 'pending',
        expiresAt: {
          lt: now,
        },
      },
      data: {
        status: 'expired',
      },
    });

    return result.count;
  }

  /**
   * Check health of a custom machine by pinging its /health endpoint
   * Updates machine status based on response
   */
  async checkMachineHealth(machineId: string): Promise<{
    healthy: boolean;
    responseTime?: number;
  }> {
    const machine = await this.repositories.prisma.customMachine.findUnique({
      where: { id: machineId },
    });

    if (!machine) {
      return { healthy: false };
    }

    const startTime = Date.now();
    const healthUrl = `http://${machine.ipv4}:${machine.port}/health`;

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        // Update status to online if not already in use
        await this.repositories.prisma.customMachine.update({
          where: { id: machineId },
          data: {
            status: machine.currentAgentId ? 'in_use' : 'online',
            lastSeenAt: new Date(),
          },
        });

        return { healthy: true, responseTime };
      }

      // Non-200 response, mark as offline
      logger.warn`Machine ${machineId} returned non-ok status: ${response.status}`;
      await this.repositories.prisma.customMachine.update({
        where: { id: machineId },
        data: { status: 'offline' },
      });

      return { healthy: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error`Failed to check health for machine ${machineId} at ${healthUrl}: ${errorMessage}`;

      // Network error or timeout, mark as offline
      await this.repositories.prisma.customMachine.update({
        where: { id: machineId },
        data: { status: 'offline' },
      });

      return { healthy: false };
    }
  }

  /**
   * Check health of all custom machines
   * Can be called periodically (e.g., every 30 seconds)
   */
  async checkAllMachinesHealth(): Promise<{
    total: number;
    healthy: number;
    unhealthy: number;
  }> {
    const machines = await this.repositories.prisma.customMachine.findMany();

    const results = await Promise.allSettled(
      machines.map((m) => this.checkMachineHealth(m.id))
    );

    const healthy = results.filter(
      (r) => r.status === 'fulfilled' && r.value.healthy
    ).length;

    return {
      total: machines.length,
      healthy,
      unhealthy: machines.length - healthy,
    };
  }
}
