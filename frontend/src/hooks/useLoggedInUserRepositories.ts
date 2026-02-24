import { useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import type { GithubRepository } from '@/types/github';

export function useLoggedInUserRepositories() {
  const token = useAppStore(state => state.sessionToken);
  const repositories = useAppStore(state => state.userRepositories);
  const setUserRepositories = useAppStore(state => state.setUserRepositories);
  const isRefreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (!token || isRefreshing.current) return;

    isRefreshing.current = true;

    try {
      const url = `${API_URL}/api/github/repository/search`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to fetch repositories: ${response.status}`);
      }

      const data = await response.json();
      const newRepositories = data.repositories || [];

      // Update store with new repositories
      setUserRepositories(newRepositories);

      // Log for proof
      // console.log('User repositories loaded:');
      // console.log('N°1 repository:', newRepositories[0]?.fullName || 'None');
      // console.log('All repositories:', newRepositories.map((r: GithubRepository) => r.fullName));
    } catch (err) {
      console.error('Failed to fetch user repositories:', err);
    } finally {
      isRefreshing.current = false;
    }
  }, [token, setUserRepositories]);

  // Fetch on mount when user is logged in
  // Also refetch if repositories is empty array (could be stale from failed/slow previous fetch)
  useEffect(() => {
    if (token && !isRefreshing.current && (!repositories || repositories.length === 0)) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return {
    repositories: repositories || [],
    refresh
  };
}
