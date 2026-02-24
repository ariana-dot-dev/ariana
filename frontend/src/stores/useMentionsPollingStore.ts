import { create } from 'zustand';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import type { GithubIssue } from '@/types/GithubIssue';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

// Track the current WS unsubscribe function outside the store
let currentWsUnsubscribe: (() => void) | null = null;

interface MentionsPollingState {
  // Currently subscribed project
  currentProjectId: string | null;

  // Subscription state
  isPolling: boolean;

  // Data cache per project
  githubIssuesCache: Map<string, GithubIssue[]>;
  repositoryNameCache: Map<string, string | null>;

  // Actions
  startPollingForProject: (projectId: string, repositoryId?: string | null) => void;
  stopPolling: () => void;
  getGithubIssues: (projectId: string) => GithubIssue[];
  getRepositoryName: (projectId: string) => string | null;
  cleanup: () => void;
}

export const useMentionsPollingStore = create<MentionsPollingState>((set, get) => ({
  // Initial state
  currentProjectId: null,
  isPolling: false,
  githubIssuesCache: new Map(),
  repositoryNameCache: new Map(),

  // Start subscribing for a specific project
  startPollingForProject: (projectId: string, repositoryId?: string | null) => {
    const state = get();

    // If already subscribing to this project, do nothing
    if (state.currentProjectId === projectId && state.isPolling) {
      return;
    }

    // Unsubscribe existing WS subscription if any
    if (currentWsUnsubscribe) {
      currentWsUnsubscribe();
      currentWsUnsubscribe = null;
    }

    // Update current project
    set({ currentProjectId: projectId });

    // Fetch repository details if we have a repositoryId (still HTTP - not a polling concern)
    if (repositoryId) {
      fetchRepositoryDetails(projectId, repositoryId);
    }

    // Subscribe via WebSocket
    currentWsUnsubscribe = wsService.subscribe(
      'project-issues',
      { projectId },
      (message: ServerMessage) => {
        if (message.type === 'snapshot') {
          const snapshotMsg = message as SnapshotMessage;
          const issues = snapshotMsg.data?.issues || [];
          const currentState = get();
          const newCache = new Map(currentState.githubIssuesCache);
          newCache.set(projectId, issues);
          set({ githubIssuesCache: newCache });
        } else if (message.type === 'delta') {
          const deltaMsg = message as DeltaMessage;
          if (deltaMsg.data.op === 'replace' && deltaMsg.data.item?.issues) {
            const currentState = get();
            const newCache = new Map(currentState.githubIssuesCache);
            newCache.set(projectId, deltaMsg.data.item.issues);
            set({ githubIssuesCache: newCache });
          }
        }
      }
    );

    set({ isPolling: true });
  },

  // Stop subscribing
  stopPolling: () => {
    if (currentWsUnsubscribe) {
      currentWsUnsubscribe();
      currentWsUnsubscribe = null;
    }

    set({
      isPolling: false,
      currentProjectId: null
    });
  },

  // Get GitHub issues from cache
  getGithubIssues: (projectId: string) => {
    return get().githubIssuesCache.get(projectId) || [];
  },

  // Get repository name from cache
  getRepositoryName: (projectId: string) => {
    return get().repositoryNameCache.get(projectId) || null;
  },

  // Cleanup all state
  cleanup: () => {
    if (currentWsUnsubscribe) {
      currentWsUnsubscribe();
      currentWsUnsubscribe = null;
    }

    set({
      currentProjectId: null,
      isPolling: false,
      githubIssuesCache: new Map(),
      repositoryNameCache: new Map()
    });
  }
}));

// Repository details still fetched via HTTP (one-time, not polled)
async function fetchRepositoryDetails(projectId: string, repositoryId: string) {
  try {
    const response = await authenticatedFetch(
      `${API_URL}/api/repositories/${repositoryId}`
    );

    if (response.ok) {
      const data = await response.json();
      const fullName = data.repository?.fullName || null;

      const state = useMentionsPollingStore.getState();
      const newCache = new Map(state.repositoryNameCache);
      newCache.set(projectId, fullName);
      useMentionsPollingStore.setState({ repositoryNameCache: newCache });
    }
  } catch (error) {
    console.error('Failed to fetch repository details:', error);
  }
}
