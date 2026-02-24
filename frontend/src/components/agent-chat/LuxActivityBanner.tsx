import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronUp, Monitor, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';

interface LuxStep {
  id: string;
  reason: string | null;
  actionsReturned: number;
  stopped: boolean;
  createdAt: string;
}

interface LuxActivityBannerProps {
  agentId: string;
  luxActiveTask: string | null;
  luxActiveSessionId: string | null;
  visible?: boolean;
}

const DONE_DISMISS_MS = 60_000;

export function LuxActivityBanner({ agentId, luxActiveTask, luxActiveSessionId, visible = true }: LuxActivityBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [steps, setSteps] = useState<LuxStep[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-scroll: track whether user is near the bottom of the steps list
  const stepsContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleStepsScroll = useCallback(() => {
    const el = stepsContainerRef.current;
    if (!el) return;
    // Consider "at bottom" if within 24px of the end
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }, []);

  // Auto-scroll to bottom when new steps arrive (if user hasn't scrolled up)
  useEffect(() => {
    const el = stepsContainerRef.current;
    if (el && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [steps]);

  // Track "done" state: when task goes from active → null, show checkmark for 1 min
  const [doneTask, setDoneTask] = useState<string | null>(null);
  const prevTaskRef = useRef<string | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevTaskRef.current;
    prevTaskRef.current = luxActiveTask;

    // Task just ended (was active, now null)
    if (prev && !luxActiveTask) {
      setDoneTask(prev);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      doneTimerRef.current = setTimeout(() => setDoneTask(null), DONE_DISMISS_MS);
    }

    // New task started — clear done state
    if (luxActiveTask) {
      setDoneTask(null);
      if (doneTimerRef.current) {
        clearTimeout(doneTimerRef.current);
        doneTimerRef.current = null;
      }
    }

    return () => {
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, [luxActiveTask]);

  const fetchSteps = useCallback(async () => {
    if (!luxActiveSessionId) return;
    setLoading(true);
    try {
      const res = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/lux/steps`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSteps(data.steps);
        }
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [agentId, luxActiveSessionId]);

  // Poll steps while session is active (needed for done detection even when collapsed)
  // Poll faster (3s) when expanded for UX, slower (5s) when collapsed just for done detection
  useEffect(() => {
    if (!luxActiveSessionId) return;
    fetchSteps();
    const interval = setInterval(fetchSteps, expanded ? 3000 : 5000);
    return () => clearInterval(interval);
  }, [expanded, luxActiveSessionId, fetchSteps]);

  // Reset steps when session changes
  useEffect(() => {
    setSteps([]);
    setExpanded(false);
  }, [luxActiveSessionId]);

  // Done if: session cleared (doneTask set), OR last fetched step signaled stop
  const lastStepStopped = steps.length > 0 && steps[steps.length - 1].stopped;
  const isDone = (!luxActiveTask && !!doneTask) || lastStepStopped;
  const displayTask = luxActiveTask || doneTask;

  // Start dismiss timer when last step signals stop (even if luxActiveTask is still set)
  const [dismissed, setDismissed] = useState(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (lastStepStopped && !stopTimerRef.current) {
      stopTimerRef.current = setTimeout(() => setDismissed(true), DONE_DISMISS_MS);
    }
    // Reset if a new session starts (steps cleared, no longer stopped)
    if (!lastStepStopped && stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
      setDismissed(false);
    }
    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, [lastStepStopped]);

  if (!displayTask || !visible || dismissed) return null;

  return (
    <div className="absolute transition shadow-md rounded-md top-14 left-1/2 -translate-x-1/2 z-20 w-full max-w-lg pointer-events-none">
      <div className="pointer-events-auto mx-auto">
        {/* Island bar */}
        <button
          onClick={() => setExpanded(e => !e)}
          className={cn(
            "w-full flex items-center gap-2 p-3 rounded-lg",
            "backdrop-blur-xl bg-background/80 hover:bg-background cursor-pointer transition-colors",
            expanded && "rounded-b-none border-b-0",
          )}
        >

          <div className="flex flex-col gap-1 items-start justify-start flex-1 min-w-0">
            <div className="flex gap-2 items-center">
              {/* Status indicator */}
              {isDone ? (
                <>
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-constructive-foreground/20 shrink-0">
                    <Check className="w-2.5 h-2.5 text-constructive-foreground" strokeWidth={3} />
                  </div>
                  <div className='text-xs rounded-md text-constructive-foreground'>
                    COMPUTER USE TASK FINISHED
                  </div>
                </>
              ) : (
                <>                
                  <div className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent" />
                  </div>
                  <div className='text-xs rounded-md text-accent'>
                    COMPUTER USE TASK ONGOING
                  </div>
                </>
              )}
            </div>

            <div className={cn(
              "truncate max-w-full p-1 pb-0 flex-1 min-w-0 text-left text-xs"
            )}>
              "{displayTask}"
            </div>
          </div>

          <div>
            {expanded ? (
            <ChevronUp className={cn("w-3.5 h-3.5 shrink-0", isDone ? "text-constructive-foreground/60" : "text-muted-foreground")} />
          ) : (
            <ChevronDown className={cn("w-3.5 h-3.5 shrink-0", isDone ? "text-constructive-foreground/60" : "text-muted-foreground")} />
          )}
          </div>
        </button>

        {/* Expanded metro map — inset for visual hierarchy */}
        {expanded && (
          <div
            ref={stepsContainerRef}
            onScroll={handleStepsScroll}
            className={cn(
              "bg-background/80 backdrop-blur-sm",
              "rounded-b-lg px-3 py-2 max-h-64 overflow-y-auto",
            )}
          >
            {loading && steps.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 text-center">Loading steps...</div>
            ) : steps.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 text-center">No steps yet</div>
            ) : (
              <div className="flex flex-col gap-0">
                {steps.map((step, i) => {
                  const isLast = i === steps.length - 1;
                  const stepDone = !isLast || step.stopped;
                  const isActive = isLast && !step.stopped;

                  return (
                    <div key={step.id} className="flex gap-2 items-stretch">
                      {/* Metro line + dot */}
                      <div className="flex flex-col items-center shrink-0 w-4">
                        <div className={cn(
                          "w-2.5 h-2.5 rounded-full mt-1 shrink-0 border-2",
                          stepDone && "bg-accent border-accent",
                          isActive && "bg-background border-accent animate-pulse",
                          !stepDone && !isActive && "bg-muted border-muted-foreground/30",
                        )} />
                        {!isLast && (
                          <div className="w-0.5 flex-1 bg-accent/30" />
                        )}
                      </div>

                      {/* Step content */}
                      <div className="flex-1 min-w-0 pb-2">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            #{i + 1}
                          </span>
                          {step.actionsReturned > 0 && (
                            <span className="text-[10px] text-muted-foreground/60">
                              {step.actionsReturned} action{step.actionsReturned !== 1 ? 's' : ''}
                            </span>
                          )}
                          {step.stopped && (
                            <span className="text-[10px] text-constructive-foreground font-medium">done</span>
                          )}
                        </div>
                        {step.reason && (
                          <p className="text-xs text-foreground/80 leading-snug mt-0.5 line-clamp-2">
                            {step.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
