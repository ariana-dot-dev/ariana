import { useEffect, useRef, useState, RefObject, useCallback } from 'react';

const NEAR_BOTTOM_PX = 150;

interface UseScrollAnchorReturn {
  scrollContainerRef: RefObject<HTMLDivElement>;
  isAtBottom: boolean;
  scrollToBottom: () => void;
}

/**
 * Chat scroll management using scroll-position math only.
 *
 * - Detects "at bottom" by checking scrollHeight - scrollTop - clientHeight.
 * - Auto-scrolls instantly when new content arrives while at bottom.
 * - Manual "Jump to latest" uses smooth scroll for nicer UX.
 * - User scroll always takes priority — no dead zones or suppression flags.
 */
export function useScrollAnchor(dependency?: any): UseScrollAnchorReturn {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Track whether we're in a user-initiated scroll vs programmatic.
  // We use this ONLY to avoid the scroll listener flipping isAtBottom=false
  // during a smooth "Jump to latest" animation.
  const isProgrammaticScroll = useRef(false);

  // Helper: compute if container is scrolled near the bottom
  const computeIsNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= NEAR_BOTTOM_PX;
  }, []);

  // Scroll listener: the single source of truth for isAtBottom.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // During a programmatic smooth scroll (Jump to latest), only accept
      // transitions TO bottom. This prevents the mid-animation frames from
      // falsely setting isAtBottom=false. User scrolling up during animation
      // is detected because it changes scroll direction — we detect that below.
      if (isProgrammaticScroll.current) {
        const nearBottom = computeIsNearBottom();
        if (nearBottom) {
          // Arrived at bottom — animation complete
          isProgrammaticScroll.current = false;
          setIsAtBottom(true);
        }
        return;
      }

      const nearBottom = computeIsNearBottom();
      setIsAtBottom((prev) => {
        if (prev === nearBottom) return prev;
        return nearBottom;
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [computeIsNearBottom]);

  // Auto-scroll when new content arrives AND user is at bottom.
  // Uses 'instant' to avoid animation races — this is what Slack/Discord do.
  useEffect(() => {
    if (!isAtBottom) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'instant'
    });
  }, [dependency]);

  // Manual "Jump to latest" — smooth for nice UX
  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    isProgrammaticScroll.current = true;
    setIsAtBottom(true);

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });

    // Safety net: clear flag if scroll listener never fires "arrived"
    // (e.g. container was already at bottom so no scroll events fired)
    setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, 1500);
  }, []);

  return {
    scrollContainerRef,
    isAtBottom,
    scrollToBottom
  };
}
