import { useEffect, useState } from 'react';
import { usePollingTrackerStore } from '@/stores/usePollingTrackerStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function PollingActivityOverlay() {
  const overlayVisible = usePollingTrackerStore((state) => state.overlayVisible);
  const activities = usePollingTrackerStore((state) => state.activities);
  const [, forceUpdate] = useState(0);

  // Force re-render every 100ms to update the dot animations
  useEffect(() => {
    if (!overlayVisible) return;

    const interval = setInterval(() => {
      forceUpdate((n) => n + 1);
    }, 100);

    return () => clearInterval(interval);
  }, [overlayVisible]);

  if (!overlayVisible) return null;

  const sortedActivities = Array.from(activities.values()).sort((a, b) =>
    a.label.localeCompare(b.label)
  );

  return (
    <div
      className="fixed bottom-4 right-4 bg-background/95 border border-border rounded-lg shadow-2xl p-4 max-w-md z-[9999] backdrop-blur-sm"
      style={{ maxHeight: '80vh', overflowY: 'auto' }}
    >
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
        <h3 className="text-sm font-semibold">Polling Activity Monitor</h3>
        <div className="text-xs text-muted-foreground">
          CTRL+SHIFT+O to close
        </div>
      </div>

      <div className="space-y-1">
        {sortedActivities.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            No polling activity detected
          </div>
        ) : (
          sortedActivities.map((activity) => {
            const now = Date.now();
            const timeSinceLastPoll = now - activity.lastPollTime;
            const isRecent = timeSinceLastPoll < 500;
            const opacity = Math.max(0, 1 - timeSinceLastPoll / 500);

            return (
              <div
                key={activity.key}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div
                    className="w-2 h-2 rounded-full transition-all duration-100"
                    style={{
                      backgroundColor: activity.isActive
                        ? isRecent
                          ? `rgba(34, 197, 94, ${opacity})`
                          : 'rgba(100, 116, 139, 0.3)'
                        : 'rgba(239, 68, 68, 0.5)',
                      boxShadow: isRecent
                        ? `0 0 ${8 * opacity}px rgba(34, 197, 94, ${opacity})`
                        : 'none',
                    }}
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className={`text-xs font-mono truncate ${
                          activity.isActive ? 'text-foreground' : 'text-muted-foreground line-through'
                        }`}
                      >
                        {activity.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{activity.label}</TooltipContent>
                  </Tooltip>
                </div>
                <div className="text-[9px] text-muted-foreground font-mono ml-2 whitespace-nowrap">
                  {activity.lastPollTime === 0
                    ? 'waiting...'
                    : timeSinceLastPoll < 1000
                    ? `${timeSinceLastPoll}ms`
                    : timeSinceLastPoll < 60000
                    ? `${(timeSinceLastPoll / 1000).toFixed(1)}s`
                    : `${(timeSinceLastPoll / 60000).toFixed(1)}m`}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-border text-[9px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>Active</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-slate-500/30" />
            <span>Idle</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-red-500/50" />
            <span>Inactive</span>
          </div>
        </div>
      </div>
    </div>
  );
}
