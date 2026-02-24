import { createElement } from 'react';
import { create } from 'zustand';
import { check, Update } from '@tauri-apps/plugin-updater';
import { usePollingTrackerStore } from './usePollingTrackerStore';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { routerService } from '@/services/router.service';
import { Button } from '@/components/ui/button';

interface UpdateAvailabilityState {
  // Update state
  availableUpdate: Update | null;
  lastCheckTime: number | null;

  // Dialog trigger
  shouldOpenDialog: boolean;

  // Polling state
  isPolling: boolean;
  pollingIntervalId: number | null;

  // Actions
  startPolling: () => void;
  stopPolling: () => void;
  checkNow: () => Promise<void>;
  cleanup: () => void;
  openDialog: () => void;
  closeDialog: () => void;
}

const POLLING_INTERVAL = 5 * 60 * 1000; // 5 minutes
const POLLING_KEY = 'update-availability';
const POLLING_LABEL = 'Update Availability';

export const useUpdateAvailabilityStore = create<UpdateAvailabilityState>((set, get) => ({
  // Initial state
  availableUpdate: null,
  lastCheckTime: null,
  shouldOpenDialog: false,
  isPolling: false,
  pollingIntervalId: null,

  // Start polling
  startPolling: () => {
    const state = get();

    // If already polling, do nothing
    if (state.isPolling) {
      return;
    }

    // console.log('[Update Availability] Starting update availability polling');

    // Initial check
    get().checkNow();

    // Register with polling tracker
    usePollingTrackerStore.getState().registerPoll(POLLING_KEY, POLLING_LABEL);

    // Start polling
    const intervalId = window.setInterval(() => {
      usePollingTrackerStore.getState().recordPollAttempt(POLLING_KEY);
      get().checkNow();
    }, POLLING_INTERVAL);

    set({
      isPolling: true,
      pollingIntervalId: intervalId
    });
  },

  // Stop polling
  stopPolling: () => {
    const state = get();

    if (state.pollingIntervalId !== null) {
      // console.log('[Update Availability] Stopping update availability polling');
      clearInterval(state.pollingIntervalId);
      usePollingTrackerStore.getState().unregisterPoll(POLLING_KEY);
    }

    set({
      isPolling: false,
      pollingIntervalId: null
    });
  },

  // Check for updates now
  checkNow: async () => {
    try {
      // console.log('[Update Availability] Checking for updates');

      const availableUpdate = await check();

      const previousUpdate = get().availableUpdate;
      const newUpdateDetected = !previousUpdate && availableUpdate;

      set({
        availableUpdate: availableUpdate || null,
        lastCheckTime: Date.now()
      });

      // Show toast only if this is a newly detected update
      if (newUpdateDetected && availableUpdate) {
        // console.log('[Update Availability] New update detected:', availableUpdate.version);

        toast({
          title: 'Update Available',
          description: `Version ${availableUpdate.version} is available`,
          duration: 30000,
          action: (
            <Button variant="accent" size="sm" onClick={() => {
              get().openDialog();
            }}>
                Install Update
            </Button>
          )
        });
      } else if (availableUpdate) {
        // console.log('[Update Availability] Update still available:', availableUpdate.version);
      } else {
        // console.log('[Update Availability] No updates available');
      }
    } catch (error) {
      console.error('[Update Availability] Failed to check for updates:', error);
      // Don't show error to user - updates are optional
    }
  },

  // Cleanup all state
  cleanup: () => {
    const state = get();

    if (state.pollingIntervalId !== null) {
      clearInterval(state.pollingIntervalId);
      usePollingTrackerStore.getState().unregisterPoll(POLLING_KEY);
    }

    set({
      isPolling: false,
      pollingIntervalId: null,
      availableUpdate: null,
      lastCheckTime: null,
      shouldOpenDialog: false
    });
  },

  // Open the updates dialog
  openDialog: () => {
    set({ shouldOpenDialog: true });
  },

  // Close the updates dialog
  closeDialog: () => {
    set({ shouldOpenDialog: false });
  }
}));
