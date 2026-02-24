import { cn } from '@/lib/utils';
import { Plus, MoreHorizontalIcon, Trash2, Copy } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Automation } from '@/hooks/useAutomations';
import LockClosed from '../ui/icons/LockClosed';
import { MachineSpecsDialog } from '@/components/shared/MachineSpecsDialog';
import { useState } from 'react';
import { Agent, AgentState } from '@shared/types';
import { useToast } from '@/hooks/use-toast';
import { agentStateToString, getAgentStatusColor, getAgentStatusBgColor } from '@/components/agent-chat/utils';
import Play from '../ui/icons/Play';

interface AutomationsSidebarProps {
  automations: Automation[];
  onEdit: (automation: Automation) => void;
  onDelete: (automationId: string) => void;
  onDuplicate: (automationId: string) => void;
  onAdd: () => void;
  agents: Agent[];
  onTriggerAutomation: (automationId: string, agentId: string) => Promise<void>;
}

function AutomationItem({
  automation,
  onEdit,
  onDelete,
  onDuplicate,
  agents,
  onTriggerAutomation,
}: {
  automation: Automation;
  onEdit: (automation: Automation) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  agents: Agent[];
  onTriggerAutomation: (automationId: string, agentId: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const [isTriggering, setIsTriggering] = useState(false);

  // Helper to display trigger type nicely
  const getTriggerLabel = () => {
    const triggerType = automation.trigger.type;
    if (triggerType === 'manual') return 'Manual';
    if (triggerType === 'on_agent_ready') return 'On agent ready';
    if (triggerType === 'on_before_commit') return 'Before commit';
    if (triggerType === 'on_after_commit') return 'After commit';
    if (triggerType === 'on_after_edit_files') return 'After edit files';
    if (triggerType === 'on_after_read_files') return 'After read files';
    if (triggerType === 'on_after_run_command') return 'After run command';
    if (triggerType === 'on_before_push_pr') return 'Before push & PR';
    if (triggerType === 'on_after_push_pr') return 'After push & PR';
    if (triggerType === 'on_after_reset') return 'After reset';
    if (triggerType === 'on_automation_finishes') return 'After automation finishes';
    return triggerType;
  };

  const handleTriggerAutomation = async (agentId: string) => {
    setIsTriggering(true);
    try {
      await onTriggerAutomation(automation.id, agentId);
      toast({
        title: 'Automation triggered',
        description: `Running "${automation.name}" on agent`,
      });
    } catch (error) {
      toast({
        title: 'Failed to trigger automation',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsTriggering(false);
    }
  };

  // Filter agents to only show those that can run automations
  const runnableAgents = agents.filter(agent =>
    agent.state === AgentState.READY ||
    agent.state === AgentState.IDLE ||
    agent.state === AgentState.RUNNING
  );

  return (
    <div
      className={cn(
        "group flex items-center transition-colors rounded-lg hover:bg-lightest dark:hover:bg-darkest bg-background dark:bg-background-darker"
      )}
    >
      <div
        className="flex-1 flex flex-col gap-1 pl-4 py-3 text-sm cursor-pointer"
        onClick={() => onEdit(automation)}
      >
        <div className="flex items-center justify-between gap-2 flex-1 min-w-0">
          <span className="truncate text-sm font-medium">{automation.name}</span>
        </div>
        <span className="text-xs text-muted-foreground truncate">
          {getTriggerLabel()}
          {automation.trigger.fileGlob && ` (${automation.trigger.fileGlob})`}
          {automation.trigger.commandRegex && ` (${automation.trigger.commandRegex})`}
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger className='opacity-0 group-hover:opacity-100 h-fit rounded-full p-1.5 bg-muted/50 hover:!bg-constructive/50' asChild onClick={(e) => e.stopPropagation()}>
          <button
            className="p-1 rounded hover:bg-muted/50 transition-colors"
            disabled={isTriggering}
          >
            <div className={cn(
              "h-4 w-4 text-muted-foreground shrink-0",
              isTriggering && "opacity-50"
            )}><Play className="max-h-full max-w-full text-inherit" /></div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="min-w-[280px] max-w-[320px] border-(length:--border-width) border-muted/30">
          <DropdownMenuLabel>Run on agent</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {runnableAgents.length > 0 ? (
            runnableAgents.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                variant="transparent"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTriggerAutomation(agent.id);
                }}
                className="p-0 h-auto"
              >
                <div className="flex flex-col gap-1 p-3 w-full text-sm">
                  {/* Agent name + status */}
                  <div className="flex items-center gap-1 w-full">
                    <span className="truncate text-xs font-medium">{agent.name}</span>
                    <div className={cn(
                      "w-1 h-1 ml-1 rounded-full flex-shrink-0",
                      getAgentStatusBgColor(agent.state as AgentState)
                    )} />
                    <span className={cn(
                      "text-xs",
                      getAgentStatusColor(agent.state as AgentState)
                    )}>{agentStateToString(agent.state as AgentState)}</span>
                  </div>
                  {/* Task summary (AI-generated) */}
                  {agent.taskSummary && (
                    <div className="text-base text-foreground/70 truncate w-full">
                      {agent.taskSummary}
                    </div>
                  )}
                </div>
              </DropdownMenuItem>
            ))
          ) : (
            <div className="px-3 py-4 text-left text-sm text-muted-foreground">
              {agents.length === 0 ? (
                <p>No agents available.<br />Create an agent to run this automation.</p>
              ) : (
                <p>No agents ready to run automations.<br />Agents must be in Ready or Working state.</p>
              )}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="px-3 text-muted-foreground/0 group-hover:text-foreground/50"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontalIcon className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px] border-(length:--border-width) border-muted/30">
          <DropdownMenuItem
            variant="transparent"
            onClick={() => onDuplicate(automation.id)}
          >
            <Copy className="h-4 w-4 mr-2" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="transparent"
            hoverVariant="destructive"
            onClick={() => onDelete(automation.id)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function AutomationsSidebar({
  automations,
  onEdit,
  onDelete,
  onDuplicate,
  onAdd,
  agents,
  onTriggerAutomation,
}: AutomationsSidebarProps) {
  return (
    <div className="w-full flex-2 min-h-0 flex flex-col gap-2 pt-3 md:pt-2">
      {/* Machine Specs Button */}
      <div className="w-full">
        <MachineSpecsDialog />
      </div>

      {/* Automations List */}
      <div className="flex flex-col gap-2 h-full overflow-y-auto min-h-0 w-full">
        <button
          className={cn(
            "flex items-center gap-2 pl-3 pr-4 py-2 text-xs rounded-lg text-muted-foreground hover:text-constructive-foreground hover:bg-constructive/30 transition-colors w-fit",
          )}
          onClick={onAdd}
        >
          <Plus className="h-4 w-4 flex-shrink-0" />
          <span>Add Automation</span>
        </button>
        {automations.map((automation) => (
          <AutomationItem
            key={automation.id}
            automation={automation}
            onEdit={onEdit}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            agents={agents}
            onTriggerAutomation={onTriggerAutomation}
          />
        ))}
      </div>
    </div>
  );
}
