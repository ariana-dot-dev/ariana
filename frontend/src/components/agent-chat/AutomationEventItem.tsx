import { useState } from 'react';
import { ArrowRight, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutomationEvent } from '@shared/types/api/chat-event.types';
import { Button } from '../ui/button';
import Refresh from '../ui/icons/Refresh';
import Stop from '../ui/icons/Stop';
import Copy from '../ui/icons/Copy';
import CheckmarkCircle from '../ui/icons/CheckmarkCircle';
import Chat from '../ui/icons/Chat';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';


const formatDuration = (timestampA: number, timestampB: number) => {
  const duration = timestampB - timestampA;
  return new Date(duration).toISOString().slice(11, 19);
};

interface AutomationEventItemProps {
  event: AutomationEvent;
  onRelaunch?: (automationId: string) => Promise<void>;
  onStop?: (automationId: string) => Promise<void>;
  onFeedToAgent?: (automationId: string, output: string, automationName: string) => Promise<void>;
}

export function AutomationEventItem({ event, onRelaunch, onStop, onFeedToAgent }: AutomationEventItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRelaunching, setIsRelaunching] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isFeeding, setIsFeeding] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data } = event;

  const isRunning = data.status === 'running';
  const isFinished = data.status === 'finished';
  const isFailed = data.status === 'failed';
  const isKilled = data.status === 'killed';

  // Parse trigger info (it's stored as JSON string)
  let triggerInfo = null;
  try {
    triggerInfo = JSON.parse(data.trigger);
  } catch {
    triggerInfo = { type: 'unknown' };
  }

  const getTriggerLabel = () => {
    const type = triggerInfo?.type || 'unknown';
    if (type === 'manual') return 'Manual trigger';
    if (type === 'on_agent_ready') return 'Agent ready';
    if (type === 'on_before_commit') return 'Before commit';
    if (type === 'on_after_commit') return 'After commit';
    if (type === 'on_after_edit_files') return 'After edit files';
    if (type === 'on_after_read_files') return 'After read files';
    if (type === 'on_after_run_command') return 'After run command';
    if (type === 'on_before_push_pr') return 'Before push & PR';
    if (type === 'on_after_push_pr') return 'After push & PR';
    if (type === 'on_after_reset') return 'After reset';
    if (type === 'on_automation_finishes') return 'After automation finishes';
    return type;
  };

  const handleRelaunch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onRelaunch || isRelaunching) return;
    setIsRelaunching(true);
    try {
      await onRelaunch(data.automationId);
    } finally {
      setIsRelaunching(false);
    }
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onStop || isStopping) return;
    setIsStopping(true);
    try {
      await onStop(data.automationId);
    } finally {
      setIsStopping(false);
    }
  };

  const handleCopyLogs = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.output || copied) return;
    try {
      await navigator.clipboard.writeText(data.output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs:', err);
    }
  };

  const handleFeedToAgent = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onFeedToAgent || !data.output || isFeeding) return;
    setIsFeeding(true);
    try {
      await onFeedToAgent(data.automationId, data.output, data.automationName);
    } finally {
      setIsFeeding(false);
    }
  };

  return (
    <div className="flex flex-col gap-0 w-full md:pl-7 md:pr-9 px-3 my-2">
      <div
        className={cn(
          "flex items-center text-sm gap-2 px-3 py-3 rounded-lg cursor-pointer transition-colors",
          "dark:bg-background/70 bg-lightest/40 dark:hover:bg-darkest hover:bg-lightest",
          isExpanded && "rounded-b-none"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="opacity-50">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <div className='opacity-70'>
            Automation on {getTriggerLabel()}
          </div>
          <ArrowRight className="opacity-50 h-4 w-4" />
          <div className='mr-2'>
          <span className="font-medium">{data.automationName}</span>
          </div>
          <div className='text-xs'>
            {
              data.status === 'running' && (
                <div className='px-2 py-0.5 rounded-full bg-accent/50 text-accent-foreground'>Running...</div>
              )
            }
            {
              data.status === 'finished' && (
                <div className='px-2 py-0.5 rounded-full bg-constructive/50 text-constructive-foreground'>Finished</div>
              )
            }
            {
              data.status === 'failed' && (
                <div className='px-2 py-0.5 rounded-full bg-destructive/50 text-destructive-foreground'>Failed</div>
              )
            }
            {
              data.status === 'killed' && (
                <div className='px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground'>Killed</div>
              )
            }
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isRunning && data.blocking && (
              <span className="px-1.5 py-0.5 italic">
                blocking • waiting for it to finish
              </span>
            )}
          </div>
        </div>

        {/* Action buttons on the right */}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {onFeedToAgent && data.output && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleFeedToAgent}
                  disabled={isFeeding}
                  variant="transparent"
                  className="flex items-center gap-1.5 text-xs px-2 py-1 h-full transition-colors"
                >
                  {isFeeding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <div className="h-4 w-4"><Chat className="max-h-full max-w-full text-inherit" /></div>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Feed logs to agent</TooltipContent>
            </Tooltip>
          )}
          {data.output && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleCopyLogs}
                  variant="transparent"
                  className="flex items-center gap-1.5 text-xs px-2 py-1 h-full transition-colors"
                >
                  <div className="h-4 w-4">
                    {copied ? (
                      <CheckmarkCircle className="max-h-full max-w-full text-constructive-foreground" />
                    ) : (
                      <Copy className="max-h-full max-w-full text-inherit" />
                    )}
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy logs</TooltipContent>
            </Tooltip>
          )}
          {isRunning && onStop && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleStop}
                  disabled={isStopping}
                  variant="transparent"
                  className="flex items-center gap-1.5 text-xs px-2 py-1 h-full transition-colors"
                >
                  {isStopping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <div className="h-4 w-4"><Stop className="max-h-full max-w-full text-inherit" /></div>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop automation</TooltipContent>
            </Tooltip>
          )}
          {!isRunning && onRelaunch && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleRelaunch}
                  disabled={isRelaunching}
                  variant="transparent"
                  className="flex items-center gap-1.5 text-xs px-2 py-1 h-full transition-colors"
                >
                  {isRelaunching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <div className="h-4 w-4"><Refresh className="max-h-full max-w-full text-inherit" /></div>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Relaunch automation</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="dark:bg-background/70 bg-lightest/40 rounded-b-lg border-t-(length:--border-width) border-muted/30">
          <div className="p-3 space-y-2">
            {/* Status Info */}
            <div className="flex items-center gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Status: </span>
                <span className={cn(
                  isRunning && "text-accent",
                  isFinished && "text-constructive-foreground",
                  isFailed && "text-destructive-foreground",
                  isKilled && "text-muted-foreground"
                )}>
                  {data.status}
                </span>
              </div>
              {data.exitCode !== null && (
                <div>
                  <span className="text-muted-foreground">Exit code: </span>
                  <span className={data.exitCode === 0 ? "text-constructive-foreground" : "text-destructive-foreground"}>
                    {data.exitCode}
                  </span>
                </div>
              )}
              {data.finishedAt && data.startedAt && (
                <div>
                  <span className="text-muted-foreground">Took: </span>
                  <span>{formatDuration(data.startedAt, data.finishedAt)}</span>
                </div>
              )}
              {!data.finishedAt && data.startedAt && (
                <div>
                  <span className="text-muted-foreground">Been running for: </span>
                  <span>{formatDuration(data.startedAt, Date.now())}</span>
                </div>
              )}
            </div>

            {/* Logs */}
            {data.output && (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  Output {data.isStartTruncated && '(last 1000 lines)'}:
                </div>
                <pre className="text-xs mt-2 font-mono dark:bg-darkest bg-lightest p-3 rounded max-h-[400px] overflow-auto whitespace-pre-wrap">
                  {data.output}
                </pre>
              </div>
            )}

            {isRunning && !data.output && (
              <div className="text-xs text-muted-foreground italic">
                No output yet...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
