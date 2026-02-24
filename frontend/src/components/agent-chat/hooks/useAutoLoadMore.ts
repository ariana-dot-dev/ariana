import { useEffect, useRef, RefObject } from 'react';

interface UseAutoLoadMoreOptions {
  scrollContainerRef: RefObject<HTMLDivElement>;
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  /**
   * Distance in pixels from top to trigger load.
   * Default: 400px
   */
  threshold?: number;
}

/**
 * Automatically loads older messages when user scrolls near the top.
 *
 * Uses a scroll listener on the scroll container. When the user scrolls
 * within `threshold` pixels of the top, triggers loadMore callback.
 *
 * Also returns a sentinelRef for backward-compatible rendering (the sentinel
 * div is kept for scroll-anchor purposes but is no longer used for detection).
 */
export function useAutoLoadMore({
  scrollContainerRef,
  hasMore,
  isLoading,
  onLoadMore,
  threshold = 400
}: UseAutoLoadMoreOptions): RefObject<HTMLDivElement> {
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Guard against calling onLoadMore multiple times before state updates
  const loadingGuard = useRef(false);

  // Reset guard when isLoading changes
  useEffect(() => {
    if (!isLoading) {
      loadingGuard.current = false;
    }
  }, [isLoading]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (!hasMore || isLoading) return;

    const handleScroll = () => {
      if (loadingGuard.current) return;
      if (container.scrollTop <= threshold) {
        loadingGuard.current = true;
        onLoadMore();
      }
    };

    // Check immediately in case already near top
    handleScroll();

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerRef, hasMore, isLoading, onLoadMore, threshold]);

  return sentinelRef;
}
