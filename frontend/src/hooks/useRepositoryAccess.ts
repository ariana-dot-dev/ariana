import { useEffect } from 'react';
import type { AccessLevel, CheckAccessResult } from '@/bindings/types';
import { useRepositoryAccessStore } from '@/stores/useRepositoryAccessStore';

export function useRepositoryAccess(repositoryId: string | null | undefined) {
  const state = useRepositoryAccessStore((state) =>
    repositoryId ? state.getAccess(repositoryId) : null
  );
  const checkAccess = useRepositoryAccessStore((state) => state.checkAccess);
  const startAwaitingAccess = useRepositoryAccessStore((state) => state.startAwaitingAccess);

  // Initial check on mount or when repositoryId changes
  useEffect(() => {
    if (!repositoryId) return;

    // Only check if we haven't checked in the last 10 seconds
    const lastChecked = useRepositoryAccessStore.getState().getAccess(repositoryId).lastChecked;
    if (Date.now() - lastChecked > 10000) {
      checkAccess(repositoryId);
    }
  }, [repositoryId, checkAccess]);

  const openUpdatePermissionsLinkAndAwaitAccess = (
    requiredAccessLevel: AccessLevel,
    onGranted: (result: CheckAccessResult) => void,
    timeoutSec: number,
    onFailure: () => void
  ): (() => void) => {
    if (!repositoryId) {
      onFailure();
      return () => {};
    }

    return startAwaitingAccess(
      repositoryId,
      requiredAccessLevel,
      onGranted,
      timeoutSec,
      onFailure
    );
  };

  return {
    access: state?.accessLevel || 'none',
    repositoryFullName: state?.repositoryFullName || null,
    permissions: undefined, // Not implemented yet
    isLoading: state?.isLoading || false,
    openUpdatePermissionsLinkAndAwaitAccess,
    refresh: () => repositoryId ? checkAccess(repositoryId) : Promise.resolve({
      success: false,
      accessLevel: 'none' as AccessLevel,
      repositoryFullName: null,
    }),
  };
}
