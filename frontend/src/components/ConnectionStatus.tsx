import { useConnectionStore } from '@/stores/useConnectionStore';
import { WifiOff } from 'lucide-react';

export function ConnectionStatus() {
  const showConnectionIssue = useConnectionStore(state => state.showConnectionIssue);

  if (!showConnectionIssue) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[9999] hidden md:flex items-center gap-1.5 px-3 py-1.5 text-destructive text-xs font-medium animate-pulse pointer-events-none">
      <WifiOff className="h-3 w-3" />
      <span>Connection issues...</span>
    </div>
  );
}