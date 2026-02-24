import { wsService } from './websocket.service';

/**
 * Keep-Alive Service
 *
 * This service manages agent lifetime extension for agents that have filesync or
 * port forwarding enabled. Instead of storing this state in the database (which
 * would cause conflicts between multiple clients), we send periodic keep-alive
 * requests from the frontend with the list of agents that should stay alive.
 *
 * Benefits:
 * - Per-client, not per-agent (no conflicts between multiple logged-in devices)
 * - Automatic cleanup when app closes or computer shuts down
 * - No database storage needed for transient client-side state
 *
 * Now uses WebSocket keep-alive messages instead of HTTP POST requests.
 */
class AgentKeepAliveService {
  private interval: NodeJS.Timeout | null = null;
  private agentIds: Set<string> = new Set();
  private readonly KEEP_ALIVE_INTERVAL_MS = 30000; // 30 seconds

  /**
   * Start the keep-alive service
   * Begins sending periodic keep-alive messages via WebSocket
   */
  start(): void {
    if (this.interval) {
      return;
    }

    // Send immediately on start
    this.sendKeepAlive();

    // Then send every 30 seconds
    this.interval = setInterval(() => {
      this.sendKeepAlive();
    }, this.KEEP_ALIVE_INTERVAL_MS);
  }

  /**
   * Stop the keep-alive service
   * Stops sending periodic keep-alive messages
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Add an agent to the keep-alive list
   * This agent will be included in keep-alive messages until removed
   */
  addAgent(agentId: string): void {
    if (!this.agentIds.has(agentId)) {
      this.agentIds.add(agentId);
    }
  }

  /**
   * Remove an agent from the keep-alive list
   * This agent will no longer be included in keep-alive messages
   */
  removeAgent(agentId: string): void {
    if (this.agentIds.has(agentId)) {
      this.agentIds.delete(agentId);
    }
  }

  /**
   * Check if an agent is in the keep-alive list
   */
  hasAgent(agentId: string): boolean {
    return this.agentIds.has(agentId);
  }

  /**
   * Get the current list of agent IDs being kept alive
   */
  getAgentIds(): string[] {
    return Array.from(this.agentIds);
  }

  /**
   * Clear all agents from the keep-alive list
   */
  clear(): void {
    this.agentIds.clear();
  }

  /**
   * Send a keep-alive message via WebSocket
   * Private method called by the interval
   */
  private sendKeepAlive(): void {
    // Don't send if no agents to keep alive
    if (this.agentIds.size === 0) {
      return;
    }

    const agentIds = Array.from(this.agentIds);
    wsService.sendKeepAlive(agentIds);
  }
}

// Export a singleton instance
export const agentKeepAliveService = new AgentKeepAliveService();
