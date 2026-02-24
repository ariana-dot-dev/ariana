import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AgentState } from '@/bindings/types';
import { agentStateToString, getAgentStatusBgColor, getAgentStatusColor } from '../agent-chat/utils';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { useToast } from '@/hooks/use-toast';
import Play from '../ui/icons/Play';

function useResumeAgent(agentId: string) {
  const [isResuming, setIsResuming] = useState(false);
  const { toast } = useToast();

  const handleResume = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResuming(true);
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/force-reboot`, {
        method: 'POST'
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to resume agent');
      }
    } catch (error) {
      toast({
        title: 'Failed to resume agent',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsResuming(false);
    }
  };

  return { isResuming, handleResume };
}

/** Just the resume button — for use outside the tooltip (e.g. chat bottom banner) */
export function StoppedAgentResumeButton({ agentId }: { agentId: string }) {
  const { isResuming, handleResume } = useResumeAgent(agentId);

  return (
    <button
      className={cn(
        "flex items-center justify-center gap-1.5 text-xs font-medium px-1 py-1.5 rounded-md transition-colors",
        "text-accent/80 hover:text-accent hover:underline",
        isResuming && "opacity-70 cursor-not-allowed"
      )}
      disabled={isResuming}
      onClick={handleResume}
    >
      {isResuming ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <div className="w-3 h-3">
          <Play className="max-w-full max-h-full text-inherit" />
        </div>
      )}
      {isResuming ? 'Resuming...' : 'Resume on new machine'}
    </button>
  );
}

interface StoppedAgentIndicatorProps {
  agentId: string;
  /** Show the colored dot before the status text */
  showDot?: boolean;
}

/** Status label with tooltip containing explanation + resume button */
export function StoppedAgentIndicator({ agentId, showDot = true }: StoppedAgentIndicatorProps) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 cursor-pointer">
          {showDot && (
            <div className={cn(
              "w-1 h-1 ml-1 rounded-full flex-shrink-0",
              getAgentStatusBgColor(AgentState.ARCHIVED)
            )} />
          )}
          <span className={cn(
            "text-xs",
            getAgentStatusColor(AgentState.ARCHIVED)
          )}>{agentStateToString(AgentState.ARCHIVED)}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="flex flex-col gap-2 p-3">
        <p className="text-sm">The agent's computer was stopped.</p>
        <StoppedAgentResumeButton agentId={agentId} />
      </TooltipContent>
    </Tooltip>
  );
}
