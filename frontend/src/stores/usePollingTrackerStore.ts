import { create } from 'zustand';

export interface PollingActivity {
  key: string;
  label: string;
  lastPollTime: number;
  isActive: boolean;
}

interface PollingTrackerState {
  activities: Map<string, PollingActivity>;
  overlayVisible: boolean;

  // Actions
  registerPoll: (key: string, label: string) => void;
  unregisterPoll: (key: string) => void;
  recordPollAttempt: (key: string) => void;
  toggleOverlay: () => void;
  setOverlayVisible: (visible: boolean) => void;
}

export const usePollingTrackerStore = create<PollingTrackerState>((set, get) => ({
  activities: new Map(),
  overlayVisible: false,

  registerPoll: (key: string, label: string) => {
    set((state) => {
      const newActivities = new Map(state.activities);
      newActivities.set(key, {
        key,
        label,
        lastPollTime: 0,
        isActive: true,
      });
      return { activities: newActivities };
    });
  },

  unregisterPoll: (key: string) => {
    set((state) => {
      const newActivities = new Map(state.activities);
      const activity = newActivities.get(key);
      if (activity) {
        newActivities.set(key, { ...activity, isActive: false });
      }
      return { activities: newActivities };
    });
  },

  recordPollAttempt: (key: string) => {
    set((state) => {
      const newActivities = new Map(state.activities);
      const activity = newActivities.get(key);
      if (activity) {
        newActivities.set(key, {
          ...activity,
          lastPollTime: Date.now(),
        });
      }
      return { activities: newActivities };
    });
  },

  toggleOverlay: () => {
    set((state) => ({ overlayVisible: !state.overlayVisible }));
  },

  setOverlayVisible: (visible: boolean) => {
    set({ overlayVisible: visible });
  },
}));

// Helper function for hooks to use
export function usePollingTracker(key: string, label: string) {
  const registerPoll = usePollingTrackerStore((state) => state.registerPoll);
  const unregisterPoll = usePollingTrackerStore((state) => state.unregisterPoll);
  const recordPollAttempt = usePollingTrackerStore((state) => state.recordPollAttempt);

  return {
    onMount: () => registerPoll(key, label),
    onUnmount: () => unregisterPoll(key),
    onPoll: () => recordPollAttempt(key),
  };
}
