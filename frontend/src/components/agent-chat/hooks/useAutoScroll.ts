import { useState, useEffect, useRef, RefObject } from 'react';

interface UseAutoScrollReturn {
  scrollRef: RefObject<HTMLDivElement>;
  shouldAutoScroll: boolean;
  setShouldAutoScroll: (value: boolean) => void;
}

export function useAutoScroll(dependency?: any): UseAutoScrollReturn {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Auto-scroll effect when new messages arrive
  useEffect(() => {
    if (!shouldAutoScroll || !scrollRef.current) return;

    scrollRef.current.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [dependency, shouldAutoScroll]);

  // Handle scroll position tracking
  useEffect(() => {
    if (!scrollRef.current) return;

    const handleScroll = () => {
      const element = scrollRef.current;
      if (!element) return;

      const { scrollTop, scrollHeight, clientHeight } = element;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      // If user scrolls up more than 200px from bottom, disable auto-scroll
      if (distanceFromBottom > 200) {
        setShouldAutoScroll(false);
      }
      // If user scrolls back to within 200px of bottom, re-enable auto-scroll
      else if (distanceFromBottom <= 200) {
        setShouldAutoScroll(true);
      }
    };

    const element = scrollRef.current;
    element.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      element?.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return {
    scrollRef,
    shouldAutoScroll,
    setShouldAutoScroll
  };
}