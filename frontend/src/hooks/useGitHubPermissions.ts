import { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Installation, InstallationsResponse } from '@/bindings/types';
import { useIsBrowser } from './useIsBrowser';

interface UseGitHubPermissionsOptions {
  /**
   * Whether to fetch installations automatically on mount
   * @default true
   */
  autoFetch?: boolean;
}

interface UseGitHubPermissionsReturn {
  /** Array of GitHub App installations with repositories */
  installations: Installation[];
  /** Whether installations are currently being loaded */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
  /** Set of expanded account logins for UI state management */
  expandedSections: Set<string>;
  /** Whether a refresh is in progress */
  isRefreshing: boolean;
  /** Cached data from the last successful fetch */
  cachedData: InstallationsResponse | null;

  // Actions
  /** Fetch installations from GitHub (with optional force refresh) */
  fetchInstallations: (forceRefresh?: boolean) => Promise<void>;
  /** Toggle expansion state of an account section */
  toggleSection: (accountLogin: string) => void;
  /** Open GitHub App permissions page to change permissions */
  openChangePermissions: () => Promise<void>;
  /** Clear all state and refetch */
  refresh: () => Promise<void>;
}

/**
 * Hook for managing GitHub App permissions and installations
 *
 * Features:
 * - Fetches grouped GitHub App installations with repositories
 * - Caches data to avoid unnecessary API calls
 * - Supports force refresh
 * - Manages UI state for expanded/collapsed sections
 * - Provides helper to open GitHub permissions page
 *
 * @example
 * ```tsx
 * const { installations, loading, error, fetchInstallations, openChangePermissions } = useGitHubPermissions();
 *
 * if (loading) return <Spinner />;
 * if (error) return <Error message={error} />;
 *
 * return (
 *   <div>
 *     <Button onClick={openChangePermissions}>Change Permissions</Button>
 *     <Button onClick={() => fetchInstallations(true)}>Refresh</Button>
 *     {installations.map(install => <InstallationCard key={install.accountLogin} installation={install} />)}
 *   </div>
 * );
 * ```
 */
export function useGitHubPermissions(options: UseGitHubPermissionsOptions = {}): UseGitHubPermissionsReturn {
  const { autoFetch = true } = options;

  const [installations, setInstallations] = useState<Installation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [cachedData, setCachedData] = useState<InstallationsResponse | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isBrowser = useIsBrowser();

  const fetchInstallations = useCallback(async (forceRefresh = false) => {
    try {
      if (!forceRefresh && cachedData) {
        // Use cached data
        setInstallations(cachedData.installations);
        // Keep sections closed by default (empty set)
        setExpandedSections(new Set());
        return;
      }

      setLoading(!forceRefresh);
      setIsRefreshing(forceRefresh);
      setError(null);

      const response = await authenticatedFetch(`${API_URL}/api/github/grouped-installations`);

      if (!response.ok) {
        throw new Error(`Failed to fetch installations: ${response.status}`);
      }

      const data: InstallationsResponse = await response.json();
      // Cache the data
      setCachedData(data);
      setInstallations(data.installations);

      // Keep all sections closed by default
      setExpandedSections(new Set());

    } catch (err) {
      console.error('Error fetching grouped installations:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch installations');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [cachedData]);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    console.log("F")
    if (autoFetch) {
      fetchInstallations();
    }
  }, [autoFetch]); // Only run once on mount

  const toggleSection = useCallback((accountLogin: string) => {
    setExpandedSections(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(accountLogin)) {
        newExpanded.delete(accountLogin);
      } else {
        newExpanded.add(accountLogin);
      }
      return newExpanded;
    });
  }, []);

  const openChangePermissions = useCallback(async () => {
    const githubAppSlug = import.meta.env.VITE_GITHUB_APP_SLUG || 'ariana-ide';
    const url = `https://github.com/apps/${githubAppSlug}/installations/new`;

    if (isBrowser) {
      window.open(url, '_blank');
    } else {
      await openUrl(url);
    }
  }, [isBrowser]);

  const refresh = useCallback(async () => {
    await fetchInstallations(true);
  }, [fetchInstallations]);

  return {
    installations,
    loading,
    error,
    expandedSections,
    isRefreshing,
    cachedData,
    fetchInstallations,
    toggleSection,
    openChangePermissions,
    refresh
  };
}
