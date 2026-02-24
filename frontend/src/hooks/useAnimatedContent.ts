import { useState, useRef, useEffect } from 'react';

const BASE_CHARS_PER_MS = 1.0; // ~1000 chars/sec
const MAX_ANIMATION_MS = 1500; // Cap animation at 1.5s for large content
const MIN_FRAME_MS = 32; // ~30fps to avoid excessive Markdown re-parses

/**
 * Hook that animates content reveal with a typewriter effect.
 *
 * - Streaming messages: smoothly reveals each new delta as it arrives.
 * - Recent non-streaming messages (< 5s old): typewriter reveals full content on mount.
 * - Old messages (loaded from history): shown immediately, no animation.
 */
export function useAnimatedContent(
  content: string,
  isStreaming: boolean,
  eventTimestamp: number,
): string {
  const isRecentOnMount = useRef(Date.now() - eventTimestamp < 5000);

  const [displayed, setDisplayed] = useState(() => {
    // Streaming: show whatever content exists on mount (animate only future deltas)
    if (isStreaming) return content;
    // Recent non-streaming: start empty for full typewriter reveal
    if (isRecentOnMount.current) return '';
    // Old message: show immediately
    return content;
  });

  const displayedLenRef = useRef(
    (isStreaming || !isRecentOnMount.current) ? content.length : 0,
  );
  const targetRef = useRef(content);
  const rafRef = useRef<number>(0);
  const animatingRef = useRef(false);
  const lastTimeRef = useRef(0);
  const speedRef = useRef(BASE_CHARS_PER_MS);

  // Always keep target in sync so the animation loop sees the latest content
  targetRef.current = content;

  useEffect(() => {
    const currentLen = displayedLenRef.current;

    // Content didn't grow (same length or shrank, e.g. finalization) → show immediately
    if (content.length <= currentLen) {
      displayedLenRef.current = content.length;
      setDisplayed(content);
      cancelAnimationFrame(rafRef.current);
      animatingRef.current = false;
      return;
    }

    // Decide whether to animate this update
    const shouldAnimate = isStreaming || isRecentOnMount.current;
    // Consume the flag so reloaded/old messages won't re-animate
    isRecentOnMount.current = false;

    if (!shouldAnimate) {
      displayedLenRef.current = content.length;
      setDisplayed(content);
      return;
    }

    // Adaptive speed: at least BASE rate, faster for large jumps to stay under MAX duration
    const delta = content.length - currentLen;
    speedRef.current = Math.max(BASE_CHARS_PER_MS, delta / MAX_ANIMATION_MS);

    // If loop is already running it will pick up the new target & speed via refs
    if (animatingRef.current) return;

    animatingRef.current = true;
    lastTimeRef.current = performance.now();

    const step = (now: number) => {
      const elapsed = now - lastTimeRef.current;

      // Throttle to ~30 fps to keep Markdown re-parses reasonable
      if (elapsed < MIN_FRAME_MS) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      lastTimeRef.current = now;

      const target = targetRef.current;
      const chars = Math.max(1, Math.round(elapsed * speedRef.current));
      const newLen = Math.min(target.length, displayedLenRef.current + chars);

      displayedLenRef.current = newLen;
      setDisplayed(target.substring(0, newLen));

      if (newLen < target.length) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        animatingRef.current = false;
      }
    };

    rafRef.current = requestAnimationFrame(step);
  }, [content, isStreaming]);

  // Cleanup on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return displayed;
}
