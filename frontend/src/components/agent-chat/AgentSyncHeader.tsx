import { useState, useEffect } from 'react';
import { Loader2, ExternalLink, Info } from 'lucide-react';
import { Agent, AgentState } from '@/bindings/types';
import { useNetworkForwarding } from '@/hooks/useNetworkForwarding';
import { portBridgeService } from '@/services/port-bridge.service';
import { useIDEIntegration } from '@/hooks/useIDEIntegration';
import { Switch } from '@/components/ui/switch';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu-item';
import { ProjectWorkspace, useAppStore } from '@/stores/useAppStore';
import { agentStateToString, getAgentStatusColor } from "@/components/agent-chat/utils.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAgentPeremption } from '@/hooks/useAgentPeremption';
import { SelectGroupRoot, SelectGroupOption } from '@/components/ui/select-group';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { useAgentAccesses } from '@/hooks/useAgentAccesses';
import { useTerminalStore } from '@/hooks/useTerminalStore';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '../ui/tooltip';
import { agentCreationService, getMachineIP } from '@/services/agent.service';
import { useToast } from '@/hooks/use-toast';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { getTauriAPI } from '@/lib/tauri-api';
import Chat from '../ui/icons/Chat';
import FileView from '../ui/icons/FileView';
import Clock from '../ui/icons/Clock';
import LiveStream from '../ui/icons/LiveStream';
import TerminalUse from '../ui/icons/TerminalUse';
import Eye from '../ui/icons/Eye';
import Play from '../ui/icons/Play';
import Copy from '../ui/icons/Copy';
import CheckmarkCircle from '../ui/icons/CheckmarkCircle';
import { OpenInIDEButton } from '../OpenInIDEButton';
import { Automation } from '@/hooks/useAutomations';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import Computer from '../ui/icons/Computer';
import WebAiUse from '../ui/icons/WebAiUse';
import { StoppedAgentIndicator } from '../agent-manager/StoppedAgentIndicator';
import GitMerge from '../ui/icons/GitMerge';
import LinkSquare from '../ui/icons/LinkSquare';
import { useServicePreviewability } from './hooks/useServicePreviewability';

interface AgentChatHeaderProps {
  projectWorkspace: ProjectWorkspace;
  agent: Agent;
  allAgents?: Agent[];
  lastPrompt?: string | null;
  canUseTerminals?: boolean;
  isTerminalOpen?: boolean;
  onToggleTerminal?: () => void;
  viewMode?: string;
  onViewModeChange?: (mode: string) => void;
  automations?: Automation[];
  onTriggerAutomation?: (automationId: string, agentId: string) => Promise<void>;
  isFocused?: boolean;
  previewablePortsCount?: number;
}

const tauriAPI = getTauriAPI();

export function AgentChatHeader({
  projectWorkspace,
  agent,
  lastPrompt,
  canUseTerminals,
  isTerminalOpen,
  onToggleTerminal,
  viewMode = 'conversation',
  onViewModeChange,
  automations = [],
  onTriggerAutomation,
  isFocused = true,
  previewablePortsCount = 0,
}: AgentChatHeaderProps) {
  const { isWarning, timeLeft } = useAgentPeremption(agent);
  const lifetimeUnitMinutes = useAppStore(state => state.agentLifetimeUnitMinutes);
  const { toast } = useToast();
  const [extendingLifetime, setExtendingLifetime] = useState(false);
  const [extendHours, setExtendHours] = useState(1); // Default to 1 hour
  const [isRebooting, setIsRebooting] = useState(false);

  const { forwardedAgentId, activePorts, stickyActivePorts, startForwarding, stopForwarding, startPolling, stopPolling } = useNetworkForwarding();
  const [isTogglingNetwork, setIsTogglingNetwork] = useState(false);
  const [togglingPort, setTogglingPort] = useState<number | null>(null);
  const [optimisticVisibility, setOptimisticVisibility] = useState<Map<number, 'private' | 'public'>>(new Map());
  

  // IDE integration - used for SSH opening
  const { openInIDEViaSSH } = useIDEIntegration(projectWorkspace.id);

  // Filter function for IDEs that support SSH deeplinks (exclude neovim, jetbrains)
  const sshSupportedIDEFilter = (ide: { id: string }) =>
    ['vscode', 'cursor', 'windsurf', 'zed'].includes(ide.id);

  // Access and browser checks
  const isBrowser = useIsBrowser();
  const { accessMap } = useAgentAccesses();
  const access = accessMap.get(agent.id);
  const hasWriteAccess = access?.access === 'write';
  const hasReadAccess = access !== undefined;
  const currentUser = useAppStore(state => state.user);
  const isOwner = currentUser?.id === agent.userId;

  // Auto-poll ports when this agent's tab is focused and machine is ready.
  // Use a derived boolean so we don't restart polling on every state transition
  // within the active set (e.g. RUNNING -> IDLE -> RUNNING).
  const machineActiveStates: string[] = [AgentState.READY, AgentState.RUNNING, AgentState.IDLE, AgentState.ARCHIVING];
  const isMachineActive = machineActiveStates.includes(agent.state);
  useEffect(() => {
    if (isFocused && isMachineActive) {
      startPolling(agent.id);
    }
    return () => {
      // Only stop if we started it - stopPolling already guards against stopping forwarded agents
      stopPolling(agent.id);
    };
  }, [isFocused, agent.id, isMachineActive]);

  // Desktop availability based on agent state
  const desktopActiveStates: string[] = [AgentState.READY, AgentState.RUNNING, AgentState.IDLE, AgentState.ARCHIVING];
  const desktopPreReadyStates: string[] = [AgentState.PROVISIONING, AgentState.PROVISIONED, AgentState.CLONING];
  const isDesktopAvailable = desktopActiveStates.includes(agent.state);
  const desktopUnavailableReason = desktopPreReadyStates.includes(agent.state)
    ? "Machine isn't ready yet"
    : agent.state === AgentState.ARCHIVED
      ? 'Agent is stopped. Send a prompt to reactivate it.'
      : agent.state === AgentState.ERROR
        ? 'Desktop is not available while agent is in error state'
        : 'Desktop is not available';

  // Fetch users who have access to this agent (excluding current user)
  const [sharedWith, setSharedWith] = useState<Array<{ userId: string; access: string; profile: { name: string; image: string | null } }>>([]);

  useEffect(() => {
    const fetchSharedWith = async () => {
      try {
        const API_URL = import.meta.env.VITE_API_URL;
        const response = await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/shared-with`, {
          credentials: 'include'
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.accesses) {
            // Filter out the current user from the shared list
            const otherUsers = data.accesses.filter((a: any) => a.userId !== currentUser?.id);
            setSharedWith(otherUsers);
          }
        }
      } catch (error) {
        console.error('Failed to fetch agent shared with:', error);
      }
    };

    fetchSharedWith();
  }, [agent.id, currentUser?.id]);

  // Check if this agent is currently forwarding
  const isForwardingNetwork = forwardedAgentId === agent.id;

  // State for automation triggers
  const [isTriggeringAutomation, setIsTriggeringAutomation] = useState(false);
  const [environmentAutomations, setEnvironmentAutomations] = useState<string[]>([]); // Array of automation IDs

  // Fetch automations for this agent's environment
  useEffect(() => {
    const fetchEnvironmentAutomations = async () => {
      if (!agent.environmentId) {
        setEnvironmentAutomations([]);
        return;
      }

      try {
        const API_URL = import.meta.env.VITE_API_URL;
        const response = await authenticatedFetch(
          `${API_URL}/api/projects/${projectWorkspace.id}/environments/${agent.environmentId}/automations`
        );

        if (response.ok) {
          const data = await response.json();
          if (data.automations) {
            setEnvironmentAutomations(data.automations.map((a: any) => a.id));
          }
        }
      } catch (error) {
        console.error('Failed to fetch environment automations:', error);
      }
    };

    fetchEnvironmentAutomations();

    // Poll every 10 seconds if environment exists
    const interval = agent.environmentId ? setInterval(fetchEnvironmentAutomations, 10000) : null;

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [agent.id, agent.environmentId, projectWorkspace.id]);

  // Check if agent is in a valid state to run automations
  // ARCHIVED agents auto-resume when actions are triggered
  const canRunAutomations = agent.state === AgentState.READY ||
                           agent.state === AgentState.IDLE ||
                           agent.state === AgentState.RUNNING ||
                           agent.state === AgentState.ARCHIVED;

  // Organize automations into 3 categories (sorted alphabetically within each):
  // 1. In environment + manual trigger
  // 2. In environment + other triggers (non-manual)
  // 3. Other automations (not in the current environment)
  const sortByName = (a: Automation, b: Automation) => a.name.localeCompare(b.name);

  const inEnvManual = automations
    .filter(automation => environmentAutomations.includes(automation.id) && automation.trigger.type === 'manual')
    .sort(sortByName);

  const inEnvOther = automations
    .filter(automation => environmentAutomations.includes(automation.id) && automation.trigger.type !== 'manual')
    .sort(sortByName);

  const notInEnv = automations
    .filter(automation => !environmentAutomations.includes(automation.id))
    .sort(sortByName);

  const hasAnyAutomations = automations.length > 0;

  // Cleanup effect: Stop network forwarding and close terminals when agent is archived
  useEffect(() => {
    if (agent.state === AgentState.ARCHIVED) {
      // Stop network forwarding if this agent is currently forwarding
      if (isForwardingNetwork) {
        console.log(`[AgentChatHeader] Agent ${agent.id} archived - stopping network forwarding`);
        stopForwarding();
      }

      // Close all terminals for this agent
      const clearTerminals = async () => {
        console.log(`[AgentChatHeader] Agent ${agent.id} archived - closing all terminals`);
        await useTerminalStore.getState().clearAgentTerminals(agent.id);
      };
      clearTerminals();

      // Cleanup SSH config entry
      const cleanupSSH = async () => {
        try {
          console.log(`[AgentChatHeader] Agent ${agent.id} archived - cleaning up SSH config`);
          await tauriAPI.invoke('cleanup_agent_ssh_config', { agentId: agent.id });
        } catch (error) {
          console.error(`[AgentChatHeader] Failed to cleanup SSH config for agent ${agent.id}:`, error);
        }
      };
      cleanupSSH();
    }
  }, [agent.state, agent.id, isForwardingNetwork, stopForwarding]);

  const handleToggleNetwork = async () => {
    setIsTogglingNetwork(true);
    try {
      if (isForwardingNetwork) {
        // Stop port forwarding
        await stopForwarding();
      } else {
        // Start port forwarding
        await startForwarding(agent.id);
      }
    } catch (error) {
      console.error('Failed to toggle network forwarding:', error);
    } finally {
      setIsTogglingNetwork(false);
    }
  };

  const handlePortVisibilityChange = async (port: number, visibility: 'private' | 'public') => {
    // Optimistically update UI immediately
    setOptimisticVisibility(prev => new Map(prev).set(port, visibility));
    setTogglingPort(port);

    try {
      const success = await portBridgeService.setPortVisibility(agent.id, port, visibility);
      if (!success) {
        // Revert optimistic update on failure
        setOptimisticVisibility(prev => {
          const next = new Map(prev);
          next.delete(port);
          return next;
        });
      }
    } catch {
      // Revert optimistic update on error
      setOptimisticVisibility(prev => {
        const next = new Map(prev);
        next.delete(port);
        return next;
      });
    } finally {
      setTogglingPort(null);
      // Clear optimistic override after polling has had time to sync
      // Chain: API → agent-server ufw scan (5s) → backend poll → frontend poll (5s)
      setTimeout(() => {
        setOptimisticVisibility(prev => {
          const next = new Map(prev);
          next.delete(port);
          return next;
        });
      }, 15000);
    }
  };


  // Check if agent can have lifetime extended (not archived)
  const canExtendLifetime = agent.state !== AgentState.ARCHIVED;

  const handleExtendLifetime = async () => {
    if (extendingLifetime || !canExtendLifetime || extendHours <= 0) return;

    setExtendingLifetime(true);
    try {
      const result = await agentCreationService.extendAgentLifetime(agent.id, extendHours);

      if (result.success) {
        toast({
          title: 'Lifetime Extended',
          description: `Agent lifetime extended by ${extendHours} hour${extendHours !== 1 ? 's' : ''} (total: ${result.totalHours?.toFixed(1)} hours)`,
        });
      } else if (!result.limitExceeded) {
        // Only show toast if this is NOT a limit error (limit dialog is already shown)
        toast({
          title: 'Failed to Extend Lifetime',
          description: result.error || 'Unknown error',
          variant: 'destructive'
        });
      }
      // If limitExceeded is true, don't show toast - dialog was already shown
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to extend lifetime',
        variant: 'destructive'
      });
    } finally {
      setExtendingLifetime(false);
    }
  };

  const handleForceReboot = async () => {
    if (isRebooting) return;

    setIsRebooting(true);
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/force-reboot`, {
        method: 'POST',
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Reboot Initiated',
          description: 'Agent is being rebooted with a fresh machine. This may take a few moments.',
        });
      } else if (result.code === 'LIMIT_EXCEEDED') {
        toast({
          title: 'Monthly Limit Reached',
          description: result.error || 'You have reached your monthly agent limit',
          variant: 'destructive'
        });
      } else {
        toast({
          title: 'Reboot Failed',
          description: result.error || 'Unknown error',
          variant: 'destructive'
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to reboot agent',
        variant: 'destructive'
      });
    } finally {
      setIsRebooting(false);
    }
  };

  const handleTriggerAutomation = async (automationId: string) => {
    if (!onTriggerAutomation) return;

    setIsTriggeringAutomation(true);
    try {
      await onTriggerAutomation(automationId, agent.id);
      const automation = automations.find(a => a.id === automationId);
    } catch (error) {
      toast({
        title: 'Failed to trigger automation',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsTriggeringAutomation(false);
    }
  };
  const [showIDEInstructionsDialog, setShowIDEInstructionsDialog] = useState(false);
  const [ideInstructions, setIdeInstructions] = useState('');

  // Handler for opening in IDE via SSH - called by OpenInIDEButton
  const handleOpenInIDEViaSSH = async (ideId: string) => {
    // Get machine IP and SSH user
    const machineIP = useAppStore.getState().getMachineIP(agent.id);
    const sshUser = useAppStore.getState().getSSHUser(agent.id) || 'ariana';

    if (!machineIP) {
      toast({
        title: 'Machine IP Not Available',
        description: 'Please wait for the agent to be fully ready.',
        variant: 'destructive'
      });
      return;
    }

    try {
      await openInIDEViaSSH(
        agent.id,
        projectWorkspace.name,
        machineIP,
        sshUser,
        `/home/${sshUser}/project`,
        ideId
      );

      toast({
        title: 'Opening in IDE',
        description: `Opening remote project via SSH in your IDE...`,
      });
    } catch (error) {
      console.error('Failed to open in IDE via SSH:', error);

      // Show instructions dialog for unsupported IDEs
      if (error instanceof Error && error.message.includes('require manual setup')) {
        setIdeInstructions(error.message);
        setShowIDEInstructionsDialog(true);
      } else {
        toast({
          title: 'Failed to Open in IDE',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive'
        });
      }
    }
  };

  // Get machine IP for public port links
  const machineIp = useAppStore(state => state.getMachineIP(agent.id));

  // Check if agent is ready for machine-dependent features
  // ARCHIVED agents are included - they auto-resume when features are used
  const isMachineReady = () => {
    const state = agent.state as AgentState;
    return ![
      AgentState.PROVISIONING,
      AgentState.PROVISIONED,
      AgentState.CLONING,
    ].includes(state);
  };

  const agentStatusColor: string = getAgentStatusColor(agent.state as any);
  const agentStatusText: string = agentStateToString(agent.state as any);


  return (
    <div className="absolute z-30 top-0 left-0 flex px-1 lg:px-2 md:py-1 md:pb-2 w-full flex-col text-xs ">
      {/* First line - Agent info */}
      <div className="relative h-11 flex items-center px-0.5 justify-start gap-2">
        {/* <div className="flex lg:hidden"></div> */}
        <div className="flex items-center px-2.5 h-8 rounded-lg bg-lightest dark:bg-background-darker text-muted-foreground gap-3">
          {/* Work Status */}
          {agent.state === AgentState.ARCHIVED ? (
            <div className="px-1">
              <StoppedAgentIndicator agentId={agent.id} showDot={false} />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-1">
              <span className={agentStatusColor}>{agentStatusText}</span>
            </div>
          )}
          {agent.state !== AgentState.ARCHIVED && agent.machineType !== 'custom' && (
            <div className="hover:opacity-100 rounded-full px-0 py-1.5 flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    {isWarning ? (
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-4"><Clock className="max-w-full max-h-full text-amber-500" /></div>
                      </div>
                    ) : (
                      <div className="h-4 w-4"><Clock className="max-w-full max-h-full text-muted-foreground" /></div>
                    )}
                  </TooltipTrigger>
                  <TooltipContent className="flex w-[35ch] flex-col gap-2 p-3">
                    <span className='text-sm'>
                      Agent's computer will auto-shutdown in: <span className="font-medium">{timeLeft}</span> if you don't interact with it. 
                    </span>
                    <span className="text-xs">
                      After shutdown, interacting with the agent will automatically start it on a new computer. All your changes are conserved.
                    </span>
                    <div className="flex flex-col gap-2 mt-1">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={!canExtendLifetime || extendingLifetime || extendHours <= 1}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExtendHours(Math.max(1, extendHours - 1));
                          }}
                          className="h-7 w-7 p-0"
                        >
                          -
                        </Button>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min="1"
                            max="24"
                            value={extendHours}
                            onChange={(e) => {
                              const value = parseInt(e.target.value);
                              if (!isNaN(value) && value > 0) {
                                setExtendHours(Math.min(24, value));
                              }
                            }}
                            onFocus={(e) => e.target.select()}
                            disabled={!canExtendLifetime || extendingLifetime}
                            className="w-12 h-7 text-center text-xs border rounded px-1"
                          />
                          <span className="text-xs text-muted-foreground">hour{extendHours !== 1 ? 's' : ''}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="default"
                          disabled={!canExtendLifetime || extendingLifetime || extendHours >= 24}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExtendHours(Math.min(24, extendHours + 1));
                          }}
                          className="h-7 w-7 p-0"
                        >
                          +
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        hoverVariant="background"
                        disabled={!canExtendLifetime || extendingLifetime || extendHours <= 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExtendLifetime();
                        }}
                        className="text-xs h-7 px-2 w-full"
                      >
                        {extendingLifetime ? 'In progress...' : `Delay for ${extendHours} hour${extendHours !== 1 ? 's' : ''}`}
                      </Button>
                      <div className="flex items-center gap-1 mt-1">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-xs text-muted-foreground px-1">Advanced</span>
                        <div className="h-px flex-1 bg-border" />
                      </div>
                      <Button
                        size="sm"
                        variant="default"
                        hoverVariant="background"
                        disabled={!canExtendLifetime || isRebooting}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleForceReboot();
                        }}
                        className="text-xs h-7 px-2 w-full"
                      >
                        {isRebooting ? 'Rebooting...' : 'Move to a new machine'}
                      </Button>
                    </div>
                    <span className="text-xs text-muted-foreground/70 mt-2">
                      *Resuming or delaying auto-shutdown & moving to a new machine counts towards your monthly Ariana use.
                    </span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          {/* Shared with users */}
          {sharedWith.length > 0 && (
            <div className="flex items-center gap-1.5">
              <TooltipProvider delayDuration={0}>
                <div className="flex items-center -space-x-2">
                  {sharedWith.map((shared, idx) => (
                    <Tooltip key={shared.userId}>
                      <TooltipTrigger asChild>
                        <div
                          className="relative h-6 w-6 rounded-full bg-background flex items-center justify-center overflow-hidden transition-all border-(length:--border-width) hover:border-accent/50 border-transparent hover:saturate-100 saturate-50 cursor-pointer"
                          style={{ zIndex: sharedWith.length - idx }}
                        >
                          {shared.profile.image ? (
                            <img
                              src={shared.profile.image}
                              alt={shared.profile.name}
                              className="h-full w-full object-cover opacity-50"
                            />
                          ) : (
                            <div className="h-4 w-4">
                              <Eye className="max-h-full max-w-full text-muted-foreground" />
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs p-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{shared.profile.name}</span>
                          <span className="text-muted-foreground capitalize">{shared.access} access</span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </TooltipProvider>
            </div>
          )}
        </div>

        <div className={cn(
          "mr-auto w-fit flex justify-center items-center gap-1 h-fit"
        )}>
          {/* View mode selector */}
          {onViewModeChange && (
            <SelectGroupRoot
              value={viewMode}
              onValueChange={(value) => onViewModeChange(value)}
              orientation="horizontal"
              className="h-fit "
              inverted
              rounded={false}
            >
              <SelectGroupOption value="conversation" className='h-7'>
                <div className='w-4 h-4 md:mr-2'>
                  <Chat className="max-h-full max-w-full mr-1.5 text-inherit" />
                </div>
                <span className='text-xs hidden md:block'>Chat</span>
              </SelectGroupOption>
              <SelectGroupOption value="diffs" className='h-7'>
                <div className='w-4 h-4 md:mr-2'>
                  <FileView className="max-h-full max-w-full mr-1.5 text-inherit" />
                </div>
                <span className='text-xs hidden md:block'>Diffs</span>
              </SelectGroupOption>
              {/* Web Previews tab - shown when there are active ports (sticky to avoid flicker) */}
              {stickyActivePorts.length > 0 && (
                <SelectGroupOption value="web-previews" className='h-7'>
                  <div className='w-4 h-4 md:mr-2'>
                    <WebAiUse className="max-h-full max-w-full mr-1.5 text-inherit" />
                  </div>
                  <span className='text-xs hidden md:block'>Web Previews{previewablePortsCount > 0 ? ` (${previewablePortsCount})` : ''}</span>
                  <span className='text-xs md:hidden'>Web</span>
                </SelectGroupOption>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <SelectGroupOption value="desktop" className='h-7' disabled={!isDesktopAvailable}>
                      <div className='w-4 h-4 md:mr-2'>
                        <Computer className="max-h-full max-w-full mr-1.5 text-inherit" />
                      </div>
                      <span className='text-xs hidden md:block'>Desktop</span>
                    </SelectGroupOption>
                  </span>
                </TooltipTrigger>
                {!isDesktopAvailable && (
                  <TooltipContent side="bottom">
                    {desktopUnavailableReason}
                  </TooltipContent>
                )}
              </Tooltip>
            </SelectGroupRoot>
          )}
        </div>

        {/* PR link island */}
        {agent.prUrl && (
          <button
            onClick={async () => {
              if (isBrowser) {
                window.open(agent.prUrl!, '_blank');
              } else {
                await openUrl(agent.prUrl!);
              }
            }}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-lightest dark:bg-background-darker text-xs underline-offset-4 hover:underline transition-colors",
              agent.prState === 'merged' ? 'text-constructive-foreground' :
              agent.prState === 'closed' ? 'text-destructive-foreground' :
              'text-accent'
            )}
          >
            <div className="h-4 w-4 flex-shrink-0">
              <GitMerge className="max-h-full max-w-full text-inherit" />
            </div>
            <span className="md:hidden">See PR</span>
            <span className="hidden md:inline">
              See PR{agent.prNumber ? ` #${agent.prNumber}` : ''}
            </span>
            <div className="h-3 w-3 flex-shrink-0 opacity-60">
              <LinkSquare className="max-h-full max-w-full text-inherit" />
            </div>
          </button>
        )}

        {/* Right side - View Mode, Terminals, Network & Sync toggles */}
        {isMachineReady() && (
          <div className="flex items-center gap-0.5 p-0.5 bg-lightest dark:bg-background-darker h-8 rounded-lg">
            {/* Open in IDE via SSH - hide if browser mode or no read access */}
            {!isBrowser && hasReadAccess && (
              <OpenInIDEButton
                projectId={projectWorkspace.id}
                size="large"
                filterIDEs={sshSupportedIDEFilter}
                onOpen={handleOpenInIDEViaSSH}
                disabled={!machineIp}
                getButtonText={(ideName) => (
                  <>
                    <span className='hidden xl:block'>
                      Open in {ideName || 'IDE'} <span className="text-[9px] opacity-50">SSH</span>
                    </span>
                  </>
                )}
                showIcon={true}
              />
            )}

            {/* Terminals & SSH button - hide if browser mode or no read access */}
            {canUseTerminals && !isBrowser && hasReadAccess && (
              <Button
                onClick={onToggleTerminal}
                variant={isTerminalOpen ? "default" : "transparent"}
                className="flex items-center gap-1.5 text-xs px-2 py-1 h-full transition-colors"
              >
                <div className="h-4 w-4"><TerminalUse className="max-h-full max-w-full text-inherit" /></div>
                <span className='hidden xl:block'>Terminals <span className="text-[9px] opacity-50">SSH</span></span>
              </Button>
            )}

            {/* Automations dropdown - show if there are any automations */}
            {hasAnyAutomations && hasReadAccess && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={isTriggeringAutomation || !canRunAutomations}
                    variant="transparent"
                    className="flex items-center gap-1.5 text-xs px-2 py-1 h-full transition-colors"
                  >
                    {isTriggeringAutomation ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <>
                        <div className="h-4 w-4"><Play className="max-h-full max-w-full text-inherit" /></div>
                        <span className='hidden xl:block'>Automations</span>
                      </>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[220px] border-(length:--border-width) border-muted/30">
                  <DropdownMenuLabel>Run automation</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {/* Category 1: In environment + manual */}
                  {inEnvManual.map((automation) => (
                    <DropdownMenuItem
                      key={automation.id}
                      variant="transparent"
                      onClick={() => handleTriggerAutomation(automation.id)}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="text-sm font-medium truncate">{automation.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {automation.scriptLanguage}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                  {/* Separator between category 1 and 2 */}
                  {inEnvManual.length > 0 && inEnvOther.length > 0 && (
                    <DropdownMenuSeparator />
                  )}
                  {/* Category 2: In environment + other triggers */}
                  {inEnvOther.map((automation) => (
                    <DropdownMenuItem
                      key={automation.id}
                      variant="transparent"
                      onClick={() => handleTriggerAutomation(automation.id)}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="text-sm font-medium truncate">{automation.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {automation.scriptLanguage}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                  {/* Separator between category 2 (or 1 if 2 is empty) and 3 */}
                  {(inEnvManual.length > 0 || inEnvOther.length > 0) && notInEnv.length > 0 && (
                    <DropdownMenuSeparator />
                  )}
                  {/* Category 3: Other automations (not in environment) */}
                  {notInEnv.map((automation) => (
                    <DropdownMenuItem
                      key={automation.id}
                      variant="transparent"
                      onClick={() => handleTriggerAutomation(automation.id)}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="text-sm font-medium truncate">{automation.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {automation.scriptLanguage}
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Network forwarding dropdown - hide if browser mode or no read access */}
            {hasReadAccess && (
            <DropdownMenu onOpenChange={async (open) => {
              if (open) {
                startPolling(agent.id);
                // Fetch machine IP if we don't have it (for displaying public URLs)
                if (!machineIp) {
                  try {
                    await getMachineIP(agent.id);
                  } catch (error) {
                    console.error('Failed to fetch machine IP:', error);
                  }
                }
              } else {
                stopPolling(agent.id);
              }
            }}>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={isTogglingNetwork}
                  variant={isForwardingNetwork ? "default" : "transparent"}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 h-full transition-colors"
                >
                  {isTogglingNetwork ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : isForwardingNetwork ? (
                    <>
                      <div className="h-4 w-4"><LiveStream className="max-h-full max-w-full text-constructive-foreground" /></div>
                      <span className='hidden xl:block text-constructive-foreground'>Network <span className='text-[9px] opacity-50'>forwarding ON</span></span>
                      <div className="h-1.5 w-1.5 bg-constructive rounded-full animate-pulse ml-1" />
                    </>
                  ) : (
                    <>
                      <div className="h-4 w-4"><LiveStream className="max-h-full max-w-full text-inherit" /></div>
                      <span className='hidden xl:block'>Network</span>
                    </>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[38ch] md:w-[45ch] p-3 border-(length:--border-width) border-muted/40 bg-background-darker" align="end">
                <div className="flex flex-col gap-3">
                  {!isBrowser && (
                    <div className="flex gap-3 items-start">
                      <div className="flex-1 flex items-start gap-2 text-xs text-muted-foreground">
                        <Info className="h-4 w-4 mt-0.5 shrink-0" />
                        <p>
                          {'Forward localhost servers running on your agent\'s VPS to your localhost via encrypted SSH tunnel, or make them publicly accessible'}
                        </p>
                      </div>

                      {/* Start/Stop Forwarding switch - only for write users */}
                      {(
                        <div className="flex gap-2 items-center shrink-0">
                          <span className="text-xs text-muted-foreground">
                            {isForwardingNetwork ? 'Forwarding' : 'Not Forwarding'}
                          </span>
                          <Switch
                            checked={isForwardingNetwork}
                            onCheckedChange={handleToggleNetwork}
                            disabled={isTogglingNetwork}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {/* Services table */}
                  <div className="flex flex-col mt-2">
                    <div className="text-xs font-semibold text-foreground mb-2">
                      Available Services ({activePorts.length})
                    </div>
                    {activePorts.length > 0 ? (
                      activePorts.map((port, index) => {
                        const isLocalhost = port.listenAddress === '127.0.0.1' || port.listenAddress === '::1' || port.listenAddress === 'localhost';
                        const isPublicInterface = port.listenAddress === '0.0.0.0' || port.listenAddress === '::';
                        const canBePublic = isPublicInterface;

                        return (
                          <div
                            key={`${port.port}-${port.listenAddress}-${index}`}
                            className="flex flex-col gap-1 py-1 mb-0.5 px-2 rounded-md transition-colors"
                          >
                            {/* Main row */}
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{port.program}</span>
                                <span className="text-xs text-muted-foreground/50">:{port.port}</span>
                              </div>

                              {isForwardingNetwork && (
                                <div className="flex gap-2 text-xs">
                                  <span className="text-muted-foreground/50">forwarded to:</span>
                                  <a
                                    href={`http://localhost:${port.port}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-accent hover:underline flex items-center gap-1 shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    localhost:{port.port}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                              )}
                            </div>

                            {/* Public access row - only show for services on 0.0.0.0 */}
                            {canBePublic ? (() => {
                              const effectiveVisibility = optimisticVisibility.get(port.port) ?? port.visibility;
                              const isPublic = effectiveVisibility === 'public';
                              const publicUrl = port.url || (machineIp ? `http://${machineIp}:${port.port}` : null);
                              const displayUrl = port.url
                                ? port.url.replace(/^https?:\/\//, '')
                                : (machineIp ? `${machineIp}:${port.port}` : null);

                              return (
                                <div className="text-xs flex items-center gap-2">
                                  <span className="text-muted-foreground">public</span>
                                  {hasWriteAccess ? (
                                    <Switch
                                      checked={isPublic}
                                      onCheckedChange={(checked) =>
                                        handlePortVisibilityChange(port.port, checked ? 'public' : 'private')
                                      }
                                      disabled={togglingPort === port.port}
                                      className="scale-75"
                                    />
                                  ) : (
                                    <span className={cn(
                                      "font-medium",
                                      isPublic ? "text-amber-500" : "text-muted-foreground/50"
                                    )}>
                                      {isPublic ? 'yes' : 'no'}
                                    </span>
                                  )}
                                  {isPublic && publicUrl && (
                                    port.url ? (
                                      <a
                                        href={publicUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-amber-500 hover:text-amber-400 font-mono hover:underline flex items-center gap-1 truncate"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        {displayUrl}
                                        <ExternalLink className="h-3 w-3 shrink-0" />
                                      </a>
                                    ) : (
                                      <span className="text-muted-foreground/60 italic">https url is being prepared...</span>
                                    )
                                  )}
                                </div>
                              );
                            })() : (
                              <div className="flex items-center gap-2 opacity-50 text-[9px]">
                                cannot be made public (probably not listening to 0.0.0.0)
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-muted-foreground text-center py-4">
                        No services running
                      </div>
                    )}
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </div>
        )}
      </div>

      {/* IDE Setup Instructions Dialog */}
      <Dialog open={showIDEInstructionsDialog} onOpenChange={setShowIDEInstructionsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>IDE Setup Instructions</DialogTitle>
            <DialogDescription>
              Follow these steps to connect to your agent via SSH
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <pre className="p-4 rounded-md bg-muted text-xs whitespace-pre-wrap font-mono">
              {ideInstructions}
            </pre>
          </div>

          <DialogFooter>
            <Button
              variant="default"
              onClick={() => setShowIDEInstructionsDialog(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
