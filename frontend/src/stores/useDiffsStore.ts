import { create } from 'zustand';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';

export interface CommitInfo {
  sha: string;
  message: string;
  additions: number;
  deletions: number;
  filesChanged: number;
  patch: string;
  timestamp: number;
}

export interface DiffData {
  agentId: string; // Track which agent this diff belongs to
  totalDiff: string;
  pendingDiff?: string;
  commits: CommitInfo[];
}

interface DiffsState {
  // Diff data for the currently focused agent only
  diffData: DiffData | null;

  // Currently focused agent ID (only this agent gets polled)
  focusedAgentId: string | null;

  // Polling state
  pollingIntervalId: number | null;

  // Actions
  setFocusedAgent: (agentId: string | null) => void;
  fetchDiffsForAgent: (agentId: string) => Promise<void>;
  setDiff: (data: DiffData) => void;
}

export const useDiffsStore = create<DiffsState>((set, get) => ({
  diffData: null,
  focusedAgentId: null,
  pollingIntervalId: null,

  setFocusedAgent: (agentId: string | null) => {
    const state = get();

    // If same agent, do nothing
    if (state.focusedAgentId === agentId) {
      return;
    }

    // Clear old polling
    if (state.pollingIntervalId !== null) {
      clearInterval(state.pollingIntervalId);
    }

    // Update focused agent and clear old data
    set({ focusedAgentId: agentId, pollingIntervalId: null, diffData: null });

    // Start new polling if agent is set
    if (agentId) {
      // Initial fetch
      get().fetchDiffsForAgent(agentId);

      // Start interval (5 seconds)
      const intervalId = window.setInterval(() => {
        get().fetchDiffsForAgent(agentId);
      }, 5000);

      set({ pollingIntervalId: intervalId });
    }
  },

  fetchDiffsForAgent: async (agentId: string) => {
    const state = get();

    // Only poll if this agent is still focused
    if (state.focusedAgentId !== agentId) {
      return;
    }

    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/diffs`);

      if (!response.ok) {
        console.error('[DiffsStore] Fetch failed:', response.statusText);
        return;
      }

      const data = await response.json();

      if (data.success) {
        // Verify agent is still focused before updating
        if (get().focusedAgentId === agentId) {
          const newTotalDiff = data.totalDiff || '';
          const newPendingDiff = data.pendingDiff || '';
          const newCommits: CommitInfo[] = data.commits || [];
          const existing = get().diffData;

          // Skip update if data hasn't changed to avoid unnecessary re-renders
          if (
            existing &&
            existing.agentId === agentId &&
            existing.totalDiff === newTotalDiff &&
            (existing.pendingDiff || '') === newPendingDiff &&
            existing.commits.length === newCommits.length &&
            existing.commits.every((c, i) => c.sha === newCommits[i]?.sha && c.patch === newCommits[i]?.patch)
          ) {
            return;
          }

          set({
            diffData: {
              agentId,
              totalDiff: newTotalDiff,
              pendingDiff: newPendingDiff,
              commits: newCommits,
            }
          });
        }
      }
    } catch (error) {
      console.error('[DiffsStore] Fetch error:', error);
    }
  },

  setDiff: (data: DiffData) => {
    set({ diffData: data });
  }
}));
