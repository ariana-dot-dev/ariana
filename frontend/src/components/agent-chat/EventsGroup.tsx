import { ProjectWorkspace } from "@/stores/useAppStore";
import type {Agent, ChatEvent} from "../../../../backend/shared/types";
import {Event} from "@/components/agent-chat/Event.tsx";
import { memo } from "react";


interface EventsGroupProps {
    events: ChatEvent[],
    agent: Agent,
    projectWorkspace: ProjectWorkspace,
    refetchEvents: () => Promise<void>,
    taskId: string,
    allEvents: ChatEvent[],
    isLastTask: boolean
}

function EventsGroupComponent({ events, agent, projectWorkspace, refetchEvents, taskId, allEvents, isLastTask }: EventsGroupProps)  {
    return (
        <div className="flex flex-col h-fit z-10 w-full">
            {events.map((event) => {
                return (
                    <Event
                        key={event.id}
                        event={event}
                        agent={agent}
                        projectWorkspace={projectWorkspace}
                        refetchEvents={refetchEvents}
                        allEvents={allEvents}
                    />
                );
            })}
        </div>
    )
}

// Memoize to prevent re-renders when events array hasn't changed
// IMPORTANT: Deep compare each event in the array as event.data can change during polling
export const EventsGroup = memo(EventsGroupComponent, (prevProps, nextProps) => {
  // Check events array length first
  if (prevProps.events.length !== nextProps.events.length) return false;

  // Deep compare each event in the array
  const eventsEqual = prevProps.events.every((prevEvent, i) => {
    const nextEvent = nextProps.events[i];
    return (
      prevEvent.id === nextEvent.id &&
      prevEvent.type === nextEvent.type &&
      prevEvent.timestamp === nextEvent.timestamp &&
      JSON.stringify(prevEvent.data) === JSON.stringify(nextEvent.data)
    );
  });

  // Check agent.lastCommitSha (needed for GitCheckpoint)
  const agentEqual =
    prevProps.agent.id === nextProps.agent.id &&
    prevProps.agent.lastCommitSha === nextProps.agent.lastCommitSha;

  // Check projectWorkspace.id
  const projectEqual = prevProps.projectWorkspace.id === nextProps.projectWorkspace.id;

  // Check taskId
  const taskIdEqual = prevProps.taskId === nextProps.taskId;

  // Check allEvents length (shallow check for performance)
  const allEventsEqual = prevProps.allEvents.length === nextProps.allEvents.length;

  // Check isLastTask
  const isLastTaskEqual = prevProps.isLastTask === nextProps.isLastTask;

  // Return true to prevent re-render
  return eventsEqual && agentEqual && projectEqual && taskIdEqual && allEventsEqual && isLastTaskEqual;
});
