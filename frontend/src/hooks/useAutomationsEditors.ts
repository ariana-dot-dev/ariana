import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useAutomations } from './useAutomations';

/**
 * Hook for tabs to check which automations have unsaved changes
 * Returns array of automation IDs that have unsaved changes
 */
export function useAutomationsEditors(projectId: string) {
  const { automations } = useAutomations(projectId);
  const automationDrafts = useAppStore(state => state.automationDrafts);

  const automationsWithUnsavedChanges = useMemo(() => {
    const result: string[] = [];

    // Check all drafts for this project
    automationDrafts.forEach((draft, key) => {
      const [draftProjectId, automationId] = key.split('|');
      if (draftProjectId !== projectId) return;

      // Find backend automation
      const backend = automations.find(a => a.id === automationId);

      // New automation with draft = unsaved
      if (!backend && automationId === 'new') {
        result.push(automationId);
        return;
      }

      // No backend but has draft = unsaved
      if (!backend) {
        result.push(automationId);
        return;
      }

      // Compare draft vs backend
      const activeScript = draft.scripts[draft.scriptLanguage];
      const hasChanges = (
        draft.name !== backend.name ||
        draft.trigger.type !== backend.trigger.type ||
        (draft.trigger.fileGlob || '') !== (backend.trigger.fileGlob || '') ||
        (draft.trigger.commandRegex || '') !== (backend.trigger.commandRegex || '') ||
        (draft.trigger.automationId || '') !== (backend.trigger.automationId || '') ||
        draft.scriptLanguage !== backend.scriptLanguage ||
        activeScript !== backend.scriptContent ||
        draft.blocking !== backend.blocking ||
        draft.feedOutput !== backend.feedOutput
      );

      if (hasChanges) {
        result.push(automationId);
      }
    });

    return result;
  }, [automationDrafts, automations, projectId]);

  return { automationsWithUnsavedChanges };
}
