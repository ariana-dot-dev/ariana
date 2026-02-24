import { useState, useEffect, useRef, useMemo } from 'react';
import type { PortInfo } from '@/services/port-bridge.service';

export interface PreviewablePort extends PortInfo {
  previewUrl: string;
}

interface UseServicePreviewabilityOptions {
  activePorts: PortInfo[];
  machineUrl: string | null | undefined;
  servicePreviewToken: string | null | undefined;
  enabled?: boolean;
}

const PROBE_INTERVAL_MS = 15_000;
/** How many consecutive empty probe results before we actually clear previewable ports */
const CONSECUTIVE_EMPTY_THRESHOLD = 3;

/**
 * Probes each active port's service-preview URL to determine if it serves
 * previewable HTML content. Returns only ports that respond with HTML.
 *
 * Stabilizes against `activePorts` array reference churn (Zustand emits a
 * new reference every poll cycle even if the ports haven't changed).
 * Also resilient to transient probe failures — requires multiple consecutive
 * empty results before clearing.
 */
export function useServicePreviewability({
  activePorts,
  machineUrl,
  servicePreviewToken,
  enabled = true,
}: UseServicePreviewabilityOptions): PreviewablePort[] {
  const [previewable, setPreviewable] = useState<PreviewablePort[]>([]);

  // Stable key derived from port numbers — only changes when actual ports change
  const portsKey = useMemo(
    () => activePorts.map(p => p.port).sort((a, b) => a - b).join(','),
    [activePorts]
  );

  // Keep a ref so the probe closure always reads the latest ports array
  const portsRef = useRef(activePorts);
  portsRef.current = activePorts;

  // Track consecutive empty results to avoid clearing on transient failures
  const consecutiveEmptyRef = useRef(0);

  useEffect(() => {
    if (!enabled || !machineUrl || !servicePreviewToken || portsKey === '') {
      // Don't clear immediately — only if ports are genuinely gone
      // (portsKey === '' means activePorts is empty, which is handled by sticky ports upstream)
      if (!enabled) return; // Keep cached results when just unfocused
      setPreviewable([]);
      consecutiveEmptyRef.current = 0;
      return;
    }

    let cancelled = false;
    const base = machineUrl.endsWith('/') ? machineUrl.slice(0, -1) : machineUrl;

    const probe = async () => {
      const ports = portsRef.current;

      const results = await Promise.all(
        ports.map(async (port): Promise<PreviewablePort | null> => {
          const url = `${base}/service-preview/${servicePreviewToken}/${port.port}/`;
          try {
            const res = await fetch(url, {
              method: 'GET',
              redirect: 'follow',
            });

            if (!res.ok) return null;

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('text/html')) return null;

            // Read a small slice to check for proxy error pages
            const text = await res.text();
            if (text.includes('Service Unavailable') || text.includes('502 Bad Gateway')) {
              return null;
            }

            return { ...port, previewUrl: url };
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;

      const found = results.filter((r): r is PreviewablePort => r !== null);

      if (found.length > 0) {
        consecutiveEmptyRef.current = 0;
        setPreviewable(found);
      } else {
        consecutiveEmptyRef.current++;
        // Only clear after several consecutive empty probes
        if (consecutiveEmptyRef.current >= CONSECUTIVE_EMPTY_THRESHOLD) {
          setPreviewable([]);
        }
      }
    };

    probe();
    const interval = setInterval(probe, PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      consecutiveEmptyRef.current = 0;
    };
  }, [portsKey, machineUrl, servicePreviewToken, enabled]);

  return previewable;
}
