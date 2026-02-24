import { cn } from '@/lib/utils';
import { MoreVertical, Trash2, Share2, GitBranch, MoreHorizontalIcon, ArrowLeftIcon, GitCommit, ArrowDownUp, Network, GitFork, HelpCircle, Plus, Loader2, ArrowRight, Package } from 'lucide-react';
import { useState, useEffect, memo } from 'react';
import { constructBranchUrl, constructGithubBranchUrl } from '@/utils/gitUrlUtils';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useAgentSummaryStore } from '@/stores/useAgentSummaryStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AgentWithCreator, AgentState, ProjectRole } from '@/bindings/types';
import { agentStateToString, getAgentStatusBgColor, getAgentStatusColor } from '../agent-chat/utils';
import { useNetworkForwarding } from '@/hooks/useNetworkForwarding';
import { useAgentPeremption } from '@/hooks/useAgentPeremption';
import { useAppStore } from '@/stores/useAppStore';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { useAgentAccesses } from '@/hooks/useAgentAccesses';
import { useToast } from '@/hooks/use-toast';
import { ShareDialog } from './ShareDialog';
import Share from '../ui/icons/Share';
import Fork from '../ui/icons/Fork';
import Trash from '../ui/icons/Trash';
import LiveStream from '../ui/icons/LiveStream';
import GitMerge from '../ui/icons/GitMerge';
import { EnvironmentPicker } from '@/components/EnvironmentPicker';
import { PersonalEnvironment } from '@/hooks/useEnvironments';
import { TemplateVisibilityPicker } from '@/components/TemplateVisibilityPicker';
import type { TemplateVisibility } from '@/services/agent.service';
import Unpin from '../ui/icons/Unpin';
import { StoppedAgentIndicator } from './StoppedAgentIndicator';
import type { AgentSearchResult } from '@/hooks/useAgentSearch';

interface AgentListItemProps {
  agent: AgentWithCreator;
  projectName?: string;
  projectCloneUrl?: string | null;
  projectRepositoryId?: string | null;
  isSelected?: boolean;
  onSelect?: (agent: AgentWithCreator) => void;
  onDelete?: (agentId: string) => void;
  onFork?: (agentId: string) => void;
  currentUserRole?: ProjectRole | null;
  isTrashed?: boolean;
  onUntrash?: (agentId: string) => void;
  isUpdatingEnvironment?: boolean;
  justUpdatedToEnv?: string | null;
  currentEnvName?: string | null;
  environments?: PersonalEnvironment[];
  onEnvironmentSelect?: (agentId: string, environmentId: string) => void;
  isTemplate?: boolean;
  onMakeTemplate?: (agentId: string, visibility: TemplateVisibility) => void;
  onRemoveTemplate?: (agentId: string) => void;
  lastTemplateVisibility?: TemplateVisibility;
  searchResult?: AgentSearchResult;
}

function AgentListItemComponent({
  agent,
  projectName,
  projectCloneUrl,
  projectRepositoryId,
  isSelected = false,
  onSelect,
  onDelete,
  onFork,
  currentUserRole = null,
  isTrashed = false,
  onUntrash,
  currentEnvName = null,
  environments = [],
  onEnvironmentSelect,
  isTemplate = false,
  onMakeTemplate,
  onRemoveTemplate,
  lastTemplateVisibility = 'shared',
  searchResult,
}: AgentListItemProps) {
  const [extendingLifetime, setExtendingLifetime] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [repositoryFullName, setRepositoryFullName] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { forwardedAgentId, startForwarding, stopForwarding } = useNetworkForwarding();
  const isForwarding = forwardedAgentId === agent.id;
  const [isTogglingNetwork, setIsTogglingNetwork] = useState(false);
  const { isWarning, timeLeft } = useAgentPeremption(agent);
  const isBrowser = useIsBrowser();
  const { toast } = useToast();
  const lifetimeUnitMinutes = useAppStore(state => state.agentLifetimeUnitMinutes);
  const { accessMap } = useAgentAccesses();
  const access = accessMap.get(agent.id);
  const hasReadAccess = access !== undefined;
  const user = useAppStore(state => state.user);
  const isOwner = user?.id === agent.userId;
  const backgroundMode = useAppStore(state => state.backgroundMode);

  // Get summary data from polling store (for non-focused agents)
  const getSummary = useAgentSummaryStore(state => state.getSummary);
  const summary = getSummary(agent.id);

  // Use summary data if available, otherwise fall back to agent data
  const displayCommitSha = summary?.lastCommitSha || agent.lastCommitSha;
  const displayCommitUrl = summary?.lastCommitUrl || agent.lastCommitUrl;
  const displayAdditions = summary?.additions || 0;
  const displayDeletions = summary?.deletions || 0;

  // Fetch repository fullName if we have a repositoryId
  useEffect(() => {
    const fetchRepositoryFullName = async () => {
      if (!projectRepositoryId) {
        setRepositoryFullName(null);
        return;
      }

      try {
        const response = await authenticatedFetch(`${API_URL}/api/repositories/${projectRepositoryId}`);
        if (response.ok) {
          const data = await response.json();
          setRepositoryFullName(data.repository?.fullName || null);
        }
      } catch (error) {
        console.error('Failed to fetch repository fullName:', error);
        setRepositoryFullName(null);
      }
    };

    fetchRepositoryFullName();
  }, [projectRepositoryId]);

  const cropText = (text: string, maxLength: number) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  // Generate branch URL if possible
  const getBranchUrl = (branch: string | null): string | null => {
    if (!branch) return null;

    // If we have a GitHub repository fullName, use it
    if (repositoryFullName) {
      return constructGithubBranchUrl(repositoryFullName, branch);
    }

    // If we have a cloneUrl, use it
    if (projectCloneUrl) {
      return constructBranchUrl(projectCloneUrl, branch);
    }

    return null;
  };

  const baseBranchUrl = getBranchUrl(agent.baseBranch);
  const targetBranchUrl = getBranchUrl(agent.branchName);

  // Handler to open commit URL
  const handleCommitClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (agent.lastCommitUrl) {
      if (isBrowser) {
        window.open(agent.lastCommitUrl, '_blank');
      } else {
        await openUrl(agent.lastCommitUrl);
      }
    }
  };

  // Handler to open branch URL
  const handleBranchClick = async (e: React.MouseEvent, branchUrl: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    if (branchUrl) {
      if (isBrowser) {
        window.open(branchUrl, '_blank');
      } else {
        await openUrl(branchUrl);
      }
    }
  };

  const isForkable = true; // this was a mistake don't put it back: agent.state !== AgentState.ERROR;

  // Custom machines cannot be forked (no snapshot support)
  const isCustomMachine = agent.machineType === 'custom';

  // Check if agent has a snapshot (required for forking)
  const hasSnapshot = agent.hasSnapshot ?? false;

  const handleToggleNetwork = async () => {
    setIsTogglingNetwork(true);
    try {
      if (isForwarding) {
        await stopForwarding();
      } else {
        await startForwarding(agent.id);
      }
    } catch (error) {
      console.error('Failed to toggle network forwarding:', error);
      toast({
        title: 'Failed to toggle port forwarding',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      });
    } finally {
      setIsTogglingNetwork(false);
    }
  };

  // Check if agent is ready for port forwarding (same as sync conditions)
  // Note: ARCHIVED agents can auto-resume, so we don't exclude them
  const isMachineReady = () => {
    const state = agent.state as AgentState;
    return ![
      AgentState.PROVISIONING,
      AgentState.PROVISIONED,
      AgentState.CLONING,
    ].includes(state);
  };

  const canUsePortForwarding = hasReadAccess && !isBrowser && isMachineReady();


  return (
    <div
      className="w-full transition-all"
    >
      <div
        className={cn(
          "group flex rounded-lg transition-colors w-full text-foreground",
          // backgroundMode.type === 'image' ? 'bg-background-darker' : (
          //   projectName ? 'bg-background-darker' : 'bg-background'
          // ),
          // (isSelected || projectName) ? "opacity-100" : (
          //   backgroundMode.type === 'image' ? " md:opacity-70 md:dark:opacity-70" : "saturate-[88%] brightness-[98.5%] dark:brightness-[90%]"
          // ),
          isSelected ? 'bg-lightest dark:bg-darkest' : 'bg-background dark:bg-background-darker',
          projectName ? "h-28"
          : "h-23"
        )}
      >
      <button
        className="flex-1 min-w-0 z-10 flex flex-col gap-1 p-3 pl-4 pr-4 text-sm relative items-start text-left"
        onClick={() => onSelect?.(agent)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropdownOpen(true);
        }}
      >
        {/* Project Name (if provided) */}
        {projectName && (
          <div className="text-xs font-medium text-muted-foreground/70">{projectName}</div>
        )}
        <div className="flex items-center justify-start gap-1 w-full">
          {agent.prState && (
            <a
              href="#"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (agent.prUrl) {
                  if (isBrowser) {
                    window.open(agent.prUrl, '_blank');
                  } else {
                    await openUrl(agent.prUrl);
                  }
                }
              }}
              className={cn(
                "flex items-center gap-0.5 mr-1.5 flex-shrink-0 text-xs underline-offset-4 hover:underline",
                agent.prState === 'merged' ? 'text-constructive-foreground' :
                agent.prState === 'closed' ? 'text-destructive-foreground' :
                'text-accent'
              )}
            >
              <div className="h-3.5 w-3.5">
                <GitMerge className="max-h-full max-w-full text-inherit" />
              </div>
              <span>PR {agent.prState}</span>
            </a>
          )}
          <span className="truncate text-xs font-medium">{agent.name}</span>
          {agent.state === AgentState.ERROR && agent.errorMessage ? (
            <TooltipProvider>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 cursor-help">
                    <div className={cn(
                      "w-1 h-1 ml-1 rounded-full flex-shrink-0",
                      getAgentStatusBgColor(agent.state as AgentState)
                    )} />
                    <span className={cn(
                      "text-xs",
                      getAgentStatusColor(agent.state as AgentState)
                    )}>{agentStateToString(agent.state as AgentState)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>{agent.errorMessage}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : agent.state === AgentState.ARCHIVED ? (
            <StoppedAgentIndicator agentId={agent.id} />
          ) : (
            <>
              <div className={cn(
                "w-1 h-1 ml-1 rounded-full flex-shrink-0",
                getAgentStatusBgColor(agent.state as AgentState)
              )} />
              <span className={cn(
                "text-xs",
                getAgentStatusColor(agent.state as AgentState)
              )}>{agentStateToString(agent.state as AgentState)}</span>
            </>
          )}
          {/* Show +/- counts next to status */}
          {(displayAdditions > 0 || displayDeletions > 0) && agent.lastCommitName != "initial uncommitted" && (
            <>
              {' '}
              <span className="ml-1 text-xs text-constructive-foreground opacity-50">+{displayAdditions}</span>
              {' '}
              <span className="text-xs text-destructive-foreground opacity-50">-{displayDeletions}</span>
            </>
          )}
        </div>

        {/* Branch info */}
        <div className="text-xs text-muted-foreground opacity-50 flex items-center gap-1 w-full">
          {displayCommitSha && displayCommitUrl && (
            <>
              <a
                href="#"
                className="text-muted-foreground hover:underline flex-shrink-0"
                onClick={handleCommitClick}
              >
                #{displayCommitSha.substring(0, 7)}
              </a>
              <span className="flex-shrink-0"><GitCommit className='w-3 h-3'/> </span>
            </>
          )}
          {agent.baseBranch ? (
            <>
              <GitBranch className="h-3 w-3 flex-shrink-0" />
              {baseBranchUrl ? (
                <a
                  href="#"
                  className={cn(
                    "text-muted-foreground hover:underline flex-1 max-w-fit min-w-0 truncate",
                  )}
                  onClick={(e) => handleBranchClick(e, baseBranchUrl)}
                >
                  {agent.baseBranch}
                </a>
              ) : (
                <span className={cn(
                  "truncate flex-1 max-w-fit min-w-0",
                )}>{agent.baseBranch}</span>
              )}
              <ArrowRight className="h-3 w-3 flex-shrink-0" />
              {targetBranchUrl && displayCommitUrl ? (
                <a
                  href="#"
                  className={cn(
                    "text-muted-foreground hover:underline truncate flex-1 min-w-0",
                  )}
                  onClick={(e) => handleBranchClick(e, targetBranchUrl)}
                >
                  {agent.branchName}
                </a>
              ) : (
                <span className={cn(
                  "truncate flex-1 min-w-0",
                )}>{agent.branchName}</span>
              )}    
            </>
          ) : (
            <>
              <span className={cn(
                "truncate flex-1 max-w-fit min-w-0",
              )}>copy of local files</span>
              <ArrowRight className="h-3 w-3 flex-shrink-0" />
              <GitBranch className="h-3 w-3 flex-shrink-0" />
              {targetBranchUrl && displayCommitUrl ? (
                <a
                  href="#"
                  className={cn(
                    "text-muted-foreground hover:underline truncate flex-1 min-w-0",
                  )}
                  onClick={(e) => handleBranchClick(e, targetBranchUrl)}
                >
                  {agent.branchName}
                </a>
              ) : (
                <span className={cn(
                  "truncate flex-1 min-w-0",
                )}>{agent.branchName}</span>
              )}    
            </>
          )}
        </div>

        <div className="flex flex-col gap-1 items-start w-full">
          {/* Search excerpt with highlighted match (when searching) */}
          {searchResult ? (
            <div className="text-sm text-foreground/70 truncate w-fit max-w-full">
              <span className="text-muted-foreground">
                {searchResult.excerpt.substring(0, searchResult.excerptMatchStart)}
              </span>
              <span className="bg-yellow-500/30 text-foreground font-medium">
                {searchResult.excerpt.substring(searchResult.excerptMatchStart, searchResult.excerptMatchEnd)}
              </span>
              <span className="text-muted-foreground">
                {searchResult.excerpt.substring(searchResult.excerptMatchEnd)}
              </span>
            </div>
          ) : (
            /* Task summary (AI-generated) - shown when not searching */
            agent.taskSummary && (
              <div className="text-base text-foreground/70 truncate w-fit max-w-full">
                {agent.taskSummary}
              </div>
            )
          )}
        </div>
      </button>

      <div className={cn(
        "flex flex-col border-l-(length:--border-width) py-1 h-full justify-between items-end",
        isSelected ? "border-muted/20" : "dark:border-muted/10 border-foreground/5"
      )}>
        <DropdownMenu modal={false} open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "px-3 z-10 group-hover:text-foreground/50 self-start mt-2",
                isBrowser ? 'text-muted-foreground/40' : 'text-muted-foreground/0'
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontalIcon className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px] border-(length:--border-width) border-muted/30">
            <TooltipProvider>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <div className=''>
                    <DropdownMenuItem
                      variant="transparent"
                      hoverVariant="constructive"
                      className='not-hover:dark:text-constructive not-hover:dark:bg-constructive/20 not-hover:text-constructive-foreground not-hover:bg-constructive-foreground/20'
                      disabled={!isForkable || !hasSnapshot || isCustomMachine}
                      onClick={() => isForkable && hasSnapshot && !isCustomMachine && onFork?.(agent.id)}
                    >
                      <Fork className="!min-h-4 !min-w-4 mr-2 text-inherit" />
                      Fork
                      {(!isForkable || !hasSnapshot || isCustomMachine) && <HelpCircle className="h-3 w-3 ml-auto" />}
                    </DropdownMenuItem>
                  </div>
                </TooltipTrigger>
                {isCustomMachine && (
                  <TooltipContent>
                    <p>Cannot fork agents running on custom machines</p>
                  </TooltipContent>
                )}
                {!isCustomMachine && !hasSnapshot && (
                  <TooltipContent>
                    <p>Cannot fork: no snapshot available yet</p>
                  </TooltipContent>
                )}
                {!isCustomMachine && hasSnapshot && !isForkable && agent.state === AgentState.RUNNING && (
                  <TooltipContent>
                    <p>Cannot fork agent while the agent is working, wait until it has finished or interrupt it</p>
                  </TooltipContent>
                )}
                {!isCustomMachine && hasSnapshot && !isForkable && agent.state !== AgentState.RUNNING && (
                  <TooltipContent>
                    <p>Cannot fork agent before it has been fully initialized</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip delayDuration={200}>
                <TooltipTrigger asChild>
                  <div>
                    <DropdownMenuItem
                      variant="transparent"
                      hoverVariant="default"
                      disabled={!isOwner || currentUserRole === ProjectRole.VISITOR}
                      onClick={() => isOwner && currentUserRole !== ProjectRole.VISITOR && setShareDialogOpen(true)}
                    >
                      <Share className="!min-h-4 !min-w-4 mr-2 text-inherit" />
                      Share
                    </DropdownMenuItem>
                  </div>
                </TooltipTrigger>
                {currentUserRole === ProjectRole.VISITOR && (
                  <TooltipContent>
                    <p>Visitors cannot share agents</p>
                  </TooltipContent>
                )}
                {!isOwner && currentUserRole !== ProjectRole.VISITOR && (
                  <TooltipContent>
                    <p>Only the agent owner can share it</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            {/* Template actions */}
            {isOwner && !isTrashed && (
              isTemplate ? (
                onRemoveTemplate && (
                  <DropdownMenuItem
                    variant="transparent"
                    hoverVariant="default"
                    onClick={() => onRemoveTemplate(agent.id)}
                  >
                    <div className="h-4 w-4 mr-2">
                      <Unpin className="max-w-full max-h-full text-inherit" />
                    </div>
                    Remove Template
                  </DropdownMenuItem>
                )
              ) : (
                onMakeTemplate && (
                  <TooltipProvider>
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <div className="" onClick={(e) => e.stopPropagation()}>
                          <TemplateVisibilityPicker
                            mode="create"
                            value={lastTemplateVisibility}
                            onChange={(visibility) => onMakeTemplate(agent.id, visibility)}
                            disabled={!hasSnapshot}
                          />
                        </div>
                      </TooltipTrigger>
                      {!hasSnapshot && (
                        <TooltipContent>
                          <p>Cannot make template: no snapshot available yet</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                )
              )
            )}
            {canUsePortForwarding && (
              <DropdownMenuItem
                variant="transparent"
                hoverVariant="default"
                disabled={isTogglingNetwork}
                onClick={handleToggleNetwork}
              >
                {isTogglingNetwork ? (
                  <Loader2 className="!min-h-4 !min-w-4 mr-2 text-inherit animate-spin" />
                ) : (
                  <div className="h-4 w-4 mr-2">
                    <LiveStream className={cn(
                      "max-h-full max-w-full",
                      isForwarding ? "text-constructive-foreground" : "text-inherit"
                    )} />
                  </div>
                )}
                {isForwarding ? 'Stop Forwarding' : 'Forward Ports'}
              </DropdownMenuItem>
            )}
            {environments && environments.length > 0 && (
              <div className="" onClick={(e) => e.stopPropagation()}>
                <EnvironmentPicker
                  variant="in-list"
                  currentEnvironmentId={agent.environmentId}
                  currentEnvironmentName={currentEnvName}
                  environments={environments}
                  onEnvironmentSelect={(environmentId) => {
                    onEnvironmentSelect?.(agent.id, environmentId);
                    setDropdownOpen(false);
                  }}
                  currentUserId={user?.id}
                />
              </div>
            )}
            {isTrashed ? (
              <DropdownMenuItem
                variant="transparent"
                hoverVariant="default"
                onClick={() => onUntrash?.(agent.id)}
              >
                <ArrowLeftIcon className="!min-h-4 !min-w-4 mr-2 text-inherit" />
                Restore from Trash
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                variant="transparent"
                hoverVariant="destructive"
                onClick={() => onDelete?.(agent.id)}
              >
                <Trash className="!min-h-4 !min-w-4 mr-2 text-inherit" />
                Move to Trash
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex flex-col gap-0 pb-1">
          {/* Peremption warning - only show if agent is not archived
          {isWarning && agent.state !== AgentState.ARCHIVED && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="group z-10 w-8 flex justify-end pr-2 gap-1 text-xs cursor-pointer"
                  >
                    <Clock className={cn(
                      "max-h-full max-w-full px-1 rounded-sm text-amber-500 animate-pulse",
                      isSelected ? "opacity-100" : "opacity-50"
                    )} />
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Agent is due to automatically shutdown in {timeLeft}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )} */}
          {/* Network forwarding indicator */}
          {isForwarding && (
            <div className="group z-10 w-8 flex justify-end pr-2 gap-1 text-xs">
              <LiveStream className={cn(
                "max-w-full max-h-full px-1 rounded-sm dark:text-constructive-foreground text-constructive-foreground animate-pulse",
                isSelected ? "opacity-100" : "opacity-50"
              )} />
            </div>
          )}
        </div>
      </div>

      {/* Share Dialog */}
      {shareDialogOpen && (
        <ShareDialog
          isOpen={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          agentId={agent.id}
        />
      )}

      </div>
    </div>
  );
}

export const AgentListItem = AgentListItemComponent;
