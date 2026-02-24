import { useState, useEffect, useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import type { PersonalEnvironment, EnvironmentSecretFile, SshKeyPair } from '@/hooks/useEnvironments';

// Stable empty array references to avoid infinite re-renders
const EMPTY_SECRET_FILES: EnvironmentSecretFile[] = [];
const EMPTY_AUTOMATION_IDS: string[] = [];

/**
 * Hook for environment editor state management
 * Follows the same pattern as useAutomationEditorState:
 * - Draft in Zustand store is the single source of truth
 * - Backend state is fetched and used as fallback
 * - Component has no local state for draft data
 */
export function useEnvironmentEditorState(
  projectId: string,
  environmentId: string | null,
  initialEnvironment?: PersonalEnvironment
) {
  const effectiveId = environmentId || 'new';

  // Fetch backend environment
  const [backend, setBackend] = useState<PersonalEnvironment | null>(initialEnvironment || null);

  useEffect(() => {
    if (!environmentId) {
      setBackend(null);
      return;
    }

    // If we already have the environment from props, use it and don't fetch
    if (initialEnvironment && initialEnvironment.id === environmentId) {
      setBackend(initialEnvironment);
      return;
    }

    const fetchEnvironment = async () => {
      try {
        // Fetch single environment
        const response = await authenticatedFetch(`${API_URL}/api/projects/${projectId}/environments/${environmentId}`);
        if (response.ok) {
          const data = await response.json();
          setBackend(data.environment || null);
        }
      } catch (error) {
        console.error('Error fetching environment:', error);
      }
    };

    fetchEnvironment();
  }, [projectId, environmentId, initialEnvironment]);

  // Get draft from store
  const environmentDrafts = useAppStore(state => state.environmentDrafts);
  const draft = useMemo(() => {
    return environmentDrafts.get(`${projectId}|${effectiveId}`) || null;
  }, [environmentDrafts, projectId, effectiveId]);

  // Derive all values: draft ?? backend ?? defaults
  const name = draft?.name ?? backend?.name ?? '';
  const envContents = draft?.envContents ?? backend?.envContents ?? '';
  const secretFiles = draft?.secretFiles ?? backend?.secretFiles ?? EMPTY_SECRET_FILES;
  const sshKeyPair = draft?.sshKeyPair ?? backend?.sshKeyPair ?? null;
  const automationIds = draft?.automationIds ?? backend?.automations?.map(a => a.id) ?? EMPTY_AUTOMATION_IDS;

  // Helper to get existing draft or construct from current values
  const getOrCreateDraft = () => {
    const store = useAppStore.getState();
    const existing = store.getEnvironmentDraft(projectId, effectiveId);
    return existing || {
      name,
      envContents,
      secretFiles,
      sshKeyPair,
      automationIds
    };
  };

  // Update functions - write directly to draft
  const updateName = (value: string) => {
    const existing = getOrCreateDraft();
    useAppStore.getState().setEnvironmentDraft(projectId, effectiveId, {
      ...existing,
      name: value
    });
  };

  const updateEnvContents = (value: string) => {
    const existing = getOrCreateDraft();
    useAppStore.getState().setEnvironmentDraft(projectId, effectiveId, {
      ...existing,
      envContents: value
    });
  };

  const updateSecretFiles = (files: Array<{ path: string; contents: string }>) => {
    const existing = getOrCreateDraft();
    useAppStore.getState().setEnvironmentDraft(projectId, effectiveId, {
      ...existing,
      secretFiles: files
    });
  };

  const updateSshKeyPair = (keyPair: SshKeyPair | null) => {
    const existing = getOrCreateDraft();
    useAppStore.getState().setEnvironmentDraft(projectId, effectiveId, {
      ...existing,
      sshKeyPair: keyPair
    });
  };

  const updateAutomationIds = (ids: string[]) => {
    const existing = getOrCreateDraft();
    useAppStore.getState().setEnvironmentDraft(projectId, effectiveId, {
      ...existing,
      automationIds: ids
    });
  };

  // Update from raw JSON - parse and set entire draft
  const updateFromRawJson = (rawJson: string) => {
    try {
      const parsed = JSON.parse(rawJson);

      useAppStore.getState().setEnvironmentDraft(projectId, effectiveId, {
        name: parsed.name || '',
        envContents: parsed.envContents || '',
        secretFiles: parsed.secretFiles || [],
        sshKeyPair: parsed.sshKeyPair || null,
        automationIds: parsed.automations?.map((a: any) => a.id) || []
      });
    } catch (e) {
      // Invalid JSON, ignore
    }
  };

  // Save: call onSave, then clear draft (store already refetches)
  const save = async (
    onSave: (
      name: string,
      envContents: string,
      secretFiles: EnvironmentSecretFile[],
      automationIds?: string[],
      sshKeyPair?: SshKeyPair | null
    ) => Promise<void> | void
  ) => {
    await onSave(
      name.trim(),
      envContents,
      secretFiles,
      automationIds,
      sshKeyPair
    );

    // Clear draft - the store's createEnvironment/updateEnvironment already refetches
    useAppStore.getState().clearEnvironmentDraft(projectId, effectiveId);
  };

  const discard = () => {
    useAppStore.getState().clearEnvironmentDraft(projectId, effectiveId);
  };

  return {
    name,
    envContents,
    secretFiles,
    sshKeyPair,
    automationIds,
    updateName,
    updateEnvContents,
    updateSecretFiles,
    updateSshKeyPair,
    updateAutomationIds,
    updateFromRawJson,
    save,
    discard
  };
}
