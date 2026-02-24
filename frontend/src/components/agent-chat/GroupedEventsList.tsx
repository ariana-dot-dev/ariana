import { useMemo, memo, RefObject } from 'react';
import type { Agent, ChatEvent } from '@/bindings/types';
import { Event } from './Event';
import { ToolEventsGroup, breaksToolGroup } from './ToolEventsGroup';
import { ProjectWorkspace } from '@/stores/useAppStore';

interface GroupedEventsListProps {
  events: ChatEvent[];
  agent: Agent;
  projectWorkspace: ProjectWorkspace;
  refetchEvents: () => Promise<void>;
  onCancelPrompt?: (promptId: string) => Promise<void>;
  onSkipQueue?: (promptId: string) => Promise<void>;
  onRelaunchAutomation?: (automationId: string) => Promise<void>;
  onStopAutomation?: (automationId: string) => Promise<void>;
  onFeedAutomationToAgent?: (automationId: string, output: string, automationName: string) => Promise<void>;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  loadMoreSentinelRef?: RefObject<HTMLDivElement>;
}

type RenderItem =
  | { type: 'single'; event: ChatEvent }
  | { type: 'toolGroup'; events: ChatEvent[] };

export const GroupedEventsList = memo(function GroupedEventsList({
  events,
  agent,
  projectWorkspace,
  refetchEvents,
  onCancelPrompt,
  onSkipQueue,
  onRelaunchAutomation,
  onStopAutomation,
  onFeedAutomationToAgent,
  hasMore,
  isLoadingMore,
  loadMoreSentinelRef,
}: GroupedEventsListProps) {
  // Group consecutive tool-only response events
  const renderItems = useMemo(() => {
    const items: RenderItem[] = [];
    let currentToolGroup: ChatEvent[] = [];

    const flushToolGroup = () => {
      if (currentToolGroup.length > 0) {
        items.push({ type: 'toolGroup', events: [...currentToolGroup] });
        currentToolGroup = [];
      }
    };

    for (const event of events) {
      if (breaksToolGroup(event)) {
        // This event breaks any current tool group
        flushToolGroup();
        items.push({ type: 'single', event });
      } else {
        // Tool-only response - add to current group
        currentToolGroup.push(event);
      }
    }

    // Flush remaining tools
    flushToolGroup();

    return items;
  }, [events]);

  // Find the first queued prompt's taskId
  const firstQueuedTaskId = useMemo(() => {
    for (const event of events) {
      if (event.type === 'prompt' && event.data.status === 'queued' && event.taskId) {
        return event.taskId;
      }
    }
    return null;
  }, [events]);

  return (
    <>
      {/* Anchor element at top — excluded from overflow-anchor so older messages prepend without scroll jump */}
      {hasMore && loadMoreSentinelRef && (
        <div ref={loadMoreSentinelRef} className="h-px w-full" style={{ overflowAnchor: 'none' }} />
      )}
      {/* Loading indicator */}
      {isLoadingMore && (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
        </div>
      )}
      {renderItems.map((item) => {
        if (item.type === 'toolGroup') {
          // Use first event ID as stable key for the group
          const groupKey = `toolgroup-${item.events[0]?.id ?? 'empty'}`;
          return (
            <div key={groupKey} className="w-full overflow-hidden pl-1 pr-2 lg:pl-5 lg:pr-6">
              <ToolEventsGroup events={item.events} />
            </div>
          );
        } else {
          const isFirstQueued = item.event.type === 'prompt' &&
            item.event.data.status === 'queued' &&
            item.event.taskId === firstQueuedTaskId;
          return (
            <Event
              key={item.event.id}
              event={item.event}
              agent={agent}
              projectWorkspace={projectWorkspace}
              refetchEvents={refetchEvents}
              allEvents={events}
              onCancelPrompt={onCancelPrompt}
              onSkipQueue={onSkipQueue}
              onRelaunchAutomation={onRelaunchAutomation}
              onStopAutomation={onStopAutomation}
              onFeedAutomationToAgent={onFeedAutomationToAgent}
              isFirstQueued={isFirstQueued}
            />
          );
        }
      })}
    </>
  );
});
