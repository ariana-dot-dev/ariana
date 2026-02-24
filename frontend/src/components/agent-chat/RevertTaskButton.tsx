import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Undo, Loader2, HelpCircle } from 'lucide-react';
import { RevertConfirmDialog } from './RevertConfirmDialog';
import type { Agent, ChatEvent } from '@/bindings/types';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useAgentAccesses } from '@/hooks/useAgentAccesses';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAppStore } from '@/stores/useAppStore';

interface RevertTaskButtonProps {
  taskId: string;
  allEvents: ChatEvent[];
  agent: Agent;
  refetchEvents: () => Promise<void>;
}

// Find the checkpoint just before this task started
function findCheckpointBeforeTask(taskId: string, allEvents: ChatEvent[]): ChatEvent | null {
  // Find the earliest event in this task
  const taskEvents = allEvents.filter(e => e.taskId === taskId);
  if (taskEvents.length === 0) return null;

  const earliestTaskTimestamp = Math.min(...taskEvents.map(e => e.timestamp));

  // Find the latest checkpoint before this task started
  const checkpointsBeforeTask = allEvents
    .filter(e =>
      e.type === 'git_checkpoint' &&
      e.timestamp < earliestTaskTimestamp
    )
    .sort((a, b) => b.timestamp - a.timestamp); // Latest first

  return checkpointsBeforeTask[0] || null;
}

export function RevertTaskButton({ taskId, allEvents, agent, refetchEvents }: RevertTaskButtonProps) {
  const [isReverting, setIsReverting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const dontShowRevertWarning = useAppStore((state) => state.dontShowRevertWarning);
  const setDontShowRevertWarning = useAppStore((state) => state.setDontShowRevertWarning);
  const [localDontShow, setLocalDontShow] = useState(true);

  // Check write access (reactive - updates when accessMap changes)
  const { accessMap } = useAgentAccesses();
  const access = accessMap.get(agent.id);
  const hasWriteAccess = access?.access === 'write';

  const checkpoint = findCheckpointBeforeTask(taskId, allEvents);

  // Don't show button if there's no checkpoint before this task
  if (!checkpoint || checkpoint.type !== 'git_checkpoint' || !checkpoint.data.commitSha) {
    return null;
  }

  // Don't show button if this is the current checkpoint
  if (checkpoint.data.commitSha === agent.lastCommitSha) {
    return null;
  }

  const handleRevertClick = () => {
    if (dontShowRevertWarning) {
      handleConfirmRevert();
    } else {
      setShowConfirmDialog(true);
    }
  };

  const handleConfirmRevert = async () => {
    if (!checkpoint.data.commitSha) return;

    // Save preference if dialog was shown
    if (showConfirmDialog && localDontShow) {
      setDontShowRevertWarning(true);
    }

    setShowConfirmDialog(false);
    setIsReverting(true);

    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/revert`, {
        method: 'POST',
        body: JSON.stringify({ commitSha: checkpoint.data.commitSha })
      });

      const result = await response.json();
      if (!result.success) {
        console.error('Revert failed:', result.error);
        return;
      }

      // Revert succeeded - refetch events to show updated state
      console.log('Revert successful');
      await refetchEvents();
    } catch (error) {
      console.error('Revert request failed:', error);
    } finally {
      setIsReverting(false);
    }
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip delayDuration={200}>
          <TooltipTrigger asChild>
            <div>
              <Button
                variant="transparent"
                size="sm"
                onClick={hasWriteAccess ? handleRevertClick : undefined}
                disabled={isReverting || !hasWriteAccess}
                className={cn(
                  "text-xs h-7 gap-1.5 opacity-50 hover:opacity-100 transition-opacity",
                  !hasWriteAccess && "opacity-30 cursor-not-allowed"
                )}
              >
                {isReverting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Undo className="h-3 w-3" />
                )}
                {isReverting ? 'Reverting...' : 'Revert these changes'}
                {!hasWriteAccess && <HelpCircle className="h-3 w-3" />}
              </Button>
            </div>
          </TooltipTrigger>
          {!hasWriteAccess && (
            <TooltipContent>
              <p>You need write access to revert these changes</p>
            </TooltipContent>
          )}
        </Tooltip>
      </TooltipProvider>

      {/* Confirmation Dialog */}
      <RevertConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        onConfirm={handleConfirmRevert}
        commitSha={checkpoint.data.commitSha || ''}
        commitMessage={checkpoint.data.commitMessage || ''}
        localDontShow={localDontShow}
        onDontShowChange={setLocalDontShow}
      />
    </>
  );
}
