import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AgentWithCreator } from '@/bindings/types';
import { getProjectTemplates, type TemplateAgent } from '@/services/agent.service';
import { usePollingTrackerStore } from '@/stores/usePollingTrackerStore';

interface ProjectTemplatesStore {
  templatesByProject: Map<string, TemplateAgent[]>;
  limitsByProject: Map<string, number>;
  intervalsByProject: Map<string, number>;

  fetchTemplates: (projectId: string) => Promise<TemplateAgent[]>;
  invalidate: (projectId: string) => void;
  startPolling: (projectId: string) => void;
  stopPolling: (projectId: string) => void;
}

export const useProjectTemplatesStore = create<ProjectTemplatesStore>()(
  subscribeWithSelector((set, get) => ({
    templatesByProject: new Map(),
    limitsByProject: new Map(),
    intervalsByProject: new Map(),

    fetchTemplates: async (projectId: string) => {
      usePollingTrackerStore.getState().recordPollAttempt(`templates-${projectId}`);

      try {
        const result = await getProjectTemplates(projectId);
        if (!result.success) {
          // Stop polling on 403 (no access) - no point retrying
          if (result.status === 403) {
            console.warn(`[Templates] Access denied to project ${projectId}, stopping polling`);
            get().stopPolling(projectId);
          }
          return [];
        }

        set((state) => {
          const existing = state.templatesByProject.get(projectId) ?? [];
          if (JSON.stringify(result.templates) === JSON.stringify(existing)) return state;

          const templatesByProject = new Map(state.templatesByProject);
          templatesByProject.set(projectId, result.templates);

          const limitsByProject = new Map(state.limitsByProject);
          limitsByProject.set(projectId, result.limit);

          return { templatesByProject, limitsByProject };
        });

        return result.templates;
      } catch (err) {
        console.error('Failed to fetch templates:', err);
        return [];
      }
    },

    invalidate: (projectId: string) => {
      // Force re-fetch by clearing and fetching
      get().fetchTemplates(projectId);
    },

    startPolling: (projectId: string) => {
      // Only start if not already polling
      if (get().intervalsByProject.has(projectId)) return;

      // Initial fetch
      get().fetchTemplates(projectId);

      // Start polling (30 seconds interval)
      const intervalId = setInterval(() => {
        get().fetchTemplates(projectId);
      }, 30000) as unknown as number;

      set((state) => {
        const intervalsByProject = new Map(state.intervalsByProject);
        intervalsByProject.set(projectId, intervalId);
        return { intervalsByProject };
      });
    },

    stopPolling: (projectId: string) => {
      const intervalId = get().intervalsByProject.get(projectId);
      if (intervalId) {
        clearInterval(intervalId);
        set((state) => {
          const intervalsByProject = new Map(state.intervalsByProject);
          intervalsByProject.delete(projectId);
          return { intervalsByProject };
        });
      }
    }
  }))
);

/**
 * Hook to access project templates with automatic polling
 */
export function useProjectTemplates(projectId: string | undefined) {
  const store = useProjectTemplatesStore();
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!projectId) return;

    // Start polling when component mounts
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      store.startPolling(projectId);
    }

    // Cleanup: stop polling when component unmounts
    return () => {
      // Don't stop polling on unmount - other components might need it
      // The polling will be garbage collected when no components need it
    };
  }, [projectId]);

  const templates = projectId ? (store.templatesByProject.get(projectId) ?? []) : [];
  const limit = projectId ? (store.limitsByProject.get(projectId) ?? 10) : 10;

  return {
    templates,
    limit,
    fetchTemplates: projectId ? () => store.fetchTemplates(projectId) : () => Promise.resolve([]),
    invalidate: projectId ? () => store.invalidate(projectId) : () => {}
  };
}
