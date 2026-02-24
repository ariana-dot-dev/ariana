import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { useAutomations } from './useAutomations';
import type { AutomationScriptLanguage, AutomationTriggerType } from '@shared/types/automation.types';

/**
 * Hook for automation editor - each field is individually reactive
 * Uses centralized automations store instead of fetching separately
 */
export function useAutomationEditorState(
  projectId: string,
  automationId: string | null
) {
  const effectiveId = automationId || 'new';

  // Get automation from centralized store (already fetched by useAutomations)
  const { automations } = useAutomations(projectId);
  const backend = useMemo(() => {
    if (!automationId) return null;
    return automations.find(a => a.id === automationId) || null;
  }, [automations, automationId]);

  // Get draft from store - read the entire map to avoid selector instability
  const automationDrafts = useAppStore(state => state.automationDrafts);
  const draft = useMemo(() => {
    return automationDrafts.get(`${projectId}|${effectiveId}`) || null;
  }, [automationDrafts, projectId, effectiveId]);

  console.log("Draft", draft)
  console.log("Backend", backend)


  // If no draft exists, use backend values (or defaults for new automation)
  const name = draft?.name ?? backend?.name ?? '';
  const triggerType = draft?.trigger.type ?? backend?.trigger.type ?? 'manual';
  const fileGlob = draft?.trigger.fileGlob ?? backend?.trigger.fileGlob ?? '';
  const commandRegex = draft?.trigger.commandRegex ?? backend?.trigger.commandRegex ?? '';
  const automationIdValue = draft?.trigger.automationId ?? backend?.trigger.automationId ?? '';
  const scriptLanguage = draft?.scriptLanguage ?? backend?.scriptLanguage ?? 'bash';
  const scriptContent = draft
    ? draft.scripts[draft.scriptLanguage]
    : backend?.scriptContent ?? generateBoilerplate('bash');

  const blocking = draft?.blocking ?? backend?.blocking ?? false;
  const feedOutput = draft?.feedOutput ?? backend?.feedOutput ?? true;

  // Update functions - write to store
  const updateName = (value: string) => {
    const store = useAppStore.getState();
    const existing = store.getAutomationDraft(projectId, effectiveId);
    store.setAutomationDraft(projectId, effectiveId, {
      name: value,
      trigger: existing?.trigger ?? { type: triggerType, fileGlob, commandRegex, automationId: automationIdValue },
      scriptLanguage: existing?.scriptLanguage ?? scriptLanguage,
      scripts: existing?.scripts ?? {
        bash: scriptLanguage === 'bash' ? scriptContent : generateBoilerplate('bash'),
        javascript: scriptLanguage === 'javascript' ? scriptContent : generateBoilerplate('javascript'),
        python: scriptLanguage === 'python' ? scriptContent : generateBoilerplate('python'),
      },
      blocking: existing?.blocking ?? blocking,
      feedOutput: existing?.feedOutput ?? feedOutput,
    });
  };

  const updateTriggerType = (value: AutomationTriggerType) => {
    const store = useAppStore.getState();
    const existing = store.getAutomationDraft(projectId, effectiveId);
    store.setAutomationDraft(projectId, effectiveId, {
      name: existing?.name ?? name,
      trigger: { ...existing?.trigger ?? {}, type: value },
      scriptLanguage: existing?.scriptLanguage ?? scriptLanguage,
      scripts: existing?.scripts ?? {
        bash: scriptLanguage === 'bash' ? scriptContent : generateBoilerplate('bash'),
        javascript: scriptLanguage === 'javascript' ? scriptContent : generateBoilerplate('javascript'),
        python: scriptLanguage === 'python' ? scriptContent : generateBoilerplate('python'),
      },
      blocking: existing?.blocking ?? blocking,
      feedOutput: existing?.feedOutput ?? feedOutput,
    });
  };

  const updateTriggerField = (field: 'fileGlob' | 'commandRegex' | 'automationId', value: string) => {
    const store = useAppStore.getState();
    const existing = store.getAutomationDraft(projectId, effectiveId);
    store.setAutomationDraft(projectId, effectiveId, {
      name: existing?.name ?? name,
      trigger: { ...existing?.trigger ?? { type: triggerType }, [field]: value },
      scriptLanguage: existing?.scriptLanguage ?? scriptLanguage,
      scripts: existing?.scripts ?? {
        bash: scriptLanguage === 'bash' ? scriptContent : generateBoilerplate('bash'),
        javascript: scriptLanguage === 'javascript' ? scriptContent : generateBoilerplate('javascript'),
        python: scriptLanguage === 'python' ? scriptContent : generateBoilerplate('python'),
      },
      blocking: existing?.blocking ?? blocking,
      feedOutput: existing?.feedOutput ?? feedOutput,
    });
  };

  const updateScriptLanguage = (value: AutomationScriptLanguage) => {
    const store = useAppStore.getState();
    const existing = store.getAutomationDraft(projectId, effectiveId);
    store.setAutomationDraft(projectId, effectiveId, {
      name: existing?.name ?? name,
      trigger: existing?.trigger ?? { type: triggerType },
      scriptLanguage: value,
      scripts: existing?.scripts ?? {
        bash: scriptLanguage === 'bash' ? scriptContent : generateBoilerplate('bash'),
        javascript: scriptLanguage === 'javascript' ? scriptContent : generateBoilerplate('javascript'),
        python: scriptLanguage === 'python' ? scriptContent : generateBoilerplate('python'),
      },
      blocking: existing?.blocking ?? blocking,
      feedOutput: existing?.feedOutput ?? feedOutput,
    });
  };

  const updateScriptContent = (value: string) => {
    const store = useAppStore.getState();
    const existing = store.getAutomationDraft(projectId, effectiveId);
    const scripts = existing?.scripts ?? {
      bash: generateBoilerplate('bash'),
      javascript: generateBoilerplate('javascript'),
      python: generateBoilerplate('python'),
    };
    const lang = existing?.scriptLanguage ?? scriptLanguage;

    store.setAutomationDraft(projectId, effectiveId, {
      name: existing?.name ?? name,
      trigger: existing?.trigger ?? { type: triggerType },
      scriptLanguage: lang,
      scripts: { ...scripts, [lang]: value },
      blocking: existing?.blocking ?? blocking,
      feedOutput: existing?.feedOutput ?? feedOutput,
    });
  };

  const updateBlocking = (value: boolean) => {
    const store = useAppStore.getState();
    const existing = store.getAutomationDraft(projectId, effectiveId);
    store.setAutomationDraft(projectId, effectiveId, {
      name: existing?.name ?? name,
      trigger: existing?.trigger ?? { type: triggerType },
      scriptLanguage: existing?.scriptLanguage ?? scriptLanguage,
      scripts: existing?.scripts ?? {
        bash: scriptLanguage === 'bash' ? scriptContent : generateBoilerplate('bash'),
        javascript: scriptLanguage === 'javascript' ? scriptContent : generateBoilerplate('javascript'),
        python: scriptLanguage === 'python' ? scriptContent : generateBoilerplate('python'),
      },
      blocking: value,
      feedOutput: existing?.feedOutput ?? feedOutput,
    });
  };

  const updateFeedOutput = (value: boolean) => {
    const store = useAppStore.getState();
    const existing = store.getAutomationDraft(projectId, effectiveId);
    store.setAutomationDraft(projectId, effectiveId, {
      name: existing?.name ?? name,
      trigger: existing?.trigger ?? { type: triggerType },
      scriptLanguage: existing?.scriptLanguage ?? scriptLanguage,
      scripts: existing?.scripts ?? {
        bash: scriptLanguage === 'bash' ? scriptContent : generateBoilerplate('bash'),
        javascript: scriptLanguage === 'javascript' ? scriptContent : generateBoilerplate('javascript'),
        python: scriptLanguage === 'python' ? scriptContent : generateBoilerplate('python'),
      },
      blocking: existing?.blocking ?? blocking,
      feedOutput: value,
    });
  };

  // Update from raw JSON - parse and set entire draft
  const updateFromRawJson = (rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson);
      const store = useAppStore.getState();

      store.setAutomationDraft(projectId, effectiveId, {
        name: parsed.name || '',
        trigger: {
          type: parsed.trigger?.type || 'manual',
          fileGlob: parsed.trigger?.fileGlob,
          commandRegex: parsed.trigger?.commandRegex,
          automationId: parsed.trigger?.automationId,
        },
        scriptLanguage: parsed.scriptLanguage || 'bash',
        scripts: {
          bash: parsed.scriptLanguage === 'bash' ? parsed.scriptContent : generateBoilerplate('bash'),
          javascript: parsed.scriptLanguage === 'javascript' ? parsed.scriptContent : generateBoilerplate('javascript'),
          python: parsed.scriptLanguage === 'python' ? parsed.scriptContent : generateBoilerplate('python'),
        },
        blocking: parsed.blocking ?? false,
        feedOutput: parsed.feedOutput ?? true,
      });
    } catch (e) {
      // Invalid JSON, ignore
    }
  };

  const save = async (onSave: (data: any) => Promise<void> | void) => {
    console.log('[useAutomationEditorState] save() called', { projectId, automationId, effectiveId, name: name.trim() });
    await onSave({
      name: name.trim(),
      trigger: { type: triggerType, fileGlob, commandRegex, automationId: automationIdValue },
      scriptLanguage,
      scriptContent,
      blocking,
      feedOutput,
    });
    console.log('[useAutomationEditorState] onSave completed, clearing draft');

    // Clear draft - the store's createAutomation/updateAutomation already refetches
    useAppStore.getState().clearAutomationDraft(projectId, effectiveId);
    console.log('[useAutomationEditorState] draft cleared');
  };

  const discard = () => {
    useAppStore.getState().clearAutomationDraft(projectId, effectiveId);
  };

  return {
    name,
    triggerType,
    fileGlob,
    commandRegex,
    automationIdValue,
    scriptLanguage,
    scriptContent,
    blocking,
    feedOutput,
    updateName,
    updateTriggerType,
    updateTriggerField,
    updateScriptLanguage,
    updateScriptContent,
    updateBlocking,
    updateFeedOutput,
    updateFromRawJson,
    save,
    discard,
  };
}

function generateBoilerplate(language: AutomationScriptLanguage): string {
  switch (language) {
    case 'bash':
      return `# Available environment variables (automatically set by the system):
# - INPUT_FILE_PATH, INPUT_COMMAND, CURRENT_COMMIT_SHA, etc.
# See "Scripts Documentation" for full list

echo "Automation running..."
`;
    case 'javascript':
      return `// All variables in 'variables' object
// See "Scripts Documentation" for full list

console.log('Automation running...');
`;
    case 'python':
      return `# All variables in 'variables' dictionary
# See "Scripts Documentation" for full list

print('Automation running...')
`;
    default:
      return '';
  }
}
