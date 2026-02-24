import { create } from 'zustand';
import { wsService } from '@/services/websocket.service';

interface WebSocketState {
  connectionState: 'disconnected' | 'connecting' | 'connected';
  connect: (token: string) => void;
  disconnect: () => void;
}

export const useWebSocketStore = create<WebSocketState>((set) => {
  // Listen to connection state changes
  wsService.onStateChange((state) => {
    set({ connectionState: state });
  });

  return {
    connectionState: 'disconnected',

    connect: (token: string) => {
      wsService.connect(token);
    },

    disconnect: () => {
      wsService.disconnect();
    },
  };
});
