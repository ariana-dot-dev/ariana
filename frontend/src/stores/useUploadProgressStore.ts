import { create } from 'zustand';

interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  isFullBundle?: boolean; // true if uploading full bundle (not incremental)
}

interface UploadProgressState {
  progress: Map<string, UploadProgress>; // agentId -> progress

  setProgress: (agentId: string, progress: UploadProgress) => void;
  getProgress: (agentId: string) => UploadProgress | null;
  clearProgress: (agentId: string) => void;
}

export const useUploadProgressStore = create<UploadProgressState>((set, get) => ({
  progress: new Map(),

  setProgress: (agentId: string, progress: UploadProgress) => {
    set((state) => {
      const newProgress = new Map(state.progress);
      // Preserve isFullBundle if not provided in update
      const existing = state.progress.get(agentId);
      const updatedProgress = {
        ...progress,
        isFullBundle: progress.isFullBundle ?? existing?.isFullBundle
      };
      newProgress.set(agentId, updatedProgress);
      return { progress: newProgress };
    });
  },

  getProgress: (agentId: string) => {
    return get().progress.get(agentId) || null;
  },

  clearProgress: (agentId: string) => {
    set((state) => {
      const newProgress = new Map(state.progress);
      newProgress.delete(agentId);
      return { progress: newProgress };
    });
  }
}));
