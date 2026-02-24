import { create } from 'zustand';
import { useAppStore } from '@/stores/useAppStore';
import { projectService } from '@/services/project.service';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

// Track the current WS unsubscribe function outside the store
let currentWsUnsubscribe: (() => void) | null = null;

interface ProjectsStoreState {
  subscriberCount: number;

  subscribe: () => () => void;
  fetchProjects: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useProjectsStore = create<ProjectsStoreState>((set, get) => ({
  subscriberCount: 0,

  fetchProjects: async () => {
    try {
      await projectService.fetchProjects();
    } catch (error) {
      console.error('[useProjectsStore] Failed to fetch projects:', error);
    }
  },

  startPolling: () => {
    // Already subscribed
    if (currentWsUnsubscribe) return;

    // Subscribe via WebSocket
    currentWsUnsubscribe = wsService.subscribe(
      'projects-list',
      {},
      (message: ServerMessage) => {
        if (message.type === 'snapshot') {
          const snapshotMsg = message as SnapshotMessage;
          if (snapshotMsg.data?.projects) {
            useAppStore.getState().setBackendProjects(snapshotMsg.data.projects);
          }
        } else if (message.type === 'delta') {
          const deltaMsg = message as DeltaMessage;
          const delta = deltaMsg.data;
          const currentProjects = useAppStore.getState().backendProjects || [];

          switch (delta.op) {
            case 'add':
              if (delta.item) {
                useAppStore.getState().setBackendProjects([...currentProjects, delta.item]);
              }
              break;
            case 'modify':
              if (delta.itemId && delta.item) {
                useAppStore.getState().setBackendProjects(
                  currentProjects.map(p => p.id === delta.itemId ? delta.item : p)
                );
              }
              break;
            case 'delete':
              if (delta.itemId) {
                useAppStore.getState().setBackendProjects(
                  currentProjects.filter(p => p.id !== delta.itemId)
                );
              }
              break;
            case 'replace':
              if (delta.item?.projects) {
                useAppStore.getState().setBackendProjects(delta.item.projects);
              } else if (delta.items) {
                useAppStore.getState().setBackendProjects(delta.items);
              }
              break;
          }
        }
      }
    );
  },

  stopPolling: () => {
    if (currentWsUnsubscribe) {
      currentWsUnsubscribe();
      currentWsUnsubscribe = null;
    }
  },

  subscribe: () => {
    const count = get().subscriberCount + 1;
    set({ subscriberCount: count });

    if (count === 1) {
      get().startPolling();
    }

    return () => {
      const newCount = get().subscriberCount - 1;
      set({ subscriberCount: newCount });

      if (newCount === 0) {
        get().stopPolling();
      }
    };
  }
}));
