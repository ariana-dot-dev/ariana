import type {Agent, ChatEvent} from "../../../../backend/shared/types";
import {cn} from "@/lib/utils.ts";
import {ChatMessage} from "@/components/agent-chat/ChatMessage.tsx";
import {GitCheckpoint} from "@/components/agent-chat/GitCheckpoint.tsx";
import {ResetEvent} from "@/components/agent-chat/ResetEvent.tsx";
import {AutomationEventItem} from "@/components/agent-chat/AutomationEventItem.tsx";
import {ContextWarning, CompactionStart, CompactionComplete} from "@/components/agent-chat/ContextEvent.tsx";
import { ProjectWorkspace } from "@/stores/useAppStore";
import { memo } from "react";
import type React from "react";

function EventComponent ({ event, agent, projectWorkspace, refetchEvents, allEvents, children, onCancelPrompt, onSkipQueue, isFirstQueued, onRelaunchAutomation, onStopAutomation, onFeedAutomationToAgent }: { event: ChatEvent, agent: Agent, projectWorkspace: ProjectWorkspace, refetchEvents: () => Promise<void>, allEvents?: ChatEvent[], children?: React.ReactNode, onCancelPrompt?: (promptId: string) => Promise<void>, onSkipQueue?: (promptId: string) => Promise<void>, isFirstQueued?: boolean, onRelaunchAutomation?: (automationId: string) => Promise<void>, onStopAutomation?: (automationId: string) => Promise<void>, onFeedAutomationToAgent?: (automationId: string, output: string, automationName: string) => Promise<void> }){
    const isSpecialLayout = event.type === 'git_checkpoint' || event.type === 'reset' || event.type === 'automation' || event.type === 'automation_output_added' || event.type === 'context_warning' || event.type === 'compaction_start' || event.type === 'compaction_complete';
    return (
        <div className={cn(
            "w-full overflow-hidden",
            isSpecialLayout ? '' : 'pl-1 pr-2 lg:pl-4 lg:pr-6',
            event.type === 'prompt' ? '' : '',
            event.type === 'response' ? '' : '',
        )}>
            {(event.type === 'prompt' || event.type === 'response') && (
                <ChatMessage
                    event={event}
                    compact={false}
                    agent={agent}
                    onCancelPrompt={event.type === 'prompt' ? onCancelPrompt : undefined}
                    onSkipQueue={event.type === 'prompt' ? onSkipQueue : undefined}
                    isFirstQueued={isFirstQueued}
                />
            )}

            {event.type === 'git_checkpoint' && (
                <GitCheckpoint
                    event={event}
                    agent={agent}
                    projectWorkspace={projectWorkspace}
                    isCurrentCheckpoint={event.data.commitSha === agent.lastCommitSha}
                    refetchEvents={refetchEvents}
                    allEvents={allEvents}
                >
                    {children}
                </GitCheckpoint>
            )}

            {event.type === 'reset' && (
                <ResetEvent timestamp={event.timestamp} />
            )}

            {event.type === 'automation' && (
                <AutomationEventItem
                    event={event}
                    onRelaunch={onRelaunchAutomation}
                    onStop={onStopAutomation}
                    onFeedToAgent={onFeedAutomationToAgent}
                />
            )}

            {event.type === 'automation_output_added' && (
                <div className="flex items-center gap-2 px-5 md:pl-10 md:pr-5 pb-2 text-sm text-muted-foreground italic">
                    <span>Output from finished Automation "{event.data.automationName}" added to agent's context</span>
                </div>
            )}

            {event.type === 'context_warning' && (
                <ContextWarning event={event} />
            )}

            {event.type === 'compaction_start' && (
                <CompactionStart event={event} />
            )}

            {event.type === 'compaction_complete' && (
                <CompactionComplete event={event} />
            )}
        </div>
    )
}

// Memoize to prevent re-renders when event/agent data hasn't changed
// IMPORTANT: Deep compare event.data and check agent.lastCommitSha for GitCheckpoint
export const Event = memo(EventComponent, (prevProps, nextProps) => {
  // Deep compare event - all properties matter
  const eventEqual =
    prevProps.event.id === nextProps.event.id &&
    prevProps.event.type === nextProps.event.type &&
    prevProps.event.timestamp === nextProps.event.timestamp &&
    JSON.stringify(prevProps.event.data) === JSON.stringify(nextProps.event.data);

  // Check agent.lastCommitSha (needed for GitCheckpoint isCurrentCheckpoint)
  const agentEqual =
    prevProps.agent.id === nextProps.agent.id &&
    prevProps.agent.lastCommitSha === nextProps.agent.lastCommitSha;

  // Check projectWorkspace.id
  const projectEqual = prevProps.projectWorkspace.id === nextProps.projectWorkspace.id;

  // Check callback references (important when they change from undefined to defined)
  const callbacksEqual =
    prevProps.onFeedAutomationToAgent === nextProps.onFeedAutomationToAgent &&
    prevProps.onRelaunchAutomation === nextProps.onRelaunchAutomation &&
    prevProps.onStopAutomation === nextProps.onStopAutomation;

  // Return true to prevent re-render
  return eventEqual && agentEqual && projectEqual && callbacksEqual;
});
