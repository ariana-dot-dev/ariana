import { useState, useEffect } from 'react';
import type React from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ExternalLink, RotateCcw, Loader2, AlertCircle, HelpCircle, Undo } from 'lucide-react';
import { RevertConfirmDialog } from './RevertConfirmDialog';
import type { Agent, ChatEvent } from '@/bindings/types';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { ProjectWorkspace, useAppStore } from '@/stores/useAppStore';
import { useAgentAccesses } from '@/hooks/useAgentAccesses';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useIsBrowser } from '@/hooks/useIsBrowser';


interface GitCheckpointProps {
  event: ChatEvent;
  agent: Agent;
  projectWorkspace: ProjectWorkspace;
  isCurrentCheckpoint?: boolean;
  refetchEvents: () => Promise<void>;
  children?: React.ReactNode;
  allEvents?: ChatEvent[];
}

// Find the checkpoint just before this commit
function findCheckpointBeforeCommit(currentEvent: ChatEvent, allEvents: ChatEvent[], agent: Agent): { sha: string; exists: boolean } | null {
  if (currentEvent.type !== 'git_checkpoint') return null;

  // Get all git checkpoints sorted by timestamp
  const checkpoints = allEvents
    .filter(e => e.type === 'git_checkpoint')
    .sort((a, b) => a.timestamp - b.timestamp); // Earliest first

  // Find current checkpoint index
  const currentIndex = checkpoints.findIndex(c => c.id === currentEvent.id);
  if (currentIndex === -1) return null;

  // If there's a checkpoint before this one, use it
  if (currentIndex > 0) {
    const prevCheckpoint = checkpoints[currentIndex - 1];
    if (prevCheckpoint.type === 'git_checkpoint') {
      return { sha: prevCheckpoint.data.commitSha, exists: true };
    }
  }

  // If this is the first checkpoint, try to use startCommitSha
  if (currentIndex === 0 && agent.startCommitSha) {
    return { sha: agent.startCommitSha, exists: true };
  }

  // No checkpoint to revert to
  return null;
}

export function GitCheckpoint({ event, agent, projectWorkspace, isCurrentCheckpoint, refetchEvents, children, allEvents = [] }: GitCheckpointProps) {
  const [isReverting, setIsReverting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showRevertChangesDialog, setShowRevertChangesDialog] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dontShowRevertWarning = useAppStore((state) => state.dontShowRevertWarning);
  const setDontShowRevertWarning = useAppStore((state) => state.setDontShowRevertWarning);
  const [localDontShow, setLocalDontShow] = useState(true);
  const isBrowser = useIsBrowser();

  // Check write access (reactive - updates when accessMap changes)
  const { accessMap } = useAgentAccesses();
  const access = accessMap.get(agent.id);
  const hasWriteAccess = access?.access === 'write';

  if (event.type !== 'git_checkpoint') return null;

  // Find the checkpoint to revert to (the one before this commit)
  const revertTarget = findCheckpointBeforeCommit(event, allEvents, agent);

  // Show "Revert these changes" button if:
  // 1. This commit is NOT reverted
  // 2. There's a valid checkpoint to revert to
  // 3. That checkpoint is not the current one (otherwise we're already there)
  const showRevertChangesButton = !event.data.is_reverted &&
                                   revertTarget !== null &&
                                   revertTarget.sha !== agent.lastCommitSha;

  const handleRevertClick = () => {
    if (dontShowRevertWarning) {
      handleConfirmRevert();
    } else {
      setShowConfirmDialog(true);
    }
  };

  const handleRevertChangesClick = () => {
    if (dontShowRevertWarning) {
      handleConfirmRevertChanges();
    } else {
      setShowRevertChangesDialog(true);
    }
  };

  const handleConfirmRevert = async () => {
    if (!event.data.commitSha) return;

    // Save preference if dialog was shown
    if (showConfirmDialog && localDontShow) {
      setDontShowRevertWarning(true);
    }

    setShowConfirmDialog(false);
    setIsReverting(true);

    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/revert`, {
        method: 'POST',
        body: JSON.stringify({ commitSha: event.data.commitSha })
      });

      const result = await response.json();
      if (!result.success) {
        console.error('Revert failed:', result.error);
        // Connection errors are handled by ConnectionStatus component
        return;
      }

      // Revert succeeded - refetch events to show updated is_reverted flags
      console.log('Revert successful');
      await refetchEvents();
    } catch (error) {
      console.error('Revert request failed:', error);
      // Connection errors are handled by ConnectionStatus component
    } finally {
      setIsReverting(false);
    }
  };

  const handleConfirmRevertChanges = async () => {
    if (!revertTarget) return;

    // Save preference if dialog was shown
    if (showRevertChangesDialog && localDontShow) {
      setDontShowRevertWarning(true);
    }

    setShowRevertChangesDialog(false);
    setIsReverting(true);

    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/revert`, {
        method: 'POST',
        body: JSON.stringify({ commitSha: revertTarget.sha })
      });

      const result = await response.json();
      if (!result.success) {
        console.error('Revert failed:', result.error);
        return;
      }

      console.log('Revert successful');
      await refetchEvents();
    } catch (error) {
      console.error('Revert request failed:', error);
    } finally {
      setIsReverting(false);
    }
  };

  const handleViewCommit = async () => {
    if (event.data.commitUrl) {
      if (isBrowser) {
        window.open(event.data.commitUrl, '_blank');
      } else {
        await openUrl(event.data.commitUrl);
      }
    }
  };

  return (
    <>
      <div className="flex flex-col gap-0 items-center">
        {/* Checkpoint label with dropdown and optional revert button */}
        <div className="flex justify-center items-center gap-4 select-none w-full">
          <DropdownMenu onOpenChange={setIsDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <button
                onMouseEnter={() => setHovering(true)}
                onMouseLeave={() => setHovering(false)}
                className={`px-2 py-1 w-fit h-auto text-xs hover:underline rounded-t-md opacity-70 hover:opacity-100 transition-all ${
                  isReverting
                    ? 'text-destructive-foreground'
                    : 'text-constructive-foreground'
                }`}
                disabled={isReverting}
              >
                {isReverting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                git commit
                {event.data.additions !== undefined && event.data.deletions !== undefined && (
                  <>
                    {' '}
                    <span className="text-constructive-foreground">+{event.data.additions}</span>
                    {' '}
                    <span className="text-destructive-foreground">-{event.data.deletions}</span>
                  </>
                )}
                {event.data.pushed && ' (pushed)'}
                {isReverting && ' - reverting...'}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-[26ch] p-1.5 bg-background !shadow-md border-(length:--border-width) border-muted/30">
              {/* Commit title and debug info */}
              <div className="px-2 py-1.5 mb-1 border-b border-muted/30">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="text-xs font-medium text-foreground mb-1 truncate">
                      {event.data.commitMessage.split('\n')[0]}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{event.data.commitMessage}</TooltipContent>
                </Tooltip>
              </div>

              {!isCurrentCheckpoint && !event.data.is_reverted && (
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <div className="w-full">
                        <DropdownMenuItem
                          variant="transparent"
                          hoverVariant='default'
                          onClick={hasWriteAccess ? handleRevertClick : undefined}
                          disabled={isReverting || isCurrentCheckpoint || !hasWriteAccess}
                          className={cn(
                            "text-xs w-full",
                            !hasWriteAccess && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          {isReverting ? (
                            <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3 mr-2" />
                          )}
                          {isReverting ? 'Reverting...' : 'Revert to here'}
                          {!hasWriteAccess && <HelpCircle className="h-3 w-3 ml-auto" />}
                        </DropdownMenuItem>
                      </div>
                    </TooltipTrigger>
                    {!hasWriteAccess && (
                      <TooltipContent>
                        <p>You need write access to revert this commit</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )}
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger>
                    <div className="w-full text-left">
                      <DropdownMenuItem
                        variant="transparent"
                        hoverVariant={event.data.commitUrl ? 'default' : 'transparent'}
                        onClick={event.data.commitUrl ? handleViewCommit : undefined}
                        disabled={!event.data.commitUrl}
                        className={cn(
                          "text-xs w-full"
                        )}
                      >
                        <ExternalLink className="h-3 w-3 mr-2" />
                        See on GitHub
                        {!event.data.commitUrl && (
                          <AlertCircle className="h-3 w-3 ml-auto text-destructive-foreground" />
                        )}
                      </DropdownMenuItem>
                    </div>
                  </TooltipTrigger>
                  {!event.data.commitUrl && (
                    <TooltipContent side="right" className="bg-background-darker border-(length:--border-width) border-muted/30">
                      <p className="text-xs">You need to push to see this checkpoint's commit on GitHub</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Render "Revert these changes" button or children */}
          {showRevertChangesButton ? (
            <TooltipProvider>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <div>
                    <Button
                      variant="transparent"
                      size="sm"
                      onClick={hasWriteAccess ? handleRevertChangesClick : undefined}
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
          ) : children}
        </div>

      </div>

      {/* Confirmation Dialog for "Revert to here" */}
      <RevertConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        onConfirm={handleConfirmRevert}
        commitSha={event.data.commitSha || ''}
        commitMessage={event.data.commitMessage || ''}
        localDontShow={localDontShow}
        onDontShowChange={setLocalDontShow}
      />

      {/* Confirmation Dialog for "Revert these changes" */}
      <RevertConfirmDialog
        open={showRevertChangesDialog}
        onOpenChange={setShowRevertChangesDialog}
        onConfirm={handleConfirmRevertChanges}
        commitSha={revertTarget?.sha || ''}
        commitMessage={`Reverting to checkpoint before: ${event.data.commitMessage}`}
        localDontShow={localDontShow}
        onDontShowChange={setLocalDontShow}
      />
    </>
  );
}