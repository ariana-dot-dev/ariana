import { create } from 'zustand';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { useEffect } from 'react';

export interface EnvironmentSecretFile {
  path: string;
  contents: string;
}

export interface SshKeyPair {
  publicKey: string;
  privateKey: string;
  keyName: string;
}

export interface EnvironmentOwner {
  id: string;
  name: string;
  image: string | null;
}

export interface PersonalEnvironment {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  envContents: string;
  secretFiles: EnvironmentSecretFile[];
  sshKeyPair?: SshKeyPair;
  isDefault: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  automations?: any[];
  owner?: EnvironmentOwner;
}

interface EnvironmentsStore {
  environmentsByProject: Map<string, PersonalEnvironment[]>;
  fetchEnvironments: (projectId: string) => Promise<void>;
  createEnvironment: (projectId: string, data: any) => Promise<PersonalEnvironment | null>;
  updateEnvironment: (projectId: string, environmentId: string, data: any) => Promise<PersonalEnvironment | null>;
  deleteEnvironment: (projectId: string, environmentId: string) => Promise<void>;
  duplicateEnvironment: (projectId: string, environmentId: string) => Promise<PersonalEnvironment | null>;
  setDefaultEnvironment: (projectId: string, environmentId: string) => Promise<void>;
  installEnvironmentToAgent: (projectId: string, environmentId: string, agentId: string) => Promise<{ previousEnvironmentName: string | null }>;
  generateSshKey: (projectId: string) => Promise<SshKeyPair>;
}

export const useEnvironmentsStore = create<EnvironmentsStore>((set, get) => ({
  environmentsByProject: new Map(),

  fetchEnvironments: async (projectId: string) => {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/projects/${projectId}/environments`);
      if (!response.ok) return;

      const data = await response.json();
      const newEnvironments = data.environments || [];

      set((state) => {
        const existing = state.environmentsByProject.get(projectId) ?? [];
        if (JSON.stringify(newEnvironments) === JSON.stringify(existing)) return state;

        const environmentsByProject = new Map(state.environmentsByProject);
        environmentsByProject.set(projectId, newEnvironments);
        return { environmentsByProject };
      });
    } catch (error) {
      console.error('Error fetching environments:', error);
    }
  },

  createEnvironment: async (projectId: string, data: any) => {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/projects/${projectId}/environments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create environment');
      }

      const result = await response.json();
      await get().fetchEnvironments(projectId);
      return result.environment;
    } catch (error) {
      console.error('Error creating environment:', error);
      throw error;
    }
  },

  updateEnvironment: async (projectId: string, environmentId: string, data: any) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/environments/${environmentId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update environment');
      }

      const result = await response.json();
      await get().fetchEnvironments(projectId);
      return result.environment;
    } catch (error) {
      console.error('Error updating environment:', error);
      throw error;
    }
  },

  deleteEnvironment: async (projectId: string, environmentId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/environments/${environmentId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete environment');
      }

      await get().fetchEnvironments(projectId);
    } catch (error) {
      console.error('Error deleting environment:', error);
      throw error;
    }
  },

  duplicateEnvironment: async (projectId: string, environmentId: string) => {
    try {
      const environments = get().environmentsByProject.get(projectId) ?? [];
      const environment = environments.find(env => env.id === environmentId);
      if (!environment) throw new Error('Environment not found');

      return await get().createEnvironment(projectId, {
        name: `${environment.name} (copy)`,
        envContents: environment.envContents,
        secretFiles: environment.secretFiles,
        sshKeyPair: environment.sshKeyPair
      });
    } catch (error) {
      console.error('Error duplicating environment:', error);
      throw error;
    }
  },

  setDefaultEnvironment: async (projectId: string, environmentId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/environments/${environmentId}/set-default`,
        { method: 'POST' }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set default environment');
      }

      await get().fetchEnvironments(projectId);
    } catch (error) {
      console.error('Error setting default environment:', error);
      throw error;
    }
  },

  installEnvironmentToAgent: async (projectId: string, environmentId: string, agentId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/environments/${environmentId}/install`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to install environment');
      }

      const data = await response.json();
      return { previousEnvironmentName: data.previousEnvironmentName };
    } catch (error) {
      console.error('Error installing environment:', error);
      throw error;
    }
  },

  generateSshKey: async (projectId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/environments/generate-ssh-key`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate SSH key');
      }

      const data = await response.json();
      return {
        publicKey: data.publicKey,
        privateKey: data.privateKey,
        keyName: data.keyName
      };
    } catch (error) {
      console.error('Error generating SSH key:', error);
      throw error;
    }
  },
}));

const EMPTY_ARRAY: PersonalEnvironment[] = [];

export function useEnvironments(projectId: string) {
  const environments = useEnvironmentsStore(state => state.environmentsByProject.get(projectId) ?? EMPTY_ARRAY);

  useEffect(() => {
    useEnvironmentsStore.getState().fetchEnvironments(projectId);
  }, [projectId]);

  return {
    environments,
    loading: false,
    createEnvironment: (data: any) => useEnvironmentsStore.getState().createEnvironment(projectId, data),
    updateEnvironment: (id: string, data: any) => useEnvironmentsStore.getState().updateEnvironment(projectId, id, data),
    deleteEnvironment: (id: string) => useEnvironmentsStore.getState().deleteEnvironment(projectId, id),
    duplicateEnvironment: (id: string) => useEnvironmentsStore.getState().duplicateEnvironment(projectId, id),
    setDefaultEnvironment: (id: string) => useEnvironmentsStore.getState().setDefaultEnvironment(projectId, id),
    installEnvironmentToAgent: (environmentId: string, agentId: string) =>
      useEnvironmentsStore.getState().installEnvironmentToAgent(projectId, environmentId, agentId),
    generateSshKey: () => useEnvironmentsStore.getState().generateSshKey(projectId),
    refetch: () => useEnvironmentsStore.getState().fetchEnvironments(projectId),
  };
}
