import { useEffect, useRef, useState, useCallback } from 'react';
import { wsService } from '@/services/websocket.service';
import type { ChannelName, ServerMessage, SnapshotMessage } from '@/services/websocket-protocol';
import { useWebSocketStore } from '@/stores/useWebSocketStore';

interface UseWebSocketSubscriptionOptions<T> {
  enabled?: boolean;
  onSnapshot?: (data: T) => void;
  onDelta?: (data: any) => void;
}

export function useWebSocketSubscription<T = any>(
  channel: ChannelName,
  params: Record<string, any>,
  options?: UseWebSocketSubscriptionOptions<T>
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const connectionState = useWebSocketStore(state => state.connectionState);
  const paramsRef = useRef(params);
  const optionsRef = useRef(options);

  // Update refs
  paramsRef.current = params;
  optionsRef.current = options;

  // Stable params key for dependency
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    const enabled = optionsRef.current?.enabled !== false;
    if (!enabled) {
      setLoading(false);
      return;
    }

    const unsubscribe = wsService.subscribe(
      channel,
      paramsRef.current,
      (message: ServerMessage) => {
        if (message.type === 'snapshot') {
          const snapshotData = (message as SnapshotMessage).data as T;
          setData(snapshotData);
          setLoading(false);
          setError(null);
          optionsRef.current?.onSnapshot?.(snapshotData);
        } else if (message.type === 'delta') {
          optionsRef.current?.onDelta?.(message.data);
        }
      }
    );

    return unsubscribe;
  }, [channel, paramsKey]);

  return { data, loading, error };
}
