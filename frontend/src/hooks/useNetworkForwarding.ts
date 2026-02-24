import { create } from 'zustand';
import { portBridgeService, type PortInfo } from '@/services/port-bridge.service';
import { useAppStore } from '@/stores/useAppStore';
import { getTauriAPI } from '@/lib/tauri-api';
import { uploadSSHKeyAndGetIP } from '@/services/agent.service';
import { agentKeepAliveService } from '@/services/agentKeepAlive.service';

interface NetworkForwardingState {
  forwardedAgentId: string | null;
  isForwarding: boolean;
  activePorts: PortInfo[];
  /** Sticky version of activePorts – stays non-empty for a grace period after ports disappear */
  stickyActivePorts: PortInfo[];
  pollingAgentIds: Set<string>; // Track which agents are being polled

  startForwarding: (agentId: string, onPortsUpdate?: (ports: PortInfo[]) => void) => Promise<void>;
  stopForwarding: () => Promise<void>;
  startPolling: (agentId: string) => void; // Just poll ports, no tunnels
  stopPolling: (agentId: string) => void;
}

const tauriAPI = getTauriAPI();

// Grace period before stickyActivePorts goes empty after activePorts becomes []
const STICKY_PORTS_GRACE_MS = 30_000;
let stickyGraceTimer: ReturnType<typeof setTimeout> | null = null;

export const useNetworkForwarding = create<NetworkForwardingState>((set, get) => ({
  forwardedAgentId: null,
  isForwarding: false,
  activePorts: [],
  stickyActivePorts: [],
  pollingAgentIds: new Set<string>(),

  startPolling: (agentId: string) => {
    const state = get();

    // Already polling this agent
    if (state.pollingAgentIds.has(agentId)) {
      return;
    }

    // Add to polling set
    set({ pollingAgentIds: new Set([...state.pollingAgentIds, agentId]) });

    // Start polling for ports (without establishing tunnels)
    portBridgeService.startPolling(agentId, (ports: PortInfo[]) => {
      // Update active ports in state + sticky ports
      set({ activePorts: ports });

      if (ports.length > 0) {
        // Clear any pending grace timer — ports are back
        if (stickyGraceTimer) { clearTimeout(stickyGraceTimer); stickyGraceTimer = null; }
        set({ stickyActivePorts: ports });
      } else {
        // Ports went empty — start grace timer before clearing sticky
        if (!stickyGraceTimer && get().stickyActivePorts.length > 0) {
          stickyGraceTimer = setTimeout(() => {
            stickyGraceTimer = null;
            // Only clear if activePorts is still empty
            if (get().activePorts.length === 0) {
              set({ stickyActivePorts: [] });
            }
          }, STICKY_PORTS_GRACE_MS);
        }
      }
    });

    // console.log(`[NetworkForwarding] Started polling for agent ${agentId}`);
  },

  stopPolling: (agentId: string) => {
    const state = get();

    // Not polling this agent
    if (!state.pollingAgentIds.has(agentId)) {
      return;
    }

    // Don't stop polling if this agent is forwarding
    if (state.forwardedAgentId === agentId && state.isForwarding) {
      return;
    }

    // Remove from polling set
    const newSet = new Set(state.pollingAgentIds);
    newSet.delete(agentId);
    set({ pollingAgentIds: newSet });

    // Stop port polling
    portBridgeService.stopPolling(agentId);

    // console.log(`[NetworkForwarding] Stopped polling for agent ${agentId}`);
  },

  startForwarding: async (agentId: string, onPortsUpdate?: (ports: PortInfo[]) => void) => {
    const state = get();

    // Stop previous agent's forwarding if any
    if (state.forwardedAgentId && state.forwardedAgentId !== agentId) {
      // console.log(`[NetworkForwarding] Stopping forwarding for previous agent ${state.forwardedAgentId}`);
      await get().stopForwarding();
    }

    // Already forwarding this agent
    if (state.forwardedAgentId === agentId && state.isForwarding) {
      return;
    }

    // Always upload SSH key before starting forwarding to ensure key is up-to-date
    // console.log(`[NetworkForwarding] Uploading SSH key for agent ${agentId} before starting forwarding`);
    try {
      await uploadSSHKeyAndGetIP(agentId);
    } catch (error) {
      console.error(`[NetworkForwarding] Failed to upload SSH key for agent ${agentId}:`, error);
      // Continue anyway - maybe the key is already there
    }

    // Get machine IP for this agent
    const machineIp = useAppStore.getState().getMachineIP(agentId);
    if (!machineIp) {
      console.error('[NetworkForwarding] No machine IP found for agent', agentId);
      throw new Error('Machine IP not found');
    }

    // Update state immediately
    set({
      forwardedAgentId: agentId,
      isForwarding: true,
      pollingAgentIds: new Set([...state.pollingAgentIds, agentId])
    });

    // Add agent to keep-alive service
    agentKeepAliveService.addAgent(agentId);

    // Get SSH user for this agent (default to 'ariana' for backward compatibility)
    const sshUser = useAppStore.getState().getSSHUser(agentId) || 'ariana';

    // Start polling for ports and establish tunnels
    portBridgeService.startPolling(agentId, async (ports: PortInfo[]) => {
      // Update active ports in state + sticky ports
      set({ activePorts: ports });

      if (ports.length > 0) {
        if (stickyGraceTimer) { clearTimeout(stickyGraceTimer); stickyGraceTimer = null; }
        set({ stickyActivePorts: ports });
      } else {
        if (!stickyGraceTimer && get().stickyActivePorts.length > 0) {
          stickyGraceTimer = setTimeout(() => {
            stickyGraceTimer = null;
            if (get().activePorts.length === 0) {
              set({ stickyActivePorts: [] });
            }
          }, STICKY_PORTS_GRACE_MS);
        }
      }

      // Call external callback if provided
      if (onPortsUpdate) {
        onPortsUpdate(ports);
      }

      // Establish tunnel for each detected port
      for (const port of ports) {
        try {
          await tauriAPI.invoke('establish_ssh_tunnel', {
            agentId,
            machineIp,
            remotePort: port.port,
            localPort: null, // Use same port locally
            sshUser, // Pass SSH user based on access level
          });
          // console.log(`[NetworkForwarding] Tunnel established: localhost:${port.port} -> ${sshUser}@${machineIp}:${port.port}`);
        } catch (error) {
          console.error(`[NetworkForwarding] Failed to establish tunnel for port ${port.port}:`, error);
        }
      }
    });

    // console.log(`[NetworkForwarding] Started forwarding for agent ${agentId}`);
  },

  stopForwarding: async () => {
    const state = get();

    if (!state.forwardedAgentId) {
      return; // Nothing to stop
    }

    const agentId = state.forwardedAgentId;

    // Stop port polling
    portBridgeService.stopPolling(agentId);

    // Close all SSH tunnels for this agent
    try {
      await tauriAPI.invoke('close_all_tunnels_for_agent', { agentId });
      // console.log(`[NetworkForwarding] Closed all tunnels for agent ${agentId}`);
    } catch (error) {
      console.error(`[NetworkForwarding] Failed to close tunnels for agent ${agentId}:`, error);
    }

    // Remove agent from keep-alive service
    agentKeepAliveService.removeAgent(agentId);

    // Remove from polling set
    const newSet = new Set(state.pollingAgentIds);
    newSet.delete(agentId);

    // Clear sticky grace timer — forwarding was intentionally stopped
    if (stickyGraceTimer) { clearTimeout(stickyGraceTimer); stickyGraceTimer = null; }

    // Update state
    set({ forwardedAgentId: null, isForwarding: false, pollingAgentIds: newSet });

    // console.log(`[NetworkForwarding] Stopped forwarding for agent ${agentId}`);
  },
}));
