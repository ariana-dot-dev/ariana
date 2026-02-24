import { create } from 'zustand';

interface PermissionsDialogStore {
  isOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  setOpen: (open: boolean) => void;
}

export const usePermissionsDialogStore = create<PermissionsDialogStore>((set) => ({
  isOpen: false,
  openDialog: () => set({ isOpen: true }),
  closeDialog: () => set({ isOpen: false }),
  setOpen: (open: boolean) => set({ isOpen: open }),
}));
