import { create } from 'zustand';
import { openUrl } from '@tauri-apps/plugin-opener';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import type { AccessLevel, CheckAccessResult } from '@/bindings/types';
import { usePollingTrackerStore } from './usePollingTrackerStore';

interface RepositoryAccessState {
  accessLevel: AccessLevel;
  repositoryFullName: string | null;
  isLoading: boolean;
  lastChecked: number;
}

interface PollingSession {
  intervalId: number;
  abortController: AbortController;
  requiredLevel: AccessLevel;
  onGranted: (result: CheckAccessResult) => void;
  onFailure: () => void;
  startTime: number;
  timeout: number;
  grantedCalled: boolean;
}

interface RepositoryAccessStore {
  // State per repository
  repositories: Map<string, RepositoryAccessState>;

  // Active polling sessions per repository
  pollingSessions: Map<string, PollingSession>;

  // Actions
  checkAccess: (repositoryId: string) => Promise<CheckAccessResult>;
  getAccess: (repositoryId: string) => RepositoryAccessState;
  startAwaitingAccess: (
    repositoryId: string,
    requiredAccessLevel: AccessLevel,
    onGranted: (result: CheckAccessResult) => void,
    timeoutSec: number,
    onFailure: () => void
  ) => () => void;
  stopAwaitingAccess: (repositoryId: string) => void;
  cleanup: () => void;
}

const accessLevels: AccessLevel[] = ['none', 'read', 'write'];

const defaultState: RepositoryAccessState = {
  accessLevel: 'none',
  repositoryFullName: null,
  isLoading: false,
  lastChecked: 0,
};

export const useRepositoryAccessStore = create<RepositoryAccessStore>((set, get) => ({
  repositories: new Map(),
  pollingSessions: new Map(),

  getAccess: (repositoryId: string) => {
    const state = get().repositories.get(repositoryId);
    return state || defaultState;
  },

  checkAccess: async (repositoryId: string) => {
    if (!repositoryId) {
      return {
        success: false,
        accessLevel: 'none' as AccessLevel,
        repositoryFullName: null,
      };
    }

    // Set loading state
    set((state) => {
      const newRepos = new Map(state.repositories);
      const current = newRepos.get(repositoryId) || defaultState;
      newRepos.set(repositoryId, { ...current, isLoading: true });
      return { repositories: newRepos };
    });

    try {
      const response = await authenticatedFetch(
        `${API_URL}/api/repositories/${repositoryId}/check-access`
      );

      if (!response.ok) {
        set((state) => {
          const newRepos = new Map(state.repositories);
          newRepos.set(repositoryId, {
            accessLevel: 'none',
            repositoryFullName: null,
            isLoading: false,
            lastChecked: Date.now(),
          });
          return { repositories: newRepos };
        });

        return {
          success: false,
          accessLevel: 'none' as AccessLevel,
          repositoryFullName: null,
        };
      }

      const data = await response.json();
      const result: CheckAccessResult = {
        success: true,
        accessLevel: data.accessLevel || 'none',
        repositoryFullName: data.repositoryFullName || null,
        repositoryId,
      };

      // Update state
      set((state) => {
        const newRepos = new Map(state.repositories);
        newRepos.set(repositoryId, {
          accessLevel: result.accessLevel,
          repositoryFullName: result.repositoryFullName,
          isLoading: false,
          lastChecked: Date.now(),
        });
        return { repositories: newRepos };
      });

      return result;
    } catch (error) {
      console.error('Failed to check repository access:', error);

      set((state) => {
        const newRepos = new Map(state.repositories);
        const current = newRepos.get(repositoryId) || defaultState;
        newRepos.set(repositoryId, { ...current, isLoading: false, lastChecked: Date.now() });
        return { repositories: newRepos };
      });

      return {
        success: false,
        accessLevel: 'none' as AccessLevel,
        repositoryFullName: null,
      };
    }
  },

  startAwaitingAccess: (
    repositoryId: string,
    requiredAccessLevel: AccessLevel,
    onGranted: (result: CheckAccessResult) => void,
    timeoutSec: number,
    onFailure: () => void
  ) => {
    // Stop any existing polling for this repository first
    get().stopAwaitingAccess(repositoryId);

    const controller = new AbortController();
    const requiredLevel = accessLevels.indexOf(requiredAccessLevel);
    const startTime = Date.now();

    // Register polling with tracker
    usePollingTrackerStore.getState().registerPoll(
      `repo-access-await-${repositoryId}`,
      `Awaiting Perms (${repositoryId.slice(0, 8)})`
    );

    // Polling function
    const poll = async () => {
      const session = get().pollingSessions.get(repositoryId);
      if (!session || session.abortController !== controller) {
        // Session was stopped or replaced
        return;
      }

      if (controller.signal.aborted) {
        return;
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutSec * 1000) {
        get().stopAwaitingAccess(repositoryId);
        onFailure();
        return;
      }

      // Record poll attempt
      usePollingTrackerStore.getState().recordPollAttempt(`repo-access-await-${repositoryId}`);

      // Check access
      const result = await get().checkAccess(repositoryId);

      // Verify session still exists and hasn't been replaced
      const currentSession = get().pollingSessions.get(repositoryId);
      if (!currentSession || currentSession.abortController !== controller || currentSession.grantedCalled) {
        return;
      }

      if (controller.signal.aborted) {
        return;
      }

      const currentLevel = accessLevels.indexOf(result.accessLevel);

      if (currentLevel >= requiredLevel) {
        // Access granted! Mark as called and cleanup
        set((state) => {
          const newSessions = new Map(state.pollingSessions);
          const session = newSessions.get(repositoryId);
          if (session) {
            session.grantedCalled = true;
            newSessions.set(repositoryId, session);
          }
          return { pollingSessions: newSessions };
        });

        get().stopAwaitingAccess(repositoryId);
        onGranted(result);
      }
    };

    // Create session
    const intervalId = window.setInterval(poll, 1000);

    const session: PollingSession = {
      intervalId,
      abortController: controller,
      requiredLevel: requiredAccessLevel,
      onGranted,
      onFailure,
      startTime,
      timeout: timeoutSec * 1000,
      grantedCalled: false,
    };

    set((state) => {
      const newSessions = new Map(state.pollingSessions);
      newSessions.set(repositoryId, session);
      return { pollingSessions: newSessions };
    });

    // Do initial check immediately
    poll();

    // Open GitHub permissions page
    const githubAppSlug = import.meta.env.VITE_GITHUB_APP_SLUG || 'ariana-ide';
    const url = `https://github.com/apps/${githubAppSlug}/installations/new`;

    // Check if running in browser or Tauri
    const isBrowser = typeof window !== 'undefined' && !('__TAURI__' in window);
    if (isBrowser) {
      window.open(url, '_blank');
    } else {
      openUrl(url);
    }

    // Return abort function
    return () => {
      get().stopAwaitingAccess(repositoryId);
    };
  },

  stopAwaitingAccess: (repositoryId: string) => {
    const session = get().pollingSessions.get(repositoryId);
    if (!session) return;

    // Clear interval
    clearInterval(session.intervalId);

    // Abort controller
    session.abortController.abort();

    // Unregister from tracker
    usePollingTrackerStore.getState().unregisterPoll(`repo-access-await-${repositoryId}`);

    // Remove session
    set((state) => {
      const newSessions = new Map(state.pollingSessions);
      newSessions.delete(repositoryId);
      return { pollingSessions: newSessions };
    });
  },

  cleanup: () => {
    const sessions = get().pollingSessions;
    sessions.forEach((_, repositoryId) => {
      get().stopAwaitingAccess(repositoryId);
    });
  },
}));
