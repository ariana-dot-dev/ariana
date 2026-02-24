import { useState } from 'react';

/**
 * Hook to detect if running in browser (web) vs Tauri (desktop)
 * Defaults to false (assumes Tauri)
 *
 * @returns {boolean} isBrowser - true if running in web browser, false if in Tauri app
 */
export function useIsBrowser(): boolean {
  const [isBrowser] = useState(() => typeof window !== 'undefined' && !('__TAURI__' in window));

  return isBrowser;
}
