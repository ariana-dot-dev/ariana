import { create } from 'zustand';

interface ConnectionStore {
  showConnectionIssue: boolean;
  hideTimeout: NodeJS.Timeout | null;
  reportConnectionIssue: () => void;
  hideConnectionIssue: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  showConnectionIssue: false,
  hideTimeout: null,

  reportConnectionIssue: () => {
    const state = get();

    // Clear existing timeout
    if (state.hideTimeout) {
      clearTimeout(state.hideTimeout);
    }

    // Show notification
    set({ showConnectionIssue: true });

    // Set new timeout for 30 seconds
    const timeout = setTimeout(() => {
      set({ showConnectionIssue: false, hideTimeout: null });
    }, 30000);

    set({ hideTimeout: timeout });
  },

  hideConnectionIssue: () => {
    const state = get();
    if (state.hideTimeout) {
      clearTimeout(state.hideTimeout);
    }
    set({ showConnectionIssue: false, hideTimeout: null });
  }
}));