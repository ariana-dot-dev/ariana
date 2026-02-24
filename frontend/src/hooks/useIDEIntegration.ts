import { useEffect } from 'react';
import { getTauriAPI } from '@/lib/tauri-api';
import { useAppStore, type AvailableIDE } from '@/stores/useAppStore';
import { openUrl } from '@tauri-apps/plugin-opener';
import { posthog } from '@/lib/posthog';

const tauriAPI = getTauriAPI();

// Re-export the type for consumers
export type { AvailableIDE };

// Module-level promise to prevent concurrent fetches
let fetchPromise: Promise<void> | null = null;

export function useIDEIntegration(projectId: string) {
  const availableIDEs = useAppStore(state => state.availableIDEs);
  const availableIDEsLoaded = useAppStore(state => state.availableIDEsLoaded);
  const setAvailableIDEs = useAppStore(state => state.setAvailableIDEs);
  const preferredIDE = useAppStore(state => state.getPreferredIDE(projectId));
  const setPreferredIDE = useAppStore(state => state.setPreferredIDE);

  useEffect(() => {
    // Already loaded, nothing to do
    if (availableIDEsLoaded) return;

    // Already fetching, wait for it
    if (fetchPromise) return;

    // Start fetch
    fetchPromise = (async () => {
      try {
        const ides = await tauriAPI.invoke<AvailableIDE[]>('get_available_ides');
        setAvailableIDEs(ides.filter(ide => ide.isAvailable));
      } catch (error) {
        console.error('[IDEIntegration] Failed to load available IDEs:', error);
        setAvailableIDEs([]);
      } finally {
        fetchPromise = null;
      }
    })();
  }, [availableIDEsLoaded, setAvailableIDEs]);

  const loading = !availableIDEsLoaded;

  const openInIDE = async (localPath: string, ideId?: string) => {
    const targetIDE = ideId || preferredIDE;

    if (!targetIDE) {
      console.error('[IDEIntegration] No IDE specified');
      return false;
    }

    try {
      posthog.capture('project_opened_in_ide', {
        project_id: projectId,
        ide_id: targetIDE,
        is_preferred_ide: targetIDE === preferredIDE,
        is_new_selection: Boolean(ideId)
      });

      const url = await tauriAPI.invoke<string>('get_ide_url', {
        path: localPath,
        ideId: targetIDE
      });

      await openUrl(url);

      // Save preference if this was a selection
      if (ideId) {
        setPreferredIDE(projectId, ideId);
      }

      console.log(`[IDEIntegration] Opened ${localPath} in ${targetIDE}`);

      posthog.capture('project_opened_in_ide_success', {
        project_id: projectId,
        ide_id: targetIDE
      });

      return true;
    } catch (error) {
      console.error(`[IDEIntegration] Failed to open in IDE ${targetIDE}:`, error);
      posthog.capture('project_opened_in_ide_failed', {
        project_id: projectId,
        ide_id: targetIDE,
        error: error instanceof Error ? error.message : 'unknown_error'
      });
      return false;
    }
  };

  const openInIDEViaSSH = async (
    agentId: string,
    agentName: string,
    machineIP: string,
    sshUser: string,
    remotePath?: string,
    ideId?: string
  ) => {
    const targetIDE = ideId || preferredIDE;

    if (!targetIDE) {
      console.error('[IDEIntegration] No IDE specified for SSH');
      return false;
    }

    try {
      posthog.capture('project_opened_in_ide_ssh', {
        project_id: projectId,
        agent_id: agentId,
        ide_id: targetIDE,
        is_preferred_ide: targetIDE === preferredIDE,
        is_new_selection: Boolean(ideId)
      });

      const url = await tauriAPI.invoke<string>('get_ide_ssh_url', {
        agentId,
        agentName,
        machineIp: machineIP,
        sshUser,
        ideId: targetIDE,
        remotePath: remotePath || undefined
      });

      await openUrl(url);

      // Save preference if this was a selection
      if (ideId) {
        setPreferredIDE(projectId, ideId);
      }

      console.log(`[IDEIntegration] Opened SSH remote in ${targetIDE} for agent ${agentId}`);

      posthog.capture('project_opened_in_ide_ssh_success', {
        project_id: projectId,
        agent_id: agentId,
        ide_id: targetIDE
      });

      return true;
    } catch (error) {
      console.error(`[IDEIntegration] Failed to open in IDE via SSH ${targetIDE}:`, error);
      posthog.capture('project_opened_in_ide_ssh_failed', {
        project_id: projectId,
        agent_id: agentId,
        ide_id: targetIDE,
        error: error instanceof Error ? error.message : 'unknown_error'
      });
      throw error; // Re-throw so caller can handle the error message
    }
  };

  const preferredIDEInfo = availableIDEs.find(ide => ide.id === preferredIDE);

  return {
    availableIDEs,
    loading,
    preferredIDE,
    preferredIDEInfo,
    openInIDE,
    openInIDEViaSSH,
    setPreferredIDE: (ideId: string) => setPreferredIDE(projectId, ideId)
  };
}
