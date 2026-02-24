import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { usePollingTrackerStore } from '@/stores/usePollingTrackerStore';

export interface PortInfo {
  port: number;
  protocol: 'tcp' | 'udp';
  pid: number;
  program: string;
  state: string;
  visibility: 'private' | 'public';
  listenAddress: string;
  isDocker: boolean;
  url?: string; // HTTPS URL via cert-gateway (e.g., https://abc-123-8000.on.ariana.dev)
}

export interface PortsResponse {
  success: boolean;
  ports: PortInfo[];
  timestamp: string;
  error?: string;
}

export class PortBridgeService {
  private pollingIntervals = new Map<string, NodeJS.Timeout>();
  private portCallbacks = new Map<string, (ports: PortInfo[]) => void>();

  /**
   * Start polling for open ports on an agent's machine
   * @param agentId - The agent ID to poll
   * @param onPortsUpdate - Callback invoked every time ports are fetched
   * @param intervalMs - Polling interval in milliseconds (default: 5000)
   */
  startPolling(
    agentId: string,
    onPortsUpdate: (ports: PortInfo[]) => void,
  ): void {
    // Stop existing polling if any
    this.stopPolling(agentId);

    // Store callback
    this.portCallbacks.set(agentId, onPortsUpdate);

    // Register polling activity
    usePollingTrackerStore.getState().registerPoll(`port-bridge-${agentId}`, `Port Bridge (${agentId.slice(0, 8)})`);

    // Initial fetch
    this.fetchPorts(agentId);

    // Set up polling
    const interval = setInterval(() => {
      this.fetchPorts(agentId);
    }, 5000);

    this.pollingIntervals.set(agentId, interval);
    // console.log('[PortBridge] Started polling for agent ' + agentId);
  }

  /**
   * Stop polling for an agent
   */
  stopPolling(agentId: string): void {
    const interval = this.pollingIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(agentId);
      this.portCallbacks.delete(agentId);
      usePollingTrackerStore.getState().unregisterPoll(`port-bridge-${agentId}`);
      // console.log(`[PortBridge] Stopped polling for agent ${agentId}`);
    }
  }

  /**
   * Stop all active polling
   */
  stopAllPolling(): void {
    for (const agentId of this.pollingIntervals.keys()) {
      this.stopPolling(agentId);
    }
  }

  /**
   * Fetch ports once (no polling)
   */
  async fetchPorts(agentId: string): Promise<PortInfo[]> {
    usePollingTrackerStore.getState().recordPollAttempt(`port-bridge-${agentId}`);
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/agents/${agentId}/ports`
      );

      if (!response.ok) {
        // Stop polling on 404 (agent gone or no access) - no point retrying
        if (response.status === 404) {
          console.warn(`[PortBridge] Agent ${agentId} not found (404), stopping polling`);
          this.stopPolling(agentId);
        }
        return [];
      }

      const data: PortsResponse = await response.json();

      if (data.success && data.ports) {
        // Filter out SSH and agents-server ports (22, 8911)
        const filteredPorts = data.ports.filter(
          (p) => p.port !== 22 && p.port !== 8911 && p.port !== 53
        );

        // Deduplicate ports by port number, preferring public interfaces (0.0.0.0 or ::)
        const portMap = new Map<number, PortInfo>();
        for (const port of filteredPorts) {
          const existing = portMap.get(port.port);
          if (!existing) {
            portMap.set(port.port, port);
          } else {
            // Prefer public-capable interfaces (0.0.0.0 or ::) over localhost
            const isPublicCapable = port.listenAddress === '0.0.0.0' || port.listenAddress === '::';
            const existingIsPublicCapable = existing.listenAddress === '0.0.0.0' || existing.listenAddress === '::';
            if (isPublicCapable && !existingIsPublicCapable) {
              portMap.set(port.port, port);
            }
            // Also prefer entries with actual program names over 'server' or 'unknown'
            else if (
              (existing.program === 'server' || existing.program === 'unknown') &&
              port.program !== 'server' && port.program !== 'unknown'
            ) {
              portMap.set(port.port, port);
            }
          }
        }
        const devPorts = Array.from(portMap.values());

        // console.log(
        //   `[PortBridge] Agent ${agentId} - Found ${devPorts.length} dev ports:`,
        //   devPorts.map(p => `${p.port}/${p.protocol} (${p.program})`).join(', ')
        // );

        // Invoke callback if registered
        const callback = this.portCallbacks.get(agentId);
        if (callback) {
          callback(devPorts);
        }

        return devPorts;
      } else {
        return [];
      }
    } catch {
      // Silently handle network errors - polling will retry
      return [];
    }
  }

  /**
   * Set port visibility (private/public)
   */
  async setPortVisibility(
    agentId: string,
    port: number,
    visibility: 'private' | 'public'
  ): Promise<boolean> {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/agents/${agentId}/ports/${port}/visibility`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ visibility }),
        }
      );

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      // console.log(`[PortBridge] Port ${port} visibility set to ${visibility}:`, data);
      return data.success;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const portBridgeService = new PortBridgeService();
