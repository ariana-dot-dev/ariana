import { create } from 'zustand';
import { signOut } from '@/lib/auth';
import { wsService } from '@/services/websocket.service';
import type { ServerMessage, SnapshotMessage, DeltaMessage } from '@/services/websocket-protocol';

// Track the current WS unsubscribe function outside the store
let currentWsUnsubscribe: (() => void) | null = null;

interface GitHubTokenHealthState {
  // Subscription state
  isSubscribed: boolean;
  isSigningOut: boolean;

  // Last check result
  lastCheckResult: {
    hasToken: boolean;
    wasRefreshed: boolean;
  } | null;
  lastCheckTime: number | null;

  // Actions
  startPolling: () => void;
  stopPolling: () => void;
  cleanup: () => void;
}

function handleTokenHealthData(data: { hasToken: boolean; wasRefreshed: boolean }) {
  const state = useGitHubTokenHealthStore.getState();

  useGitHubTokenHealthStore.setState({
    lastCheckResult: {
      hasToken: data.hasToken,
      wasRefreshed: data.wasRefreshed
    },
    lastCheckTime: Date.now()
  });

  // If user has no token, sign them out
  if (!data.hasToken) {
    if (state.isSigningOut) return;
    useGitHubTokenHealthStore.setState({ isSigningOut: true });
    console.error('[GitHub Token Health] User has no valid GitHub token - signing out');
    state.stopPolling();
    signOut();
  }
}

export const useGitHubTokenHealthStore = create<GitHubTokenHealthState>((set, get) => ({
  // Initial state
  isSubscribed: false,
  isSigningOut: false,
  lastCheckResult: null,
  lastCheckTime: null,

  // Start subscribing
  startPolling: () => {
    const state = get();

    // If already subscribing, do nothing
    if (state.isSubscribed) {
      return;
    }

    // Subscribe via WebSocket
    currentWsUnsubscribe = wsService.subscribe(
      'github-token-health',
      {},
      (message: ServerMessage) => {
        if (message.type === 'snapshot') {
          const snapshotMsg = message as SnapshotMessage;
          if (snapshotMsg.data) {
            handleTokenHealthData(snapshotMsg.data);
          }
        } else if (message.type === 'delta') {
          const deltaMsg = message as DeltaMessage;
          if (deltaMsg.data.op === 'replace' && deltaMsg.data.item) {
            handleTokenHealthData(deltaMsg.data.item);
          }
        }
      }
    );

    set({ isSubscribed: true });
  },

  // Stop subscribing
  stopPolling: () => {
    if (currentWsUnsubscribe) {
      currentWsUnsubscribe();
      currentWsUnsubscribe = null;
    }

    set({ isSubscribed: false });
  },

  // Cleanup all state
  cleanup: () => {
    if (currentWsUnsubscribe) {
      currentWsUnsubscribe();
      currentWsUnsubscribe = null;
    }

    set({
      isSubscribed: false,
      lastCheckResult: null,
      lastCheckTime: null
    });
  }
}));
