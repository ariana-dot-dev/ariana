import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { LimitExceededDialog } from '@/components/LimitExceededDialog';
import { agentCreationService } from '@/services/agent.service';
import type { LimitExceededInfo } from '@/types/UsageLimits';

interface LimitContextType {
  showLimitDialog: (limitInfo: LimitExceededInfo) => void;
}

const LimitContext = createContext<LimitContextType | null>(null);

export function useLimitContext() {
  const context = useContext(LimitContext);
  if (!context) {
    throw new Error('useLimitContext must be used within LimitProvider');
  }
  return context;
}

interface LimitProviderProps {
  children: ReactNode;
}

export function LimitProvider({ children }: LimitProviderProps) {
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);
  const [currentLimitInfo, setCurrentLimitInfo] = useState<LimitExceededInfo | null>(null);

  const showLimitDialog = useCallback((limitInfo: LimitExceededInfo) => {
    console.log('[LimitContext] Showing limit dialog with info:', limitInfo);
    setCurrentLimitInfo(limitInfo);
    setLimitDialogOpen(true);
  }, []);

  // Setup limit callbacks for agent service
  useEffect(() => {
    console.log('[LimitContext] Registering limit callbacks with agent service');
    agentCreationService.setLimitCallbacks({
      onMonthlyAgentLimit: showLimitDialog
    });
  }, [showLimitDialog]);

  return (
    <LimitContext.Provider value={{ showLimitDialog }}>
      {children}
      <LimitExceededDialog
        open={limitDialogOpen}
        onOpenChange={setLimitDialogOpen}
        limitInfo={currentLimitInfo}
      />
    </LimitContext.Provider>
  );
}
