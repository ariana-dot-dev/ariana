import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ContextWarningEvent, CompactionStartEvent, CompactionCompleteEvent } from '@shared/types/api/chat-event.types';

const formatTimestamp = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString();
};

// Context Warning Component
export function ContextWarning({ event }: { event: ContextWarningEvent }) {
  const { data } = event;
  const isLow = data.contextRemainingPercent <= 20;

  return (
    <div className="flex flex-col gap-0 items-center my-1">
      <div className="flex justify-center select-none">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                "px-3 py-1 w-fit h-auto text-xs rounded-md transition-opacity flex items-center gap-1.5",
                isLow
                  ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30"
                  : "text-muted-foreground opacity-70 hover:opacity-100"
              )}>
                <span className="opacity-50 ml-1">
                  {formatTimestamp(event.timestamp)}
                </span>
                <div className='opacity-50'>⁕</div>
                {data.contextRemainingPercent < 20 && (<AlertTriangle className="h-3 w-3" />)}
                {data.contextRemainingPercent}% context remaining
                {data.contextRemainingPercent < 20 && "- clear context soon or let compaction happen"}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <div className="space-y-1">
                <p className="font-medium">Context Window Usage</p>
                <p className="text-xs">Input tokens: {data.inputTokens.toLocaleString()}</p>
                <p className="text-xs">Cache tokens: {data.cacheTokens.toLocaleString()}</p>
                <p className="text-xs">Capacity: {data.contextWindow.toLocaleString()} tokens</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Automatic compaction will trigger when context is low.
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

// Compaction Start Component
export function CompactionStart({ event }: { event: CompactionStartEvent }) {
  return (
    <div className="flex flex-col gap-0 items-center my-2">
      <div className="flex justify-center select-none">
        <div className="px-3 py-1.5 w-fit h-auto text-xs rounded-md bg-accent/20 text-accent flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>
            Automatic compaction triggered ({event.data.contextUsedPercent}% context used), please wait...
          </span>
        </div>
      </div>
    </div>
  );
}

// Compaction Complete Component
export function CompactionComplete({ event }: { event: CompactionCompleteEvent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data } = event;

  return (
    <div className="flex flex-col gap-0 w-full md:pl-7 md:pr-9 px-3 my-2">
      <div
        className={cn(
          "flex items-center text-sm gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors",
          "dark:bg-emerald-950/30 bg-emerald-50 dark:hover:bg-emerald-950/50 hover:bg-emerald-100",
          isExpanded && "rounded-b-none"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="opacity-50">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-emerald-700 dark:text-emerald-400">Compaction completed</span>
          <span className="text-xs text-muted-foreground">
            (from {data.tokensBefore.toLocaleString()} tokens)
          </span>
          <span className="text-xs opacity-50">
            {formatTimestamp(event.timestamp)}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="dark:bg-emerald-950/20 bg-emerald-50/50 rounded-b-lg px-4 py-3 border-t border-emerald-200 dark:border-emerald-900">
          <div className="text-xs text-muted-foreground mb-2">
            Tokens before compaction: {data.tokensBefore.toLocaleString()}
          </div>
          <div className="text-sm whitespace-pre-wrap font-mono bg-background/50 p-3 rounded-md max-h-96 overflow-y-auto">
            {data.summary || 'No summary available'}
          </div>
        </div>
      )}
    </div>
  );
}
