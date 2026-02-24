import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ProjectRole } from '@/bindings/types';
import { useEffect } from 'react';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

export interface Collaborator {
  userId: string;
  role: ProjectRole;
  profile: {
    name: string;
    image: string | null;
  } | null;
}

interface CollaboratorsStore {
  collaboratorsByProject: Map<string, Collaborator[]>;
  unsubsByProject: Map<string, () => void>;

  startPolling: (projectId: string) => void;
  stopPolling: (projectId: string) => void;
}

export const useProjectCollaboratorsStore = create<CollaboratorsStore>()(
  subscribeWithSelector((set, get) => ({
    collaboratorsByProject: new Map(),
    unsubsByProject: new Map(),

    startPolling: (projectId: string) => {
      if (get().unsubsByProject.has(projectId)) return;

      // Subscribe via WebSocket
      const unsub = wsService.subscribe(
        'project-collaborators',
        { projectId },
        (message: ServerMessage) => {
          let collaborators: Collaborator[] | null = null;

          if (message.type === 'snapshot') {
            const snapshotMsg = message as SnapshotMessage;
            collaborators = snapshotMsg.data?.collaborators || [];
          } else if (message.type === 'delta') {
            const deltaMsg = message as DeltaMessage;
            if (deltaMsg.data.op === 'replace' && deltaMsg.data.item?.collaborators) {
              collaborators = deltaMsg.data.item.collaborators;
            }
          }

          if (collaborators !== null) {
            set((state) => {
              const existing = state.collaboratorsByProject.get(projectId) ?? [];
              if (JSON.stringify(collaborators) === JSON.stringify(existing)) return state;

              const collaboratorsByProject = new Map(state.collaboratorsByProject);
              collaboratorsByProject.set(projectId, collaborators!);
              return { collaboratorsByProject };
            });
          }
        }
      );

      set((state) => {
        const unsubsByProject = new Map(state.unsubsByProject);
        unsubsByProject.set(projectId, unsub);
        return { unsubsByProject };
      });
    },

    stopPolling: (projectId: string) => {
      const unsub = get().unsubsByProject.get(projectId);
      if (!unsub) return;

      unsub();
      set((state) => {
        const unsubsByProject = new Map(state.unsubsByProject);
        unsubsByProject.delete(projectId);
        return { unsubsByProject };
      });
    },
  }))
);

// Stable empty array reference to avoid infinite re-renders
const EMPTY_COLLABORATORS: Collaborator[] = [];

export function useProjectCollaborators(projectId: string) {
  const collaborators = useProjectCollaboratorsStore(state =>
    state.collaboratorsByProject.get(projectId) ?? EMPTY_COLLABORATORS
  );

  useEffect(() => {
    useProjectCollaboratorsStore.getState().startPolling(projectId);
    return () => useProjectCollaboratorsStore.getState().stopPolling(projectId);
  }, [projectId]);

  return collaborators;
}
