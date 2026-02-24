import { useMemo, useEffect } from 'react';
import { useAppStore, type ProjectWorkspace } from '@/stores/useAppStore';
import { useProjectsStore } from '@/stores/useProjectsStore';

/**
 * Hook to access projects with automatic fetching and polling.
 * Multiple components using this hook will share the same polling.
 */
export function useProjects() {
  const backendProjects = useAppStore(state => state.backendProjects);
  const localProjects = useAppStore(state => state.localProjects);
  const projectsFetchedAt = useAppStore(state => state.projectsFetchedAt);

  const subscribe = useProjectsStore(state => state.subscribe);
  const fetchProjects = useProjectsStore(state => state.fetchProjects);

  // Compute project workspaces
  const projects = useMemo<ProjectWorkspace[]>(() => {
    return useAppStore.getState().getProjectWorkspaces();
  }, [backendProjects, localProjects]);

  // Subscribe to polling on mount, unsubscribe on unmount
  useEffect(() => {
    return subscribe();
  }, [subscribe]);

  return {
    projects,
    projectsFetchedAt,
    refreshProjects: fetchProjects
  };
}
