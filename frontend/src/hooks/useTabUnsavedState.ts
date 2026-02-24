import { useAppStore } from '@/stores/useAppStore';
import type { BodyTab } from '@/lib/tabs';
import type { PersonalEnvironment } from '@/hooks/useEnvironments';
import type { Automation } from '@/hooks/useAutomations';

/**
 * Compute whether a tab has unsaved changes
 * This is a PURE FUNCTION, not a hook - can be called anywhere
 */
export function getTabUnsavedState(
  tab: BodyTab,
  projectId: string,
  environments: PersonalEnvironment[],
  automations: Automation[]
): boolean {
  const store = useAppStore.getState();

  // Get draft for this tab type
  let draft = null;
  if (tab.type === 'environment') {
    draft = store.getEnvironmentDraft(projectId, tab.environmentId || 'new');

    // No draft = no changes
    if (!draft) return false;

    const backend = environments.find(e => e.id === tab.environmentId);
    if (!backend) return true; // New environment with draft = has changes

    // Deep compare draft vs backend
    return (
      draft.name !== backend.name ||
      draft.envContents !== backend.envContents ||
      !deepEqualSecretFiles(draft.secretFiles, backend.secretFiles) ||
      !deepEqualSshKey(draft.sshKeyPair, backend.sshKeyPair)
    );
  }

  // Automation tabs
  if (tab.type === 'automation') {
    draft = store.getAutomationDraft(projectId, tab.automationId || 'new');

    // No draft = no changes
    if (!draft) return false;

    const backend = automations.find(a => a.id === tab.automationId);
    if (!backend) return true; // New automation with draft = has changes

    // Compare draft vs backend
    // NOTE: For automations, we only save the currently selected language to backend
    // But draft stores all 3 languages, so we only compare the active one
    const activeScript = draft.scripts[draft.scriptLanguage];

    return (
      draft.name !== backend.name ||
      draft.trigger.type !== backend.trigger.type ||
      draft.trigger.fileGlob !== (backend.trigger.fileGlob || '') ||
      draft.trigger.commandRegex !== (backend.trigger.commandRegex || '') ||
      draft.trigger.automationId !== (backend.trigger.automationId || '') ||
      draft.scriptLanguage !== backend.scriptLanguage ||
      activeScript !== backend.scriptContent ||
      draft.blocking !== backend.blocking ||
      draft.feedOutput !== backend.feedOutput
    );
  }

  return false;
}

// Helper: Deep compare secret files arrays
function deepEqualSecretFiles(
  a: Array<{ path: string; contents: string }> | undefined,
  b: Array<{ path: string; contents: string }> | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  // Sort by path for consistent comparison
  const sortedA = [...a].sort((x, y) => x.path.localeCompare(y.path));
  const sortedB = [...b].sort((x, y) => x.path.localeCompare(y.path));

  return sortedA.every((fileA, i) => {
    const fileB = sortedB[i];
    return fileA.path === fileB.path && fileA.contents === fileB.contents;
  });
}

// Helper: Deep compare SSH key pairs
function deepEqualSshKey(
  a: { publicKey: string; privateKey: string; keyName: string } | null | undefined,
  b: { publicKey: string; privateKey: string; keyName: string } | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return (
    a.publicKey === b.publicKey &&
    a.privateKey === b.privateKey &&
    a.keyName === b.keyName
  );
}
