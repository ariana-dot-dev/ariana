import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { useDebounce } from './useDebounce';

export interface AgentSearchResult {
  agentId: string;
  score: number;
  excerpt: string;
  excerptMatchStart: number;
  excerptMatchEnd: number;
}

interface SearchResponse {
  success: boolean;
  results?: AgentSearchResult[];
  error?: string;
}

export function useAgentSearch(searchTerm: string, projectId?: string) {
  const [results, setResults] = useState<AgentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce search term to avoid too many API calls
  const debouncedSearchTerm = useDebounce(searchTerm, 500);

  const search = useCallback(async (query: string) => {
    if (!query || query.trim().length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let url = `${API_URL}/api/agents/search?q=${encodeURIComponent(query.trim())}`;
      if (projectId) {
        url += `&projectId=${encodeURIComponent(projectId)}`;
      }
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        throw new Error('Search request failed');
      }

      const data: SearchResponse = await response.json();

      if (data.success && data.results) {
        setResults(data.results);
      } else {
        setError(data.error || 'Search failed');
        setResults([]);
      }
    } catch (err) {
      console.error('Agent search failed:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    search(debouncedSearchTerm);
  }, [debouncedSearchTerm, search]);

  // Create a map for quick lookup
  const resultsMap = new Map<string, AgentSearchResult>(
    results.map(r => [r.agentId, r])
  );

  return {
    results,
    resultsMap,
    loading,
    error,
    isSearching: searchTerm.trim().length > 0
  };
}
