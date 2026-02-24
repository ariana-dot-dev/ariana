import { create } from 'zustand';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import type { AutomationConfig } from '@shared/types/automation.types';
import { useEffect } from 'react';

export interface Automation {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string | null;
  updatedAt: string | null;
  name: string;
  trigger: any;
  scriptLanguage: 'bash' | 'javascript' | 'python';
  scriptContent: string;
  blocking: boolean;
  feedOutput: boolean;
}

interface AutomationsStore {
  automationsByProject: Map<string, Automation[]>;
  fetchAutomations: (projectId: string) => Promise<void>;
  createAutomation: (projectId: string, data: AutomationConfig) => Promise<Automation | null>;
  updateAutomation: (projectId: string, automationId: string, data: AutomationConfig) => Promise<Automation | null>;
  deleteAutomation: (projectId: string, automationId: string) => Promise<void>;
  duplicateAutomation: (projectId: string, automationId: string) => Promise<Automation | null>;
  installAutomationToEnvironment: (projectId: string, automationId: string, environmentId: string) => Promise<void>;
  uninstallAutomationFromEnvironment: (projectId: string, automationId: string, environmentId: string) => Promise<void>;
  getAutomationsForEnvironment: (projectId: string, environmentId: string) => Promise<Automation[]>;
  triggerManualAutomation: (projectId: string, automationId: string, agentId: string) => Promise<void>;
  stopAutomation: (projectId: string, automationId: string, agentId: string) => Promise<void>;
  feedAutomationLogsToAgent: (projectId: string, automationId: string, agentId: string, output: string, automationName: string) => Promise<void>;
}

export const useAutomationsStore = create<AutomationsStore>((set, get) => ({
  automationsByProject: new Map(),

  fetchAutomations: async (projectId: string) => {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/projects/${projectId}/automations`);
      if (!response.ok) return;

      const data = await response.json();
      const newAutomations = data.automations || [];

      set((state) => {
        const existing = state.automationsByProject.get(projectId) ?? [];
        if (JSON.stringify(newAutomations) === JSON.stringify(existing)) return state;

        const automationsByProject = new Map(state.automationsByProject);
        automationsByProject.set(projectId, newAutomations);
        return { automationsByProject };
      });
    } catch (error) {
      console.error('Error fetching automations:', error);
    }
  },

  createAutomation: async (projectId: string, data: AutomationConfig) => {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/projects/${projectId}/automations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create automation');
      }

      const result = await response.json();
      await get().fetchAutomations(projectId);
      return result.automation;
    } catch (error) {
      console.error('Error creating automation:', error);
      throw error;
    }
  },

  updateAutomation: async (projectId: string, automationId: string, data: AutomationConfig) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/automations/${automationId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update automation');
      }

      const result = await response.json();
      await get().fetchAutomations(projectId);
      return result.automation;
    } catch (error) {
      console.error('Error updating automation:', error);
      throw error;
    }
  },

  deleteAutomation: async (projectId: string, automationId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/automations/${automationId}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete automation');
      }

      await get().fetchAutomations(projectId);
    } catch (error) {
      console.error('Error deleting automation:', error);
      throw error;
    }
  },

  duplicateAutomation: async (projectId: string, automationId: string) => {
    try {
      const automations = get().automationsByProject.get(projectId) ?? [];
      const automation = automations.find(auto => auto.id === automationId);
      if (!automation) throw new Error('Automation not found');

      return await get().createAutomation(projectId, {
        name: `${automation.name} (copy)`,
        trigger: automation.trigger,
        scriptLanguage: automation.scriptLanguage,
        scriptContent: automation.scriptContent,
        blocking: automation.blocking,
        feedOutput: automation.feedOutput
      });
    } catch (error) {
      console.error('Error duplicating automation:', error);
      throw error;
    }
  },

  installAutomationToEnvironment: async (projectId: string, automationId: string, environmentId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/automations/${automationId}/install`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ environmentId })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to install automation');
      }
    } catch (error) {
      console.error('Error installing automation:', error);
      throw error;
    }
  },

  uninstallAutomationFromEnvironment: async (projectId: string, automationId: string, environmentId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/automations/${automationId}/uninstall`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ environmentId })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to uninstall automation');
      }
    } catch (error) {
      console.error('Error uninstalling automation:', error);
      throw error;
    }
  },

  getAutomationsForEnvironment: async (projectId: string, environmentId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/environments/${environmentId}/automations`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch automations for environment');
      }

      const data = await response.json();
      return data.automations || [];
    } catch (error) {
      console.error('Error fetching automations for environment:', error);
      throw error;
    }
  },

  triggerManualAutomation: async (projectId: string, automationId: string, agentId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/automations/${automationId}/trigger`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to trigger automation');
      }
    } catch (error) {
      console.error('Error triggering manual automation:', error);
      throw error;
    }
  },

  stopAutomation: async (projectId: string, automationId: string, agentId: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/automations/${automationId}/stop`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to stop automation');
      }
    } catch (error) {
      console.error('Error stopping automation:', error);
      throw error;
    }
  },

  feedAutomationLogsToAgent: async (projectId: string, automationId: string, agentId: string, output: string, automationName: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/projects/${projectId}/automations/${automationId}/feed-to-agent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, output, automationName })
        }
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to feed logs to agent');
      }
    } catch (error) {
      console.error('Error feeding automation logs to agent:', error);
      throw error;
    }
  },
}));

const EMPTY_ARRAY: Automation[] = [];

export function useAutomations(projectId: string) {
  const automations = useAutomationsStore(state => state.automationsByProject.get(projectId) ?? EMPTY_ARRAY);

  useEffect(() => {
    useAutomationsStore.getState().fetchAutomations(projectId);
  }, [projectId]);

  return {
    automations,
    loading: false,
    createAutomation: (data: AutomationConfig) => useAutomationsStore.getState().createAutomation(projectId, data),
    updateAutomation: (id: string, data: AutomationConfig) => useAutomationsStore.getState().updateAutomation(projectId, id, data),
    deleteAutomation: (id: string) => useAutomationsStore.getState().deleteAutomation(projectId, id),
    duplicateAutomation: (id: string) => useAutomationsStore.getState().duplicateAutomation(projectId, id),
    installAutomationToEnvironment: (automationId: string, environmentId: string) =>
      useAutomationsStore.getState().installAutomationToEnvironment(projectId, automationId, environmentId),
    uninstallAutomationFromEnvironment: (automationId: string, environmentId: string) =>
      useAutomationsStore.getState().uninstallAutomationFromEnvironment(projectId, automationId, environmentId),
    getAutomationsForEnvironment: (environmentId: string) =>
      useAutomationsStore.getState().getAutomationsForEnvironment(projectId, environmentId),
    triggerManualAutomation: (automationId: string, agentId: string) =>
      useAutomationsStore.getState().triggerManualAutomation(projectId, automationId, agentId),
    stopAutomation: (automationId: string, agentId: string) =>
      useAutomationsStore.getState().stopAutomation(projectId, automationId, agentId),
    feedAutomationLogsToAgent: (automationId: string, agentId: string, output: string, automationName: string) =>
      useAutomationsStore.getState().feedAutomationLogsToAgent(projectId, automationId, agentId, output, automationName),
    refetch: () => useAutomationsStore.getState().fetchAutomations(projectId),
  };
}
