import { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronDown, Search, Loader2 } from 'lucide-react';
import { Agent, AgentWithCreator, ProjectRole } from '@/bindings/types';
import { AgentConfigDropdown } from './AgentConfigDropdown';
import { AgentListItem } from './AgentListItem';
import type { AgentConfig } from '@/types/AgentConfig';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { ProjectWorkspace, useAppStore } from '@/stores/useAppStore';
import { useAgentSummaryStore } from '@/stores/useAgentSummaryStore';
import { groupAgentsByTime } from '@/utils/timeGrouping';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import Trash from '../ui/icons/Trash';
import ChatPlus from '../ui/icons/chatplus';
import { cn } from '@/lib/utils';
import { PersonalEnvironment } from '@/hooks/useEnvironments';
import { useProjectTemplates } from '@/hooks/useProjectTemplates';
import { makeAgentTemplate, removeAgentTemplate, type TemplateVisibility } from '@/services/agent.service';
import TemplateIcon from '../ui/icons/TemplateIcon';
import { useAgentSearch } from '@/hooks/useAgentSearch';

interface AgentSidebarProps {
  agents: AgentWithCreator[] | null;
  selectedAgent: AgentWithCreator | null;
  projectWorkspace: ProjectWorkspace;
  onAgentSelect: (agent: AgentWithCreator) => void;
  onAgentDelete: (agentId: string) => void;
  onAgentFork?: (agentId: string) => void;
  onCreateAgent: (config: AgentConfig) => void;
  onProjectMerged?: (newProjectId: string, repositoryId?: string) => void;
  canCreateAgents?: boolean;
  currentUserRole?: ProjectRole | null;
  fetchAgents?: () => Promise<AgentWithCreator[]>;
  updatingAgents?: Set<string>;
  updatedAgents?: Map<string, string>;
  environments?: PersonalEnvironment[];
  onEnvironmentInstall?: (agentId: string, environmentId: string) => Promise<void>;
}

interface GroupedAgents {
  myAgentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithCreator[] }>;
  sharedAgentsByOwner: Record<string, {
    agentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithCreator[] }>;
    ownerName: string;
    ownerImage: string | null;
  }>;
  completedAgentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithCreator[] }>;  // PR merged
  abandonedAgentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithCreator[] }>;  // PR closed (not merged)
  trashedAgentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithCreator[] }>;
}

// Helper component for collapsible headers
function CollapsibleHeader({
  isExpanded,
  onToggle,
  label,
  count,
  icon,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  label: string;
  count: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        className={cn(
          "w-full text-left flex items-center gap-2 text-xs px-3 pt-1 transition-colors rounded-md text-muted-foreground/50 hover:text-muted-foreground/70"
        )}
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 flex-shrink-0" />
        )}
        {icon}
        <span>{label}</span>
        <span className="text-muted-foreground/30">({count})</span>
      </button>
    </div>
  );
}

// Helper component for non-collapsible time labels
function TimeLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-1 text-xs text-muted-foreground/50">
      {label}
    </div>
  );
}

// Helper component for owner header
function OwnerHeader({
  ownerName,
  ownerImage,
  totalAgents,
  isExpanded,
  onToggle,
}: {
  ownerName: string;
  ownerImage: string | null;
  totalAgents: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        className="w-full h-auto py-2 px-3 justify-start group rounded-md transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 w-full">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 flex-shrink-0" />
          )}
          <span className="text-sm text-muted-foreground/50 mr-2">Shared by</span>
          <Avatar className="h-6 w-6 flex-shrink-0">
            {ownerImage && <AvatarImage src={ownerImage} />}
            <AvatarFallback className="text-xs">
              {ownerName === 'Anonymous' ? 'A' : ownerName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm truncate group-hover:underline">{ownerName}</span>
          <span className="text-xs text-muted-foreground ml-1 flex-shrink-0">
            ({totalAgents})
          </span>
        </div>
      </button>
    </div>
  );
}

export function AgentSidebar({
  agents,
  selectedAgent,
  projectWorkspace,
  onAgentSelect,
  onAgentDelete,
  onAgentFork,
  onCreateAgent,
  onProjectMerged,
  canCreateAgents = true,
  currentUserRole = null,
  fetchAgents,
  updatingAgents = new Set(),
  updatedAgents = new Map(),
  environments = [],
  onEnvironmentInstall
}: AgentSidebarProps) {
  const user = useAppStore(state => state.user);
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());
  const [expandedTimeGroups, setExpandedTimeGroups] = useState<Set<string>>(new Set(['ongoing-work']));
  const { toast } = useToast();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  const { results: searchResults, resultsMap: searchResultsMap, loading: searchLoading, isSearching } = useAgentSearch(searchTerm, projectWorkspace.id);

  // Templates
  const { templates, limit: templateLimit, invalidate: invalidateTemplates } = useProjectTemplates(projectWorkspace.id);
  const lastTemplateVisibility = useAppStore(state => state.lastTemplateVisibility);
  const setLastTemplateVisibility = useAppStore(state => state.setLastTemplateVisibility);

  const handleMakeTemplate = async (agentId: string, visibility: TemplateVisibility) => {
    // Remember the user's choice
    setLastTemplateVisibility(visibility);

    const result = await makeAgentTemplate(agentId, visibility);
    if (result.success) {
      toast({
        title: 'Agent marked as template',
        description: visibility === 'shared'
          ? 'This agent is now visible to all project members.'
          : 'This agent is now a personal template.',
      });
      invalidateTemplates();
      if (fetchAgents) {
        fetchAgents();
      }
    } else {
      toast({
        title: 'Failed to mark as template',
        description: result.code === 'TEMPLATE_LIMIT_REACHED'
          ? `Template limit reached (${templateLimit}). Remove a template first.`
          : result.error,
        variant: 'destructive',
      });
    }
  };

  const handleRemoveTemplate = async (agentId: string) => {
    const result = await removeAgentTemplate(agentId);
    if (result.success) {
      toast({
        title: 'Template removed',
        description: 'Agent is no longer a template.',
      });
      invalidateTemplates();
      if (fetchAgents) {
        fetchAgents();
      }
    } else {
      toast({
        title: 'Failed to remove template',
        description: result.error,
        variant: 'destructive',
      });
    }
  };

  const groupedAgents = useMemo<GroupedAgents>(() => {
    if (!agents || !user) {
      return { myAgentsByTime: [], sharedAgentsByOwner: {}, completedAgentsByTime: [], abandonedAgentsByTime: [], trashedAgentsByTime: [] };
    }

    const myAgents: AgentWithCreator[] = [];
    const sharedAgentsByOwner: Record<string, { agents: AgentWithCreator[]; ownerName: string; ownerImage: string | null }> = {};
    const completedAgents: AgentWithCreator[] = [];
    const abandonedAgents: AgentWithCreator[] = [];

    // Separate trashed agents first
    const trashedAgents = agents.filter(agent => agent.isTrashed);
    const nonTrashedAgents = agents.filter(agent => !agent.isTrashed);

    // Separate by PR state (completed/abandoned go to special categories)
    for (const agent of nonTrashedAgents) {
      if (agent.prState === 'merged') {
        completedAgents.push(agent);
      } else if (agent.prState === 'closed') {
        abandonedAgents.push(agent);
      } else if (agent.userId === user.id) {
        myAgents.push(agent);
      } else {
        const ownerId = agent.userId;
        if (!sharedAgentsByOwner[ownerId]) {
          sharedAgentsByOwner[ownerId] = {
            agents: [],
            ownerName: agent.creator?.name || 'Anonymous',
            ownerImage: agent.creator?.image || null
          };
        }
        sharedAgentsByOwner[ownerId].agents.push(agent);
      }
    }

    // Group my agents by time
    const myAgentsByTime = groupAgentsByTime(myAgents);

    // Group shared agents by time for each owner
    const sharedAgentsByOwnerWithTime: Record<string, {
      agentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithCreator[] }>;
      ownerName: string;
      ownerImage: string | null;
    }> = {};

    for (const [ownerId, ownerData] of Object.entries(sharedAgentsByOwner)) {
      sharedAgentsByOwnerWithTime[ownerId] = {
        agentsByTime: groupAgentsByTime(ownerData.agents),
        ownerName: ownerData.ownerName,
        ownerImage: ownerData.ownerImage,
      };
    }

    // Group special categories by time as well
    const completedAgentsByTime = groupAgentsByTime(completedAgents);
    const abandonedAgentsByTime = groupAgentsByTime(abandonedAgents);
    const trashedAgentsByTime = groupAgentsByTime(trashedAgents);

    return {
      myAgentsByTime,
      sharedAgentsByOwner: sharedAgentsByOwnerWithTime,
      completedAgentsByTime,
      abandonedAgentsByTime,
      trashedAgentsByTime
    };
  }, [agents, user]);

  const toggleOwner = (ownerId: string) => {
    setExpandedOwners(prev => {
      const newSet = new Set(prev);
      if (newSet.has(ownerId)) {
        newSet.delete(ownerId);
      } else {
        newSet.add(ownerId);
      }
      return newSet;
    });
  };

  const toggleTimeGroup = (groupKey: string) => {
    setExpandedTimeGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupKey)) {
        newSet.delete(groupKey);
      } else {
        newSet.add(groupKey);
      }
      return newSet;
    });
  };

  const handleUntrashAgent = async (agentId: string) => {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/untrash`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restore agent from trash');
      }

      // Refresh the agents list
      if (fetchAgents) {
        await fetchAgents();
      }

    } catch (error) {
      console.error('Failed to restore agent from trash:', error);
      toast({
        title: 'Failed to restore from trash',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleEnvironmentInstall = async (agentId: string, environmentId: string) => {
    if (onEnvironmentInstall) {
      await onEnvironmentInstall(agentId, environmentId);
    }
  };

  // Start polling agent summaries for all agents
  const startPolling = useAgentSummaryStore(state => state.startPolling);
  const stopPolling = useAgentSummaryStore(state => state.stopPolling);

  // Stabilize agent IDs — only re-subscribe when the set of IDs actually changes
  const sidebarAgentIds = useMemo(() => agents?.map(a => a.id) ?? [], [agents]);
  const prevSidebarIdsRef = useRef<string>('');

  useEffect(() => {
    const key = [...sidebarAgentIds].sort().join(',');
    if (key === prevSidebarIdsRef.current) return;
    prevSidebarIdsRef.current = key;

    if (sidebarAgentIds.length === 0) {
      stopPolling();
      return;
    }

    startPolling(sidebarAgentIds);

    return () => {
      stopPolling();
    };
  }, [sidebarAgentIds, startPolling, stopPolling]);

  return (
      <div className="w-full flex-1 min-h-0 flex flex-col gap-2 pt-3 md:pt-2">
        {/* Search Bar */}
        {(agents?.length ?? 0) > 1 && (
          <div className="relative">
            {searchLoading ? (
              <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
            ) : (
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            )}
            <Input
              placeholder="Search agents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-8 text-sm"
              />
          </div>
        )}

        {canCreateAgents && (
          <AgentConfigDropdown
            trigger={
              <Button
                variant="transparent"
                hoverVariant='constructive'
                size="sm"
                className='pr-4 pl-3 w-full'
              >
                <div className="w-4 h-4">
                  <ChatPlus className="max-h-full max-w-full flex-shrink-0 text-inherit" />
                </div>
                <span>New Agent</span>
              </Button>
            }
            projectWorkspace={projectWorkspace}
            onConfirm={onCreateAgent}
            onProjectMerged={onProjectMerged}
            environments={environments}
          />
        )}

        {agents && (
          <div ref={scrollContainerRef} className="flex flex-col gap-2 overflow-y-auto relative flex-1 min-h-0">
            {/* Search Results View */}
            {isSearching ? (
              <div className="space-y-2">
                {searchResults.length === 0 && !searchLoading && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                    No agents found
                  </div>
                )}
                {searchResults.map((result) => {
                  const agent = agents.find(a => a.id === result.agentId);
                  if (!agent) return null;
                  const currentEnvName = agent.environmentId
                    ? environments.find(e => e.id === agent.environmentId)?.name || null
                    : null;
                  return (
                    <div key={agent.id} className="space-y-1">
                      <AgentListItem
                        agent={agent}
                        projectCloneUrl={projectWorkspace.cloneUrl}
                        projectRepositoryId={projectWorkspace.repositoryId}
                        isSelected={selectedAgent?.id === agent.id}
                        onSelect={onAgentSelect}
                        onDelete={onAgentDelete}
                        onFork={onAgentFork}
                        currentUserRole={currentUserRole}
                        isUpdatingEnvironment={updatingAgents.has(agent.id)}
                        justUpdatedToEnv={updatedAgents.get(agent.id)}
                        currentEnvName={currentEnvName}
                        environments={environments}
                        onEnvironmentSelect={handleEnvironmentInstall}
                        isTrashed={agent.isTrashed}
                        onUntrash={agent.isTrashed ? handleUntrashAgent : undefined}
                      />
                      {/* Search excerpt */}
                      {result.excerpt && (
                        <div className="px-3 text-xs text-muted-foreground truncate">
                          <span>
                            {result.excerpt.slice(0, result.excerptMatchStart)}
                          </span>
                          <span className="bg-yellow-500/30 text-foreground">
                            {result.excerpt.slice(result.excerptMatchStart, result.excerptMatchEnd)}
                          </span>
                          <span>
                            {result.excerpt.slice(result.excerptMatchEnd)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
            <>
            {/* Templates Section - Split into Team and Personal */}
            {(() => {
              const teamTemplates = templates.filter(t => t.templateVisibility === 'shared');
              const personalTemplates = templates.filter(t => t.templateVisibility === 'personal');
              const hasTemplates = templates.length > 0;

              if (!hasTemplates) return null;

              return (
                <div className="space-y-2 mb-2">
                  {/* Team Templates */}
                  {teamTemplates.length > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <CollapsibleHeader
                          isExpanded={expandedTimeGroups.has('team-templates')}
                          onToggle={() => toggleTimeGroup('team-templates')}
                          label="Team Templates"
                          count={teamTemplates.length}
                          icon={<div className="h-4 w-4"><TemplateIcon className='max-w-full max-h-full text-inherit'/></div>}
                        />
                      </div>
                      {expandedTimeGroups.has('team-templates') && (
                        <div className="space-y-2">
                          {teamTemplates.map((template) => {
                            const currentEnvName = template.environmentId
                              ? environments.find(e => e.id === template.environmentId)?.name || null
                              : null;
                            return (
                              <AgentListItem
                                key={template.id}
                                agent={template}
                                projectCloneUrl={projectWorkspace.cloneUrl}
                                projectRepositoryId={projectWorkspace.repositoryId}
                                isSelected={selectedAgent?.id === template.id}
                                onSelect={onAgentSelect}
                                onDelete={onAgentDelete}
                                onFork={onAgentFork}
                                currentUserRole={currentUserRole}
                                isUpdatingEnvironment={updatingAgents.has(template.id)}
                                justUpdatedToEnv={updatedAgents.get(template.id)}
                                currentEnvName={currentEnvName}
                                environments={environments}
                                onEnvironmentSelect={handleEnvironmentInstall}
                                isTemplate={true}
                                onRemoveTemplate={handleRemoveTemplate}
                                lastTemplateVisibility={lastTemplateVisibility}
                              />
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  {/* Personal Templates */}
                  {personalTemplates.length > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <CollapsibleHeader
                          isExpanded={expandedTimeGroups.has('personal-templates')}
                          onToggle={() => toggleTimeGroup('personal-templates')}
                          label="Personal Templates"
                          count={personalTemplates.length}
                          icon={<div className="h-4 w-4"><TemplateIcon className='max-w-full max-h-full text-inherit'/></div>}
                        />
                      </div>
                      {expandedTimeGroups.has('personal-templates') && (
                        <div className="space-y-2">
                          {personalTemplates.map((template) => {
                            const currentEnvName = template.environmentId
                              ? environments.find(e => e.id === template.environmentId)?.name || null
                              : null;
                            return (
                              <AgentListItem
                                key={template.id}
                                agent={template}
                                projectCloneUrl={projectWorkspace.cloneUrl}
                                projectRepositoryId={projectWorkspace.repositoryId}
                                isSelected={selectedAgent?.id === template.id}
                                onSelect={onAgentSelect}
                                onDelete={onAgentDelete}
                                onFork={onAgentFork}
                                currentUserRole={currentUserRole}
                                isUpdatingEnvironment={updatingAgents.has(template.id)}
                                justUpdatedToEnv={updatedAgents.get(template.id)}
                                currentEnvName={currentEnvName}
                                environments={environments}
                                onEnvironmentSelect={handleEnvironmentInstall}
                                isTemplate={true}
                                onRemoveTemplate={handleRemoveTemplate}
                                lastTemplateVisibility={lastTemplateVisibility}
                              />
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}

                  <div className="w-full px-2">
                    <div className='w-full h-px border-b-(length:--border-width) border-dashed border-muted/30'></div>
                  </div>
                </div>
              );
            })()}

            {/* Ongoing Work - Collapsible with Time Groups Inside */}
            {groupedAgents.myAgentsByTime.length > 0 && (
              <div className="space-y-2">
                <CollapsibleHeader
                  isExpanded={expandedTimeGroups.has('ongoing-work')}
                  onToggle={() => toggleTimeGroup('ongoing-work')}
                  label="Ongoing Work"
                  count={groupedAgents.myAgentsByTime.reduce((sum, g) => sum + g.agents.length, 0)}
                />

                {expandedTimeGroups.has('ongoing-work') && (
                  <div className="space-y-3">
                    {groupedAgents.myAgentsByTime.map((timeGroup) => {
                      const label = timeGroup.group.label;

                      return (
                        <div key={timeGroup.group.key} className="space-y-2">
                          {/* Time group label - non-collapsible */}
                          {label && <TimeLabel label={label} />}

                          {/* Agents in this time group - always visible */}
                          <div className="space-y-2">
                            {timeGroup.agents.map((agent) => {
                              const currentEnvName = agent.environmentId
                                ? environments.find(e => e.id === agent.environmentId)?.name || null
                                : null;
                              return (
                                <AgentListItem
                                  key={agent.id}
                                  agent={agent}
                                  projectCloneUrl={projectWorkspace.cloneUrl}
                                  projectRepositoryId={projectWorkspace.repositoryId}
                                  isSelected={selectedAgent?.id === agent.id}
                                  onSelect={onAgentSelect}
                                  onDelete={onAgentDelete}
                                  onFork={onAgentFork}

                                  currentUserRole={currentUserRole}
                                  isUpdatingEnvironment={updatingAgents.has(agent.id)}
                                  justUpdatedToEnv={updatedAgents.get(agent.id)}
                                  currentEnvName={currentEnvName}
                                  environments={environments}
                                  onEnvironmentSelect={handleEnvironmentInstall}
                                  onMakeTemplate={handleMakeTemplate}
                                  lastTemplateVisibility={lastTemplateVisibility}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Shared Agents - Grouped by Owner with Collapsible Sections and Time Groups */}
            {Object.entries(groupedAgents.sharedAgentsByOwner).map(([ownerId, { agentsByTime, ownerName, ownerImage }]) => {
              const isExpanded = expandedOwners.has(ownerId);
              const totalAgents = agentsByTime.reduce((sum, timeGroup) => sum + timeGroup.agents.length, 0);

              return (
                <div key={ownerId} className="space-y-2">
                  {/* Owner Header */}
                  <OwnerHeader
                    ownerName={ownerName}
                    ownerImage={ownerImage}
                    totalAgents={totalAgents}
                    isExpanded={isExpanded}
                    onToggle={() => toggleOwner(ownerId)}
                  />

                  {/* Owner's Agents - Grouped by Time */}
                  {isExpanded && (
                    <div className="space-y-3">
                      {agentsByTime.map((timeGroup) => {
                        return (
                          <div key={timeGroup.group.key} className="space-y-2">
                            {/* Time group label - non-collapsible */}
                            {timeGroup.group.label && <TimeLabel label={timeGroup.group.label} />}

                            {/* Agents in this time group - always visible */}
                            <div className="space-y-2">
                              {timeGroup.agents.map((agent) => {
                                const currentEnvName = agent.environmentId
                                  ? environments.find(e => e.id === agent.environmentId)?.name || null
                                  : null;
                                return (
                                  <AgentListItem
                                    key={agent.id}
                                    agent={agent}
                                    projectCloneUrl={projectWorkspace.cloneUrl}
                                    projectRepositoryId={projectWorkspace.repositoryId}
                                    isSelected={selectedAgent?.id === agent.id}
                                    onSelect={onAgentSelect}
                                    onDelete={onAgentDelete}
                                    onFork={onAgentFork}

                                    currentUserRole={currentUserRole}
                                    isUpdatingEnvironment={updatingAgents.has(agent.id)}
                                    justUpdatedToEnv={updatedAgents.get(agent.id)}
                                    currentEnvName={currentEnvName}
                                    environments={environments}
                                    onEnvironmentSelect={handleEnvironmentInstall}
                                    onMakeTemplate={handleMakeTemplate}
                                    lastTemplateVisibility={lastTemplateVisibility}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Completed Agents Section (PR Merged) - with Time Groups */}
            {groupedAgents.completedAgentsByTime.length > 0 && (
              <div className="space-y-2">
                <CollapsibleHeader
                  isExpanded={expandedTimeGroups.has('completed')}
                  onToggle={() => toggleTimeGroup('completed')}
                  label="Completed"
                  count={groupedAgents.completedAgentsByTime.reduce((sum, g) => sum + g.agents.length, 0)}
                />

                {expandedTimeGroups.has('completed') && (
                  <div className="space-y-3">
                    {groupedAgents.completedAgentsByTime.map((timeGroup) => (
                      <div key={timeGroup.group.key} className="space-y-2">
                        {timeGroup.group.label && <TimeLabel label={timeGroup.group.label} />}
                        <div className="space-y-2">
                          {timeGroup.agents.map((agent) => {
                            const currentEnvName = agent.environmentId
                              ? environments.find(e => e.id === agent.environmentId)?.name || null
                              : null;
                            return (
                              <AgentListItem
                                key={agent.id}
                                agent={agent}
                                projectCloneUrl={projectWorkspace.cloneUrl}
                                projectRepositoryId={projectWorkspace.repositoryId}
                                isSelected={selectedAgent?.id === agent.id}
                                onSelect={onAgentSelect}
                                onDelete={onAgentDelete}
                                onFork={onAgentFork}
                                currentUserRole={currentUserRole}
                                isUpdatingEnvironment={updatingAgents.has(agent.id)}
                                justUpdatedToEnv={updatedAgents.get(agent.id)}
                                currentEnvName={currentEnvName}
                                environments={environments}
                                onEnvironmentSelect={handleEnvironmentInstall}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Abandoned Agents Section (PR Closed) - with Time Groups */}
            {groupedAgents.abandonedAgentsByTime.length > 0 && (
              <div className="space-y-2">
                <CollapsibleHeader
                  isExpanded={expandedTimeGroups.has('abandoned')}
                  onToggle={() => toggleTimeGroup('abandoned')}
                  label="Abandoned"
                  count={groupedAgents.abandonedAgentsByTime.reduce((sum, g) => sum + g.agents.length, 0)}
                />

                {expandedTimeGroups.has('abandoned') && (
                  <div className="space-y-3">
                    {groupedAgents.abandonedAgentsByTime.map((timeGroup) => (
                      <div key={timeGroup.group.key} className="space-y-2">
                        {timeGroup.group.label && <TimeLabel label={timeGroup.group.label} />}
                        <div className="space-y-2">
                          {timeGroup.agents.map((agent) => {
                            const currentEnvName = agent.environmentId
                              ? environments.find(e => e.id === agent.environmentId)?.name || null
                              : null;
                            return (
                              <AgentListItem
                                key={agent.id}
                                agent={agent}
                                projectCloneUrl={projectWorkspace.cloneUrl}
                                projectRepositoryId={projectWorkspace.repositoryId}
                                isSelected={selectedAgent?.id === agent.id}
                                onSelect={onAgentSelect}
                                onDelete={onAgentDelete}
                                onFork={onAgentFork}
                                currentUserRole={currentUserRole}
                                isUpdatingEnvironment={updatingAgents.has(agent.id)}
                                justUpdatedToEnv={updatedAgents.get(agent.id)}
                                currentEnvName={currentEnvName}
                                environments={environments}
                                onEnvironmentSelect={handleEnvironmentInstall}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Trashed Agents Section - with Time Groups */}
            {groupedAgents.trashedAgentsByTime.length > 0 && (
              <div className="space-y-2 mt-auto mb-2">
                {/* Trash header - collapsible, styled like time groups */}
                <CollapsibleHeader
                  isExpanded={expandedTimeGroups.has('trashed')}
                  onToggle={() => toggleTimeGroup('trashed')}
                  label="Trash"
                  count={groupedAgents.trashedAgentsByTime.reduce((sum, g) => sum + g.agents.length, 0)}
                  icon={<div className="h-4 w-4"><Trash className='max-w-full max-h-full text-inherit'/></div>}
                />

                {/* Trashed agents list - with Time Groups */}
                {expandedTimeGroups.has('trashed') && (
                  <div className="space-y-3">
                    {groupedAgents.trashedAgentsByTime.map((timeGroup) => (
                      <div key={timeGroup.group.key} className="space-y-2">
                        {timeGroup.group.label && <TimeLabel label={timeGroup.group.label} />}
                        <div className="space-y-2">
                          {timeGroup.agents.map((agent) => {
                            const currentEnvName = agent.environmentId
                              ? environments.find(e => e.id === agent.environmentId)?.name || null
                              : null;
                            return (
                              <AgentListItem
                                key={agent.id}
                                agent={agent}
                                projectCloneUrl={projectWorkspace.cloneUrl}
                                projectRepositoryId={projectWorkspace.repositoryId}
                                isSelected={selectedAgent?.id === agent.id}
                                onSelect={onAgentSelect}
                                onDelete={onAgentDelete}
                                onFork={onAgentFork}

                                currentUserRole={currentUserRole}
                                isTrashed={true}
                                onUntrash={handleUntrashAgent}
                                isUpdatingEnvironment={updatingAgents.has(agent.id)}
                                justUpdatedToEnv={updatedAgents.get(agent.id)}
                                currentEnvName={currentEnvName}
                                environments={environments}
                                onEnvironmentSelect={handleEnvironmentInstall}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </>
            )}
          </div>
        )}
      </div>
  );
}
