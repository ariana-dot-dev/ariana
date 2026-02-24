import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useEnvironments } from './useEnvironments';

/**
 * Hook for tabs to check which environments have unsaved changes
 * Returns array of environment IDs that have unsaved changes
 */
export function useEnvironmentsEditors(projectId: string) {
  const { environments } = useEnvironments(projectId);
  const environmentDrafts = useAppStore(state => state.environmentDrafts);

  const environmentsWithUnsavedChanges = useMemo(() => {
    const result: string[] = [];

    // Check all drafts for this project
    environmentDrafts.forEach((draft, key) => {
      const [draftProjectId, environmentId] = key.split('|');
      if (draftProjectId !== projectId) return;

      // Find backend environment
      const backend = environments.find(e => e.id === environmentId);

      // New environment with draft = unsaved
      if (!backend && environmentId === 'new') {
        result.push(environmentId);
        return;
      }

      // No backend but has draft = unsaved
      if (!backend) {
        result.push(environmentId);
        return;
      }

      // Compare draft vs backend
      const hasChanges = (
        draft.name !== backend.name ||
        draft.envContents !== backend.envContents ||
        JSON.stringify(draft.secretFiles) !== JSON.stringify(backend.secretFiles) ||
        JSON.stringify(draft.sshKeyPair) !== JSON.stringify(backend.sshKeyPair) ||
        JSON.stringify(draft.automationIds) !== JSON.stringify(backend.automations?.map(a => a.id) || [])
      );

      if (hasChanges) {
        result.push(environmentId);
      }
    });

    return result;
  }, [environmentDrafts, environments, projectId]);

  return { environmentsWithUnsavedChanges };
}
