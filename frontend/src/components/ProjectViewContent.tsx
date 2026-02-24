import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AgentChat } from '@/components/agent-chat/AgentChat.tsx';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Plus, X } from 'lucide-react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Modifier to restrict drag to horizontal axis only
const restrictToHorizontalAxis: Modifier = ({ transform }) => {
  return {
    ...transform,
    y: 0,
  };
};
import { ProjectWorkspace, useAppStore } from '@/stores/useAppStore';
import { Agent, AgentState, ProjectRole } from '@/bindings/types';
import { useAgents } from '@/hooks/useAgents';
import { uploadSSHKeyAndGetIP, getMachineIP, agentCreationService } from '@/services/agent.service';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { AgentSidebar } from './agent-manager/AgentSidebar';
import { useToast } from '@/hooks/use-toast';
import { EnvironmentsSidebar } from './agent-manager/EnvironmentsSidebar';
import { AutomationsSidebar } from './agent-manager/AutomationsSidebar';
import { AgentConfigDropdown } from './agent-manager/AgentConfigDropdown';
import type { AgentConfig } from '@/types/AgentConfig';
import { useNetworkForwarding } from '@/hooks/useNetworkForwarding';
import type { UseAgentCreationReturn } from '@/hooks/useAgentCreation';
import { SelectGroupOption, SelectGroupRoot } from './ui/select-group';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { showPoolExhaustedToast } from '@/lib/poolExhaustedToast';
import { EnvironmentEditor } from './environments/EnvironmentEditor';
import { useEnvironments } from '@/hooks/useEnvironments';
import { AutomationEditor } from './automations/AutomationEditor';
import { useAutomations } from '@/hooks/useAutomations';
import { posthog } from '@/lib/posthog';
import { BodyTab, SidebarTabs } from '@/lib/tabs';
import Logo from './ui/logo';
import { useRouter } from '@/hooks/useRouter';
import { useProjectTabs } from '@/hooks/useProjectTabs';
import { useAutomationsEditors } from '@/hooks/useAutomationsEditors';
import { useEnvironmentsEditors } from '@/hooks/useEnvironmentsEditors';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Stable empty array reference to avoid infinite re-renders
const EMPTY_AGENTS: Agent[] = [];

interface AgentManagerProps {
  projectWorkspace: ProjectWorkspace;
  onProjectMerged?: (newProjectId: string, repositoryId?: string) => void;
  initialAgentId?: string;
  agentCreation: UseAgentCreationReturn;
  currentUserRole: ProjectRole | null;
}

// SortableTab component for drag and drop
interface SortableTabProps {
  id: string;
  tab: BodyTab;
  isFocused: boolean;
  isInteracted: boolean;
  hasUnsaved: boolean;
  isLast: boolean;
  isNextFocused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  getTabName: () => string;
  getTabIcon: () => React.ReactNode;
  disabled?: boolean;
}

function SortableTab({
  id,
  tab,
  isFocused,
  isInteracted,
  hasUnsaved,
  isLast,
  isNextFocused,
  onFocus,
  onClose,
  onContextMenu,
  getTabName,
  getTabIcon,
  disabled,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      onClick={onFocus}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      onContextMenu={onContextMenu}
      className={cn(
        'group pr-1.5 gap-2 pl-2 !border-b-0 flex items-center justify-between',
        isFocused ? 'bg-background-darker dark:bg-background opacity-100 h-8 min-w-[20ch] w-[30ch] max-w-[40ch] text-foreground rounded-t-md' : cn(
          'text-muted-foreground/80 opacity-80 min-w-[20ch] w-[30ch] max-w-[40ch] h-5 my-1.5 bg-transparent',
          !isLast && !isNextFocused ? 'border-r-(length:--border-width) border-muted/30 border-dashed' : ''
        )
      )}
    >
      <div className={cn(
        "text-xs flex-1 flex items-center gap-2 min-w-0 h-4",
        !isInteracted && "italic"
      )}>
        {/* Icon is the drag handle */}
        <div
          {...attributes}
          {...listeners}
          className={cn(
            "touch-none",
            disabled ? "" : "cursor-grab active:cursor-grabbing"
          )}
        >
          {getTabIcon()}
        </div>
        <div className='truncate'>
          {getTabName()}
        </div>
        {hasUnsaved && <span className="text-muted-foreground not-italic">●</span>}
      </div>
      <div
        className='group/x group-hover:block hidden h-5 w-5 p-1 hover:bg-destructive/30 rounded-md opacity-50'
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X className="h-full w-full group-hover/x:text-destructive-foreground" />
      </div>
    </button>
  );
}

export function ProjectViewContent({ projectWorkspace, onProjectMerged, initialAgentId, agentCreation, currentUserRole }: AgentManagerProps) {
  const {
    tabs: projectTabs,
    focusedTab,
    openTab,
    closeTab,
    replaceTab,
    setFocused,
    tabsMatch,
    getTabKey,
    isTabInteracted,
    markTabInteracted,
    closeAllSaved,
    countUnsavedTabs,
    reorderTabs
  } = useProjectTabs(projectWorkspace.id);

  const { automationsWithUnsavedChanges } = useAutomationsEditors(projectWorkspace.id);
  const { environmentsWithUnsavedChanges } = useEnvironmentsEditors(projectWorkspace.id);

  const user = useAppStore(state => state.user);
  const backgroundMode = useAppStore(state => state.backgroundMode);
  const sidebarWidth = useAppStore(state => state.sidebarWidth);
  const setSidebarWidth = useAppStore(state => state.setSidebarWidth);
  const { toast } = useToast();
  const [sidebarTab, setSidebarTab] = useState<SidebarTabs>('agents');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isBrowser = useIsBrowser();
  const { navigateTo } = useRouter();

  // Check if we're on desktop (md breakpoint is 768px)
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  // Track if we've already handled the initialAgentId to prevent reopening after explicit close
  const hasHandledInitialAgent = useRef(false);

  const networkStore = useNetworkForwarding();

  // Check if user can create agents (not VISITOR)
  const isntVisitor = currentUserRole !== ProjectRole.VISITOR;

  // Unsaved changes dialog state
  const [tabToClose, setTabToClose] = useState<BodyTab | null>(null);

  // Close all confirmation dialog state
  const [showCloseAllConfirm, setShowCloseAllConfirm] = useState(false);

  // Context menu state
  const [contextMenuTab, setContextMenuTab] = useState<BodyTab | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);

  // Helper function to check if a tab has unsaved changes
  const hasTabUnsavedChanges = useCallback((tab: BodyTab): boolean => {
    if (tab.type === 'agent') return false; // Agent tabs never have unsaved changes
    if (tab.type === 'automation') {
      return automationsWithUnsavedChanges.includes(tab.automationId || 'new');
    }
    if (tab.type === 'environment') {
      return environmentsWithUnsavedChanges.includes(tab.environmentId || 'new');
    }
    return false;
  }, [automationsWithUnsavedChanges, environmentsWithUnsavedChanges]);

  // Count unsaved tabs for close all confirmation
  const unsavedTabsCount = useMemo(() => {
    return countUnsavedTabs(hasTabUnsavedChanges);
  }, [countUnsavedTabs, hasTabUnsavedChanges]);

  // Handle context menu actions
  const handleCloseTab = useCallback((tab: BodyTab) => {
    if (hasTabUnsavedChanges(tab)) {
      setTabToClose(tab);
    } else {
      closeTab(tab);
    }
    setContextMenuTab(null);
  }, [hasTabUnsavedChanges, closeTab]);

  const handleCloseAllSaved = useCallback(() => {
    closeAllSaved(hasTabUnsavedChanges);
    setContextMenuTab(null);
  }, [closeAllSaved, hasTabUnsavedChanges]);

  const handleCloseAll = useCallback(() => {
    if (unsavedTabsCount > 0) {
      setShowCloseAllConfirm(true);
    } else {
      closeTab(projectTabs[0], true); // closeAll = true
    }
    setContextMenuTab(null);
  }, [unsavedTabsCount, closeTab, projectTabs]);

  const confirmCloseAll = useCallback(() => {
    closeTab(projectTabs[0], true); // closeAll = true
    setShowCloseAllConfirm(false);
  }, [closeTab, projectTabs]);

  // Handle tab right-click
  const handleTabContextMenu = useCallback((e: React.MouseEvent, tab: BodyTab) => {
    e.preventDefault();
    setContextMenuTab(tab);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  // Drag and drop sensors for tab reordering
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px of movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end for tab reordering
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderTabs(active.id as string, over.id as string);
    }
  }, [reorderTabs]);

  // Get tab keys for SortableContext
  const tabKeys = useMemo(() => projectTabs.map(getTabKey), [projectTabs, getTabKey]);

  // Auto-mark tabs as interacted when they have unsaved changes
  // This ensures openTab won't replace tabs with unsaved changes
  useEffect(() => {
    projectTabs.forEach(tab => {
      if (tab.type !== 'agent' && hasTabUnsavedChanges(tab)) {
        markTabInteracted(tab);
      }
    });
  }, [projectTabs, hasTabUnsavedChanges, markTabInteracted]);

  useEffect(() => {
    if (focusedTab && focusedTab.type == 'agent') {
      // console.log('Navigating to agent', focusedTab.agentId);
      navigateTo({ type: 'agent', projectId: projectWorkspace.id, agentId: focusedTab.agentId });
    } else {
      navigateTo({ type: 'project', projectId: projectWorkspace.id });
    }
  }, [focusedTab])

  // No more manual unsaved change handlers - computed automatically!

  // Handle initial agent from URL/deeplink - only once
  useEffect(() => {
    if (!initialAgentId || hasHandledInitialAgent.current) return;

    // Mark as handled immediately to prevent re-opening after user closes the tab
    hasHandledInitialAgent.current = true;

    const initialAgentTab = projectTabs.find(tab => tab.type === 'agent' && tab.agentId === initialAgentId);
    if (!initialAgentTab) {
      // console.log('Opening initial agent tab', initialAgentId);
      openTab({ type: 'agent', agentId: initialAgentId });
    }
  }, [projectTabs, initialAgentId])

  // If project reopened with tabs but no focused tab, focus the first one
  useEffect(() => {
    if (projectTabs.length > 0 && !focusedTab) {
      // console.log('Project reopened with tabs but no focus, focusing first tab');
      setFocused(projectTabs[0]);
    }
  }, [projectTabs.length, focusedTab, setFocused])

  // Handle agent becoming READY for the first time
  const handleAgentBecameReady = useCallback(async (agent: Agent) => {
    // console.log(`[ProjectViewContent] Agent ${agent.id} became READY - setting up features`);

    try {
      if (isBrowser) {
        // Browser mode: just get machine IP without SSH
        // console.log(`[ProjectViewContent] Browser mode - fetching machine IP for agent ${agent.id}`);
        await getMachineIP(agent.id);
        // console.log(`[ProjectViewContent] Machine IP fetched for agent ${agent.id}`);
      } else {
        // Desktop mode: upload SSH key and enable SSH features
        await uploadSSHKeyAndGetIP(agent.id);
        // console.log(`[ProjectViewContent] SSH key uploaded for agent ${agent.id}`);

        // Auto-enable network forwarding
        if (!networkStore.isForwarding) {
          // console.log(`[ProjectViewContent] Starting auto-network for agent ${agent.id}`);
          networkStore.startForwarding(agent.id);
        }
      }
    } catch (error) {
      console.error(`[ProjectViewContent] Failed to set up agent ${agent.id}:`, error);
      if (!isBrowser) {
        toast({
          title: "SSH Key Upload Failed",
          description: "Failed to set up SSH access for the agent. Terminals and port forwarding may not work.",
          variant: "destructive"
        });
      }
    }
  }, [isBrowser, networkStore, toast]);

  // Handle agent becoming ARCHIVED - stop network forwarding
  const handleAgentBecameArchived = useCallback((agent: Agent) => {
    // console.log(`[ProjectViewContent] Agent ${agent.id} became ARCHIVED - stopping network`);

    // Stop network forwarding if this agent was forwarding
    if (networkStore.forwardedAgentId === agent.id) {
      // console.log(`[ProjectViewContent] Stopping network forwarding for archived agent ${agent.id}`);
      networkStore.stopForwarding();
    }
  }, [networkStore]);

  const { agents, fetchAgents, deleteAgent } = useAgents(
    projectWorkspace.id,
    undefined,
    handleAgentBecameReady,
    handleAgentBecameArchived
  );

  const getAgent = (agentId: string) => {
    return agents.find(agent => agent.id === agentId) ?? null;
  }

  // Update window title based on focused agent
  useEffect(() => {
    const updateWindowTitle = async () => {
      if (isBrowser) {
        // For browser, update document.title
        if (focusedTab?.type === 'agent') {
          const agent = getAgent(focusedTab.agentId);
          const title = agent?.taskSummary || agent?.name || 'Agent';
          document.title = `${title} - Ariana`;
        } else {
          document.title = `${projectWorkspace.name} - Ariana`;
        }
      } else {
        // For Tauri, use window API
        try {
          const window = getCurrentWindow();
          if (focusedTab?.type === 'agent') {
            const agent = getAgent(focusedTab.agentId);
            const title = agent?.taskSummary || agent?.name || 'Agent';
            await window.setTitle(`${title} - Ariana`);
          } else {
            await window.setTitle(`${projectWorkspace.name} - Ariana`);
          }
        } catch (e) {
          // Ignore errors if window API not available
        }
      }
    };
    updateWindowTitle();
  }, [focusedTab, agents, isBrowser, projectWorkspace.name])

  // Resume stuck uploads for PROVISIONED agents (runs once when agents are first loaded)
  const hasCheckedResume = useRef(false);
  useEffect(() => {
    if (!agents || hasCheckedResume.current || !projectWorkspace.localPath || isBrowser) return;
    hasCheckedResume.current = true;

    const provisionedAgents = agents.filter(a => a.state === AgentState.PROVISIONED);
    if (provisionedAgents.length === 0) return;

    // console.log(`[ProjectViewContent] Found ${provisionedAgents.length} agent(s) stuck in PROVISIONED state, checking for resume...`);

    // Resume each stuck agent (in parallel)
    Promise.all(
      provisionedAgents.map(agent =>
        agentCreationService.resumeUploadIfNeeded(agent.id, projectWorkspace.id, projectWorkspace.localPath!)
          .then(resumed => {
            if (resumed) {
              // console.log(`[ProjectViewContent] Successfully resumed upload for agent ${agent.id}`);
              // Track agent creation via resuming
              posthog.capture('agent_creation_started', {
                source: 'resume',
                agent_id: agent.id,
                project_id: projectWorkspace.id,
                provider: 'claude-code' // TODO: change agent provider later when we have more providers
              });
              // Refresh agents list to show updated state
              fetchAgents();
            }
          })
          .catch(error => {
            console.error(`[ProjectViewContent] Failed to resume agent ${agent.id}:`, error);
          })
      )
    );
  }, [agents, projectWorkspace.localPath, projectWorkspace.id, isBrowser, fetchAgents]);

  const {
    environments,
    createEnvironment,
    updateEnvironment,
    deleteEnvironment,
    duplicateEnvironment,
    installEnvironmentToAgent,
    setDefaultEnvironment,
    generateSshKey,
    refetch: refetchEnvironments,
  } = useEnvironments(projectWorkspace.id);

  // Automations management
  const {
    automations,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    duplicateAutomation,
    installAutomationToEnvironment,
    uninstallAutomationFromEnvironment,
    triggerManualAutomation,
    stopAutomation,
    feedAutomationLogsToAgent,
  } = useAutomations(projectWorkspace.id);

  // Track which agents are updating their environments
  const [updatingAgents, setUpdatingAgents] = useState<Set<string>>(new Set());
  const [updatedAgents, setUpdatedAgents] = useState<Map<string, string>>(new Map()); // agentId -> newEnvName

  const createAgent = async (config: AgentConfig) => {
    await agentCreation.createAgent(
      {
        projectId: projectWorkspace.id,
        projectWorkspace,
        config
      },
      // Callback: Select agent immediately after creation (before provisioning)
      (agent) => {
        // console.log('[AGENT-MANAGER] Agent created, selecting immediately:', agent.id);
        setSidebarTab('agents');
        openTab({ type: 'agent', agentId: agent.id });
        // Refresh agents list to show the new agent in sidebar
        fetchAgents();
      }
    );

    // Refresh again after everything completes to sync final state
    fetchAgents();
  };

  const handleCreateAgentWithPrompt = useCallback(async (prompt: string) => {
    const defaultAgentProvider = useAppStore.getState().defaultAgentProvider;

    let source: AgentConfig['source'];
    if (projectWorkspace.cloneUrl) {
      source = { from: 'clone-url', url: projectWorkspace.cloneUrl, branch: 'main' };
    } else if (projectWorkspace.localPath && !projectWorkspace.repositoryId) {
      source = { from: 'local' };
    } else {
      source = { from: 'branch', branch: 'main' };
    }

    const config: AgentConfig = {
      source,
      machine: { machine: 'cx22' as any, machineSource: 'hetzner' as any },
      provider: defaultAgentProvider || 'claude-code',
    };

    try {
      await agentCreation.createAgent(
        {
          projectId: projectWorkspace.id,
          projectWorkspace,
          config,
        },
        async (agent) => {
          setSidebarTab('agents');
          openTab({ type: 'agent', agentId: agent.id });
          fetchAgents();

          if (prompt) {
            try {
              await authenticatedFetch(`${API_URL}/api/agents/${agent.id}/prompt`, {
                method: 'POST',
                body: JSON.stringify({ prompt, mentions: [] }),
              });
            } catch (error) {
              console.error('[DiffHandoff] Error sending prompt to new agent:', error);
            }
          }
        }
      );
      fetchAgents();
    } catch (error) {
      console.error('[DiffHandoff] Failed to create agent:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create agent',
        variant: 'destructive',
      });
    }
  }, [projectWorkspace, agentCreation, fetchAgents, setSidebarTab, openTab, toast]);

  const handleAgentDelete = async (agentId: string) => {
    try {
      await deleteAgent(agentId);
    } catch (error) {
      console.error('Failed to archive agent:', error);
      toast({
        title: 'Failed to put agent to trash',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    }
  };

  const handleEnvironmentInstall = async (agentId: string, environmentId: string) => {
    const environment = environments.find(e => e.id === environmentId);
    const environmentName = environment?.name || 'Unknown';

    // Mark agent as updating
    setUpdatingAgents(prev => new Set(prev).add(agentId));

    try {
      const result = await installEnvironmentToAgent(environmentId, agentId);

      // Refresh agents list to get updated environmentId
      await fetchAgents();

      // Mark as updated with new environment name
      setUpdatedAgents(prev => new Map(prev).set(agentId, environmentName));

      // Clear updating state
      setUpdatingAgents(prev => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });

      // Clear updated state after 1 second
      setTimeout(() => {
        setUpdatedAgents(prev => {
          const next = new Map(prev);
          next.delete(agentId);
          return next;
        });
      }, 1000);

      // Get agent to check its state
      const updatedAgent = agents?.find(a => a.id === agentId);
      const agentState = updatedAgent?.state;

      let description = "Environment installed successfully";
      if (result.previousEnvironmentName) {
        description = `Replaced "${result.previousEnvironmentName}"`;
      }

      // Add state-specific feedback
      if (agentState === 'provisioning' || agentState === 'provisioned' || agentState === 'cloning') {
        description += " (will apply when agent is ready)";
      }

      toast({
        title: `Installed "${environmentName}"`,
        description,
      });
    } catch (error) {
      console.error('Failed to install environment:', error);

      // Clear updating state on error
      setUpdatingAgents(prev => {
        const next = new Set(prev);
        next.delete(agentId);
        return next;
      });

      toast({
        title: "Failed to install environment",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  };

  const handleAgentFork = async (agentId: string) => {
    if (!user?.id) {
      toast({
        title: 'Error',
        description: 'You must be logged in to fork an agent',
        variant: 'destructive'
      });
      return;
    }

    // Track fork as agent creation
    posthog.capture('agent_creation_started', {
      source: 'fork',
      source_agent_id: agentId,
      project_id: projectWorkspace.id,
      provider: 'claude-code' // Forked agents use same provider
    });

    const result = await agentCreationService.forkAgent(
      agentId,
      user.id,
      undefined, // newAgentName - let backend generate it
      projectWorkspace.localPath // Pass localPath for bundle fallback
    );

    if (result.success) {
      // Select the newly forked agent immediately (like createAgent does)
      if (result.agent) {
        // console.log('[AGENT-MANAGER] Agent forked, selecting immediately:', result.agent.id);
        setSidebarTab('agents');
        openTab({ type: 'agent', agentId: result.agent.id });
      }

      // Refresh agents list to show the new forked agent in sidebar
      fetchAgents();
    } else if (result.error === 'MACHINE_POOL_EXHAUSTED') {
      // Handle pool exhaustion specifically - don't show generic error toast
      showPoolExhaustedToast(toast);
    } else if (!result.limitExceeded) {
      // Only show toast if this is NOT a limit error (limit dialog is already shown)
      toast({
        title: 'Fork failed',
        description: result.error || 'Unknown error',
        variant: 'destructive'
      });
    }
    // If limitExceeded is true, don't show toast - dialog was already shown
  };


  return (
    <div className={cn(
      'flex flex-col w-full h-full',
      focusedTab ? 'rounded-xl not-md:dark:bg-darkest bg-lightest md:bg-transparent p-1 md:p-0' : ''
    )}>
      <div className="flex md:hidden gap-2 w-full h-fit shrink-0 relative">
        {!focusedTab ? (
          <>
            <SelectGroupRoot rounded={false} className='w-full' inverted value={sidebarTab} onValueChange={(v) => setSidebarTab(v as SidebarTabs)} orientation='horizontal' >
              <SelectGroupOption value='agents' className='flex-1 !text-xs h-7'>
                Agents
              </SelectGroupOption>
              {isntVisitor && (
                <>
                  <SelectGroupOption value='environments' className='flex-1 !text-xs h-7'>
                    Environments
                  </SelectGroupOption>
                  <SelectGroupOption value='automations' className='flex-1 !text-xs h-7'>
                    Automations
                  </SelectGroupOption>
                </>
              )}
            </SelectGroupRoot>
          </>
        ) : (
          focusedTab.type == 'agent' && (
            <div className='mb-1 px-2 flex items-center justify-between text-xs text-muted-foreground/80 py-2 w-full'>
              <div className='flex items-center flex-1 min-w-0 pr-2'>
                <div className="h-4 flex-1 min-w-0 truncate">
                  {getAgent(focusedTab.agentId)?.taskSummary || getAgent(focusedTab.agentId)?.name}
                </div>
              </div>
              <X className='h-4 w-4 shrink-0' onClick={() => {
                closeTab(focusedTab, true);
                setSidebarTab('agents');
              }} />
            </div>
          )
        )}

      </div>
      {!isDesktop && <div className='flex md:hidden flex-1 min-h-0'>
        {!focusedTab && sidebarTab === 'agents' && (
          <div className="h-full w-full px-2 flex flex-col min-h-0">
            <AgentSidebar
              agents={agents}
              selectedAgent={null}
              projectWorkspace={projectWorkspace}
              onAgentSelect={(agent) => {
                setSidebarTab('agents');
                openTab({ type: 'agent', agentId: agent.id });
              }}
              onAgentDelete={handleAgentDelete}
              onAgentFork={handleAgentFork}

              onCreateAgent={createAgent}
              onProjectMerged={onProjectMerged}
              canCreateAgents={isntVisitor}
              currentUserRole={currentUserRole}
              fetchAgents={fetchAgents}
              updatingAgents={updatingAgents}
              updatedAgents={updatedAgents}
              environments={environments}
              onEnvironmentInstall={handleEnvironmentInstall}
            />
          </div>
        )}
        {!focusedTab && sidebarTab === 'environments' && isntVisitor && (
          <div className="w-full h-full px-2">
            <EnvironmentsSidebar
              environments={environments}
              onEdit={(environment) => {
                // Clear any existing draft before opening existing environment
                useAppStore.getState().clearEnvironmentDraft(projectWorkspace.id, environment.id);
                openTab({ type: 'environment', environmentId: environment.id });
              }}
              onDelete={async (environmentId) => {
                await deleteEnvironment(environmentId);
              }}
              onDuplicate={async (environmentId) => {
                await duplicateEnvironment(environmentId);
              }}
              onSetDefault={async (environmentId) => {
                await setDefaultEnvironment(environmentId);
              }}
              onAdd={() => {
                // Clear any existing draft for 'new' before opening
                useAppStore.getState().clearEnvironmentDraft(projectWorkspace.id, 'new');
                openTab({ type: 'environment', environmentId: null });
              }}
            />
          </div>
        )}
        {!focusedTab && sidebarTab === 'automations' && isntVisitor && (
          <div className="w-full h-full px-2">
            <AutomationsSidebar
              automations={automations}
              agents={agents}
              onTriggerAutomation={triggerManualAutomation}
              onEdit={(automation) => {
                // Clear any existing draft before opening existing automation
                useAppStore.getState().clearAutomationDraft(projectWorkspace.id, automation.id);
                openTab({ type: 'automation', automationId: automation.id });
              }}
              onDelete={async (automationId) => {
                await deleteAutomation(automationId);
              }}
              onDuplicate={async (automationId) => {
                await duplicateAutomation(automationId);
              }}
              onAdd={() => {
                // Clear any existing draft for 'new' before opening
                useAppStore.getState().clearAutomationDraft(projectWorkspace.id, 'new');
                openTab({ type: 'automation', automationId: null });
              }}
            />
          </div>
        )}

        {focusedTab && (
          <div className="h-full w-full overflow-hidden bg-background-darker/80 rounded-md">
            <div className="h-full flex items-center justify-center">
              {/* Render ALL tabs, but only show the focused one */}
              {projectTabs.map((tab) => {
                // Memoize lookups to prevent re-renders
                const automation = tab.type === 'automation' && tab.automationId
                  ? automations.find(auto => auto.id === tab.automationId)
                  : undefined;
                const environment = tab.type === 'environment' && tab.environmentId
                  ? environments.find(env => env.id === tab.environmentId)
                  : undefined;

                return (
                <div
                  key={getTabKey(tab)}
                  className={cn(
                    "h-full w-full",
                    focusedTab && tabsMatch(tab, focusedTab) ? "block" : "hidden"
                  )}
                >
                  {tab.type === 'environment' ? (
                    <EnvironmentEditor
                      key={tab.environmentId || 'new'}
                      environment={environment}
                      projectId={projectWorkspace.id}
                      isFocused={focusedTab !== null && tabsMatch(tab, focusedTab)}
                      onBack={() => {
                        closeTab({ type: 'environment', environmentId: tab.environmentId });
                        setSidebarTab('environments');
                      }}
                      onSave={async (name, envContents, secretFiles, automationIds, sshKeyPair) => {
                        if (tab.environmentId) {
                          // Update the entire environment with all data
                          await updateEnvironment(tab.environmentId, { name, envContents, secretFiles, sshKeyPair: sshKeyPair ?? undefined });
                        } else {
                          // Create new environment with all data
                          const env = await createEnvironment({ name, envContents, secretFiles, sshKeyPair: sshKeyPair ?? undefined });
                          if (!env) return;
                          // Replace the "New Environment" tab with the actual environment tab
                          replaceTab({ type: 'environment', environmentId: null }, { type: 'environment', environmentId: env.id });
                          setSidebarTab('environments');
                        }
                      }}
                      onGenerateSshKey={generateSshKey}
                      onDiscard={() => {
                        closeTab({ type: 'environment', environmentId: tab.environmentId });
                      }}
                      onCreateAutomation={(environmentId) => {
                        // Open new automation tab with context about which environment it's for
                        openTab({ type: 'automation', automationId: null, forEnvironmentId: environmentId } as any);
                      }}
                      onEditAutomation={(automationId) => {
                        // Clear any existing draft before opening existing automation
                        useAppStore.getState().clearAutomationDraft(projectWorkspace.id, automationId);
                        openTab({ type: 'automation', automationId });
                      }}
                      onUninstallAutomation={async (automationId, environmentId) => {
                        await uninstallAutomationFromEnvironment(automationId, environmentId);
                        await refetchEnvironments();
                      }}
                      availableAutomations={automations}
                      onInstallAutomation={async (automationId, environmentId) => {
                        await installAutomationToEnvironment(automationId, environmentId);
                        await refetchEnvironments();
                      }}
                    />
                  ) : tab.type === 'automation' ? (
                    <AutomationEditor
                      automation={automation}
                      projectId={projectWorkspace.id}
                      isFocused={focusedTab !== null && tabsMatch(tab, focusedTab)}
                      onBack={() => {
                        closeTab({ type: 'automation', automationId: tab.automationId });
                        setSidebarTab('automations');
                      }}
                      onSave={async (data) => {
                        if (tab.automationId) {
                          // Updating existing automation
                          await updateAutomation(tab.automationId, data);
                        } else {
                          // Creating new automation
                          const automation = await createAutomation(data);
                          if (!automation) return;

                          // If this automation was created from an environment, install it there
                          const forEnvironmentId = (tab as any).forEnvironmentId;
                          if (forEnvironmentId) {
                            await installAutomationToEnvironment(automation.id, forEnvironmentId);
                            // Refetch environments to update the automations list
                            await refetchEnvironments();

                            // Close the new automation tab and go back to environment
                            closeTab({ type: 'automation', automationId: null });
                            // Focus the environment tab
                            setFocused({ type: 'environment', environmentId: forEnvironmentId });
                            setSidebarTab('environments');
                          } else {
                            // Replace the "new automation" tab with the actual automation tab
                            replaceTab({ type: 'automation', automationId: null }, { type: 'automation', automationId: automation.id });
                            setSidebarTab('automations');
                          }
                        }
                      }}
                      onDiscard={() => {
                        closeTab({ type: 'automation', automationId: tab.automationId });
                      }}
                    />
                  ) : (
                    tab.type === 'agent' && getAgent(tab.agentId) && (
                    <AgentChat
                      agent={getAgent(tab.agentId)!}
                      projectWorkspace={projectWorkspace}
                      allAgents={agents || EMPTY_AGENTS}
                      isFocused={focusedTab !== null && tabsMatch(tab, focusedTab)}
                      automations={automations}
                      onTriggerAutomation={triggerManualAutomation}
                      onStopAutomation={stopAutomation}
                      onFeedAutomationToAgent={feedAutomationLogsToAgent}
                      onTabInteracted={() => markTabInteracted(tab)}
                      onCreateAgentWithPrompt={handleCreateAgentWithPrompt}
                    />
                    )
                  )}
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>}

      {isDesktop && <div className="hidden md:flex h-full overflow-hidden w-full">
        <ResizablePanelGroup direction="horizontal">
        {/* Left Sidebar */}
        <ResizablePanel
          defaultSize={sidebarWidth}
          minSize={15}
          maxSize={40}
          collapsible
          collapsedSize={0}
          onCollapse={() => setSidebarCollapsed(true)}
          onExpand={() => setSidebarCollapsed(false)}
          onResize={(size) => setSidebarWidth(size)}
        >
        <div className="flex flex-col h-full overflow-hidden pr-1">
          <div className="relative">
            <SelectGroupRoot rounded={false} className='w-full' inverted value={sidebarTab} onValueChange={(v) => setSidebarTab(v as SidebarTabs)} orientation='horizontal' >
              <SelectGroupOption value='agents' className='flex-1 !text-xs h-7'>
                Agents
              </SelectGroupOption>
              {isntVisitor && (
                <>
                  <SelectGroupOption value='environments' className='flex-1 !text-xs h-7'>
                    Environments
                  </SelectGroupOption>
                  <SelectGroupOption value='automations' className='flex-1 !text-xs h-7'>
                    Automations
                  </SelectGroupOption>
                </>
              )}
            </SelectGroupRoot>
          </div>
          {/* Agents Section */}
          {sidebarTab === 'agents' && (
            <AgentSidebar
              agents={agents}
              selectedAgent={focusedTab?.type === 'agent' ? getAgent(focusedTab.agentId) : null}
              projectWorkspace={projectWorkspace}
              onAgentSelect={(agent) => {
                setSidebarTab('agents');
                openTab({ type: 'agent', agentId: agent.id });
              }}
              onAgentDelete={handleAgentDelete}
              onAgentFork={handleAgentFork}

              onCreateAgent={createAgent}
              onProjectMerged={onProjectMerged}
              canCreateAgents={isntVisitor}
              currentUserRole={currentUserRole}
              fetchAgents={fetchAgents}
              updatingAgents={updatingAgents}
              updatedAgents={updatedAgents}
              environments={environments}
              onEnvironmentInstall={handleEnvironmentInstall}
            />
          )}

          {/* Environments Section */}
          {sidebarTab === 'environments' && (
            <EnvironmentsSidebar
              environments={environments}
              onEdit={(environment) => {
                // Clear any existing draft before opening existing environment
                useAppStore.getState().clearEnvironmentDraft(projectWorkspace.id, environment.id);
                openTab({ type: 'environment', environmentId: environment.id });
              }}
              onDelete={async (environmentId) => {
                await deleteEnvironment(environmentId);
              }}
              onDuplicate={async (environmentId) => {
                await duplicateEnvironment(environmentId);
              }}
              onSetDefault={async (environmentId) => {
                await setDefaultEnvironment(environmentId);
              }}
              onAdd={() => {
                // Clear any existing draft for 'new' before opening
                useAppStore.getState().clearEnvironmentDraft(projectWorkspace.id, 'new');
                openTab({ type: 'environment', environmentId: null });
              }}
            />
          )}

          {/* Automations Section */}
          {sidebarTab === 'automations' && (
            <AutomationsSidebar
              automations={automations}
              agents={agents}
              onTriggerAutomation={triggerManualAutomation}
              onEdit={(automation) => {
                // Clear any existing draft before opening existing automation
                useAppStore.getState().clearAutomationDraft(projectWorkspace.id, automation.id);
                openTab({ type: 'automation', automationId: automation.id });
              }}
              onDelete={async (automationId) => {
                await deleteAutomation(automationId);
              }}
              onDuplicate={async (automationId) => {
                await duplicateAutomation(automationId);
              }}
              onAdd={() => {
                // Clear any existing draft for 'new' before opening
                useAppStore.getState().clearAutomationDraft(projectWorkspace.id, 'new');
                openTab({ type: 'automation', automationId: null });
              }}
            />
          )}
        </div>
        </ResizablePanel>

        {/* Resizable Handle between sidebar and main content */}
        <ResizableHandle withHandle className="bg-transparent" />

        <ResizablePanel defaultSize={100 - sidebarWidth} minSize={30}>
        <div className="h-full overflow-hidden">
          <div className="relative h-full w-full overflow-x-auto flex flex-col">
            {projectTabs.length > 0 ? (
              <>
              <div className="absolute top-8 left-0 z-10 w-full h-0.5 bg-lightest dark:bg-background-darker"></div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToHorizontalAxis]}
              >
                <SortableContext items={tabKeys} strategy={horizontalListSortingStrategy}>
                  <div className='w-fit max-w-full z-20 rounded-t-lg overflow-x-hidden hover:overflow-x-auto p-0.5 pb-0 flex h-fit gap-0.5 bg-lightest dark:bg-background-darker'>
                    {projectTabs.map((tab, i, array) => {
                      const hasUnsaved = hasTabUnsavedChanges(tab);
                      const tabInteracted = tab.type === 'agent'
                        ? isTabInteracted(tab)
                        : hasUnsaved || isTabInteracted(tab);
                      const tabKey = getTabKey(tab);
                      const isFocused = focusedTab !== null && tabsMatch(tab, focusedTab);
                      const isNextFocused = i < array.length - 1 && focusedTab !== null && tabsMatch(array[i + 1], focusedTab);

                      return (
                        <SortableTab
                          key={tabKey}
                          id={tabKey}
                          tab={tab}
                          isFocused={isFocused}
                          isInteracted={tabInteracted}
                          hasUnsaved={hasUnsaved}
                          isLast={i === array.length - 1}
                          isNextFocused={isNextFocused}
                          onFocus={() => setFocused(tab)}
                          onClose={() => handleCloseTab(tab)}
                          onContextMenu={(e) => handleTabContextMenu(e, tab)}
                          disabled={array.length === 1}
                          getTabName={() => {
                            if (tab.type === 'agent') {
                              const agent = getAgent(tab.agentId);
                              return agent?.taskSummary || agent?.lastPromptText || agent?.lastCommitName || agent?.name || 'Agent';
                            }
                            if (tab.type === 'environment') {
                              return environments.find(env => env.id === tab.environmentId)?.name ?? 'New Environment';
                            }
                            if (tab.type === 'automation') {
                              return automations.find(auto => auto.id === tab.automationId)?.name ?? 'New Automation';
                            }
                            return 'Tab';
                          }}
                          getTabIcon={() => {
                            if (tab.type === 'agent') {
                              return (
                                <div className='h-4 w-4 shrink-0 dark:text-lightest/50 text-lightest bg-chart-1/50 rounded-md flex items-center justify-center not-italic'>
                                  <div>A</div>
                                </div>
                              );
                            }
                            if (tab.type === 'environment') {
                              return (
                                <div className='h-4 w-4 shrink-0 dark:text-lightest/50 text-lightest bg-chart-3/50 rounded-md flex items-center justify-center not-italic'>
                                  <div>E</div>
                                </div>
                              );
                            }
                            if (tab.type === 'automation') {
                              return (
                                <div className='h-4 w-4 shrink-0 dark:text-lightest/50 text-lightest bg-blue-500/50 rounded-md flex items-center justify-center not-italic'>
                                  <div>A</div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
              <div className={cn(
                "flex-1 min-h-0 w-full",
                backgroundMode.type === 'image' ? 'bg-background-darker/80' : 'bg-background/20'
              )}>
                {/* Render ALL tabs, but only show the focused one */}
                {projectTabs.map((tab) => {
                  return (
                  <div
                    key={getTabKey(tab)}
                    className={cn(
                      "h-full w-full",
                      focusedTab && tabsMatch(tab, focusedTab) ? "block" : "hidden"
                    )}
                  >
                    {tab.type === 'environment' ? (
                      <EnvironmentEditor
                        key={tab.environmentId || 'new'}
                        environment={tab.environmentId ? environments.find(env => env.id === tab.environmentId) : undefined}
                        projectId={projectWorkspace.id}
                        isFocused={focusedTab !== null && tabsMatch(tab, focusedTab)}
                        onBack={() => {
                          closeTab({ type: 'environment', environmentId: tab.environmentId });
                          setSidebarTab('environments');
                        }}
                        onSave={async (name, envContents, secretFiles, automationIds, sshKeyPair) => {
                          if (tab.environmentId) {
                            // Update the entire environment with all data
                            await updateEnvironment(tab.environmentId, { name, envContents, secretFiles, sshKeyPair: sshKeyPair ?? undefined });
                          } else {
                            // Create new environment with all data
                            const env = await createEnvironment({ name, envContents, secretFiles, sshKeyPair: sshKeyPair ?? undefined });
                            if (!env) return;
                            // Replace the "New Environment" tab with the actual environment tab
                            replaceTab({ type: 'environment', environmentId: null }, { type: 'environment', environmentId: env.id });
                            setSidebarTab('environments');
                          }
                        }}
                        onGenerateSshKey={generateSshKey}
                        onDiscard={() => {
                          closeTab({ type: 'environment', environmentId: tab.environmentId });
                        }}
                        onCreateAutomation={(environmentId) => {
                          // Open new automation tab with context about which environment it's for
                          openTab({ type: 'automation', automationId: null, forEnvironmentId: environmentId } as any);
                        }}
                        onEditAutomation={(automationId) => {
                          openTab({ type: 'automation', automationId });
                        }}
                        onUninstallAutomation={async (automationId, environmentId) => {
                          await uninstallAutomationFromEnvironment(automationId, environmentId);
                          await refetchEnvironments();
                        }}
                        availableAutomations={automations}
                        onInstallAutomation={async (automationId, environmentId) => {
                          await installAutomationToEnvironment(automationId, environmentId);
                          await refetchEnvironments();
                        }}
                      />
                    ) : tab.type === 'automation' ? (
                      <AutomationEditor
                        key={tab.automationId || 'new'}
                        automation={tab.automationId ? automations.find(auto => auto.id === tab.automationId) : undefined}
                        projectId={projectWorkspace.id}
                        isFocused={focusedTab !== null && tabsMatch(tab, focusedTab)}
                        onBack={() => {
                          closeTab({ type: 'automation', automationId: tab.automationId });
                          setSidebarTab('automations');
                        }}
                        onSave={async (data) => {
                          if (tab.automationId) {
                            // Updating existing automation
                            await updateAutomation(tab.automationId, data);
                          } else {
                            // Creating new automation
                            const automation = await createAutomation(data);
                            if (!automation) return;

                            // If this automation was created from an environment, install it there
                            const forEnvironmentId = (tab as any).forEnvironmentId;
                            if (forEnvironmentId) {
                              await installAutomationToEnvironment(automation.id, forEnvironmentId);
                              // Refetch environments to update the automations list
                              await refetchEnvironments();

                              // Close the new automation tab and go back to environment
                              closeTab({ type: 'automation', automationId: null });
                              // Focus the environment tab
                              setFocused({ type: 'environment', environmentId: forEnvironmentId });
                              setSidebarTab('environments');
                            } else {
                              // Replace the "new automation" tab with the actual automation tab
                              replaceTab({ type: 'automation', automationId: null }, { type: 'automation', automationId: automation.id });
                              setSidebarTab('automations');
                            }
                          }
                        }}
                        onDiscard={() => {
                          closeTab({ type: 'automation', automationId: tab.automationId });
                        }}
                      />
                    ) : (
                      tab.type === 'agent' && getAgent(tab.agentId) && (
                      <AgentChat
                        agent={getAgent(tab.agentId)!}
                        projectWorkspace={projectWorkspace}
                        allAgents={agents || EMPTY_AGENTS}
                        isFocused={focusedTab !== null && tabsMatch(tab, focusedTab)}
                        automations={automations}
                        onTriggerAutomation={triggerManualAutomation}
                        onStopAutomation={stopAutomation}
                        onFeedAutomationToAgent={feedAutomationLogsToAgent}
                        onTabInteracted={() => markTabInteracted(tab)}
                        onCreateAgentWithPrompt={handleCreateAgentWithPrompt}
                      />
                      )
                    )}
                  </div>
                  );
                })}
              </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="flex flex-col gap-10 items-center mb-20">
                  <div className="flex items-center gap-5 pr-10">
                    <Logo className='h-44 w-44 opacity-10 mb-10' variant='muted'/>
                    <div className="text-7xl font-bold text-muted-foreground/10 pb-10">ARIANA</div>
                  </div>
                  {isntVisitor && agents.length <= 0 && (
                    <div className="flex items-center w-full justify-between">
                      <div className="flex flex-col">
                        <div className="text-lg font-semibold">No agents yet</div>
                        <p className="text-muted-foreground">
                          {isntVisitor ? 'Spawn your first agent to get started' : 'No agents have been shared with you yet'}
                        </p>
                      </div>

                      <AgentConfigDropdown
                        trigger={
                          <Button
                            variant="default"
                            hoverVariant='accent'
                          >
                            <Plus className="h-5 w-5 mr-2 text-inherit" />
                            New Agent
                          </Button>
                        }
                        projectWorkspace={projectWorkspace}
                        onConfirm={createAgent}
                        onProjectMerged={onProjectMerged}
                        environments={environments}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        </ResizablePanel>
        </ResizablePanelGroup>
      </div>}


      {/* Unsaved Changes Dialog */}
      <Dialog open={!!tabToClose} onOpenChange={(open) => !open && setTabToClose(null)}>
        <DialogContent className="max-w-md flex flex-col p-6">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes. If you close this tab now, your changes will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-shrink-0 flex-row justify-end gap-3">
            <Button
              variant="default"
              onClick={() => setTabToClose(null)}
            >
              Keep Editing
            </Button>
            <Button
              onClick={() => {
                if (tabToClose) {
                  closeTab(tabToClose);
                  setTabToClose(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close All Confirmation Dialog */}
      <Dialog open={showCloseAllConfirm} onOpenChange={setShowCloseAllConfirm}>
        <DialogContent className="max-w-md flex flex-col p-6">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Close All Tabs?</DialogTitle>
            <DialogDescription>
              You have {unsavedTabsCount} tab{unsavedTabsCount !== 1 ? 's' : ''} with unsaved changes.
              Closing all tabs will discard these changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-shrink-0 flex-row justify-end gap-3">
            <Button
              variant="default"
              onClick={() => setShowCloseAllConfirm(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmCloseAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Close All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tab Context Menu */}
      <DropdownMenu open={!!contextMenuTab} onOpenChange={(open) => !open && setContextMenuTab(null)}>
        <DropdownMenuTrigger asChild>
          <div
            style={{
              position: 'fixed',
              left: contextMenuPosition?.x ?? 0,
              top: contextMenuPosition?.y ?? 0,
              width: 1,
              height: 1,
              pointerEvents: 'none'
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => contextMenuTab && handleCloseTab(contextMenuTab)}>
            Close
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleCloseAllSaved}>
            Close All Saved
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCloseAll}>
            Close All{unsavedTabsCount > 0 ? ` (${unsavedTabsCount} unsaved)` : ''}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}