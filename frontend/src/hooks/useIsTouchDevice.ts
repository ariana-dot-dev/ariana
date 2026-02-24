import { useState, useEffect } from 'react';

/**
 * Detects if the user is on a touch-based device (phone/tablet)
 * Based on touch points and pointer coarseness, not screen width
 */
export function useIsTouchDevice(): boolean {
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    // Check if device has touch points
    const hasTouchPoints = navigator.maxTouchPoints > 0;

    // Check if primary input is coarse (touch-based)
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

    // Device is considered touch-based if it has touch points AND coarse pointer
    // This filters out desktop devices with touch screens
    const isTouch = hasTouchPoints && hasCoarsePointer;

    setIsTouchDevice(isTouch);
  }, []);

  return isTouchDevice;
}
