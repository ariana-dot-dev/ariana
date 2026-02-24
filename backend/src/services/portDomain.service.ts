import type { RepositoryContainer } from '@/data/repositories';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['portDomain', 'service']);

const CERT_GATEWAY_URL = 'https://certs.ariana.dev';

export class PortDomainService {
  constructor(
    private repositories: RepositoryContainer
  ) {}

  /**
   * Register a port subdomain via cert-gateway and track in DB.
   * Max 50 domains per agent.
   */
  async registerPortDomain(
    agentId: string,
    port: number,
    machineSubdomain: string,
    machineIp: string
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    // Check if already registered
    const existing = await this.repositories.agentPortDomains.findByAgentAndPort(agentId, port);
    if (existing) {
      return {
        success: true,
        url: existing.url || undefined,
      };
    }

    // Check limit (50 per agent)
    const count = await this.repositories.agentPortDomains.countByAgent(agentId);
    if (count >= 50) {
      return {
        success: false,
        error: `Port domain limit reached (50 max). Current: ${count}`,
      };
    }

    // Call cert-gateway
    const subdomain = `${machineSubdomain}-${port}`;
    const machineName = `${machineSubdomain}-port-${port}`;

    try {
      const response = await fetch(`${CERT_GATEWAY_URL}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Key': process.env.CERT_GATEWAY_KEY || '',
        },
        body: JSON.stringify({
          subdomain,
          target_ip: machineIp,
          port,
          machine_name: machineName,
        }),
      });

      if (!response.ok) {
        logger.error`Failed to register port domain: agentId=${agentId} port=${port} status=${response.status}`;
        return {
          success: false,
          error: `Cert-gateway error: ${response.status}`,
        };
      }

      const data = await response.json();
      const url = data.url;

      // Store in DB
      await this.repositories.agentPortDomains.create({
        agentId,
        port,
        machineName,
        subdomain,
        url: url || null,
      });

      logger.info`Registered port domain: agentId=${agentId} port=${port} url=${url}`;

      return { success: true, url };
    } catch (error) {
      logger.error`Error registering port domain: ${error}`;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Unregister a port subdomain via cert-gateway and remove from DB.
   */
  async unregisterPortDomain(
    agentId: string,
    port: number
  ): Promise<{ success: boolean; error?: string }> {
    const existing = await this.repositories.agentPortDomains.findByAgentAndPort(agentId, port);
    if (!existing) {
      return { success: true }; // Already gone
    }

    // Call cert-gateway
    try {
      const response = await fetch(`${CERT_GATEWAY_URL}/unregister`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Key': process.env.CERT_GATEWAY_KEY || '',
        },
        body: JSON.stringify({
          machine_name: existing.machineName,
        }),
      });

      if (!response.ok) {
        logger.error`Failed to unregister port domain: agentId=${agentId} port=${port} status=${response.status}`;
        return {
          success: false,
          error: `Cert-gateway error: ${response.status}`,
        };
      }

      // Remove from DB
      await this.repositories.agentPortDomains.deleteByAgentAndPort(agentId, port);

      logger.info`Unregistered port domain: agentId=${agentId} port=${port}`;

      return { success: true };
    } catch (error) {
      logger.error`Error unregistering port domain: ${error}`;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get count of port domains for an agent.
   */
  async getAgentDomainCount(agentId: string): Promise<number> {
    return this.repositories.agentPortDomains.countByAgent(agentId);
  }

  /**
   * Unregister all port domains for an agent (used on archive/delete).
   */
  async unregisterAllAgentDomains(agentId: string): Promise<void> {
    const domains = await this.repositories.agentPortDomains.findByAgent(agentId);

    for (const domain of domains) {
      try {
        await fetch(`${CERT_GATEWAY_URL}/unregister`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Key': process.env.CERT_GATEWAY_KEY || '',
          },
          body: JSON.stringify({
            machine_name: domain.machineName,
          }),
        });
      } catch (error) {
        logger.error`Failed to unregister domain during cleanup: agentId=${agentId} machineName=${domain.machineName} error=${error}`;
        // Continue with cleanup even if cert-gateway call fails
      }
    }

    // Delete all from DB
    await this.repositories.agentPortDomains.deleteByAgent(agentId);
    logger.info`Cleaned up all port domains for agent: agentId=${agentId} count=${domains.length}`;
  }
}
