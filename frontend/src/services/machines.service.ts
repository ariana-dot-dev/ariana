import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';

export interface CustomMachine {
  id: string;
  userId: string;
  name: string;
  status: 'online' | 'offline' | 'in_use';
  os: string;
  arch: string;
  cpuCount: number;
  memoryGB: number;
  ipv4: string;
  currentAgentId?: string | null;
  currentAgent?: {
    id: string;
    name: string;
    state: string;
  } | null;
  lastSeenAt: string;
  createdAt: string;
}

export interface GenerateTokenResponse {
  success: boolean;
  token: string;
  installCommand: string;
  expiresAt: string;
}

export interface GetMachinesResponse {
  success: boolean;
  machines: CustomMachine[];
}

export interface GetMachineResponse {
  success: boolean;
  machine: CustomMachine;
}

export interface DeleteMachineResponse {
  success: boolean;
}

export class MachinesService {
  /**
   * Generate a registration token for installing agents-server on a custom machine
   */
  async generateRegistrationToken(): Promise<GenerateTokenResponse> {
    const response = await authenticatedFetch(
      `${API_URL}/api/machines/generate-registration-token`,
      {
        method: 'POST',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to generate token' }));
      throw new Error(error.error || 'Failed to generate token');
    }

    return response.json();
  }

  /**
   * Get all custom machines for the current user
   */
  async getMachines(): Promise<GetMachinesResponse> {
    const response = await authenticatedFetch(`${API_URL}/api/machines`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch machines' }));
      throw new Error(error.error || 'Failed to fetch machines');
    }

    return response.json();
  }

  /**
   * Get a specific custom machine by ID
   */
  async getMachine(machineId: string): Promise<GetMachineResponse> {
    const response = await authenticatedFetch(`${API_URL}/api/machines/${machineId}`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch machine' }));
      throw new Error(error.error || 'Failed to fetch machine');
    }

    return response.json();
  }

  /**
   * Delete a custom machine
   */
  async deleteMachine(machineId: string): Promise<DeleteMachineResponse> {
    const response = await authenticatedFetch(`${API_URL}/api/machines/${machineId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete machine' }));
      throw new Error(error.error || 'Failed to delete machine');
    }

    return response.json();
  }

  /**
   * Check health of all machines and return updated list
   */
  async checkMachinesHealth(): Promise<GetMachinesResponse> {
    const response = await authenticatedFetch(`${API_URL}/api/machines/check-health`, {
      method: 'POST',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to check machines health' }));
      throw new Error(error.error || 'Failed to check machines health');
    }

    return response.json();
  }
}

// Export singleton instance
export const machinesService = new MachinesService();
