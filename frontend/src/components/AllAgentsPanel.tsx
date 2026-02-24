import { useState, useMemo, useEffect, useRef } from 'react';
import { useAllAgents, type AgentWithProject } from '@/hooks/useAllAgents';
import { AgentListItem } from './agent-manager/AgentListItem';
import { Input } from '@/components/ui/input';
import { Search, ChevronRight, ChevronDown, Plus, Loader2 } from 'lucide-react';
import { agentCreationService } from '@/services/agent.service';
import { useAppStore, type ProjectWorkspace } from '@/stores/useAppStore';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/hooks/useProjects';
import { posthog } from '@/lib/posthog';
import { useAgentSummaryStore } from '@/stores/useAgentSummaryStore';
import { groupAgentsByTime } from '@/utils/timeGrouping';
import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import Trash from './ui/icons/Trash';
import { useRouter } from '@/hooks/useRouter';
import { useAgentSearch, type AgentSearchResult } from '@/hooks/useAgentSearch';

interface AllAgentsPanelProps {
  onAgentSelected: (projectWorkspace: ProjectWorkspace, agentId: string) => void;
}

interface GroupedAgents {
  myAgentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithProject[] }>;
  sharedAgentsByOwner: Record<string, {
    agentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithProject[] }>;
    ownerName: string;
    ownerImage: string | null;
  }>;
  trashedAgents: AgentWithProject[];
}

export function AllAgentsPanel({ onAgentSelected }: AllAgentsPanelProps) {
  const { agents, loading, deleteAgent, fetchAgents } = useAllAgents();
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOwners, setExpandedOwners] = useState<Set<string>>(new Set());
  const [expandedTimeGroups, setExpandedTimeGroups] = useState<Set<string>>(new Set());
  const { projects: projectWorkspaces } = useProjects();
  const { navigateTo } = useRouter();

  // Use backend search when search term is present
  const { results: searchResults, resultsMap: searchResultsMap, loading: searchLoading, isSearching } = useAgentSearch(searchTerm);

  const user = useAppStore(state => state.user);
  const { toast } = useToast();

  const handleAddAgent = () => {
    posthog.capture('add_agent_clicked', { source: 'agents_panel' });
    navigateTo({ type: 'main-menu', tab: 'quick-launch' });
  };

  // Track agents panel opened on mount
  useEffect(() => {
    posthog.capture('agents_panel_opened', {
      agent_count: agents?.length || 0
    });
  }, []);

  // When searching, use backend search results; otherwise show all agents
  const filteredAgents = useMemo(() => {
    if (!agents) return [];

    if (isSearching && searchResults.length > 0) {
      // Filter agents to only those in search results, maintaining search result order
      const searchAgentIds = new Set(searchResults.map(r => r.agentId));
      const agentMap = new Map(agents.map(a => [a.id, a]));

      // Return in search result order (by score)
      return searchResults
        .filter(r => agentMap.has(r.agentId))
        .map(r => agentMap.get(r.agentId)!);
    }

    if (isSearching && searchResults.length === 0 && !searchLoading) {
      // Search returned no results
      return [];
    }

    // Not searching, return all agents
    return agents;
  }, [agents, searchResults, isSearching, searchLoading]);

  const groupedAgents = useMemo<GroupedAgents>(() => {
    if (!filteredAgents || !user) {
      return { myAgentsByTime: [], sharedAgentsByOwner: {}, trashedAgents: [] };
    }

    const myAgents: AgentWithProject[] = [];
    const sharedAgentsByOwner: Record<string, { agents: AgentWithProject[]; ownerName: string; ownerImage: string | null }> = {};

    // Separate trashed and non-trashed agents
    const nonTrashedAgents = filteredAgents.filter(agent => !agent.isTrashed);
    const trashedAgents = filteredAgents.filter(agent => agent.isTrashed);

    // Process non-trashed agents for regular groups
    for (const agent of nonTrashedAgents) {
      if (agent.userId === user.id) {
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
      agentsByTime: Array<{ group: { key: string; label: string | null }; agents: AgentWithProject[] }>;
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

    return {
      myAgentsByTime,
      sharedAgentsByOwner: sharedAgentsByOwnerWithTime,
      trashedAgents
    };
  }, [filteredAgents, user]);

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

  // Start polling agent summaries for all agents (no focused agent in all agents panel)
  const startPolling = useAgentSummaryStore(state => state.startPolling);
  const stopPolling = useAgentSummaryStore(state => state.stopPolling);

  // Stabilize agent IDs — only re-subscribe when the set of IDs actually changes
  const agentIds = useMemo(() => agents?.map(a => a.id) ?? [], [agents]);
  const prevAgentIdsRef = useRef<string>('');

  useEffect(() => {
    const key = [...agentIds].sort().join(',');
    if (key === prevAgentIdsRef.current) return;
    prevAgentIdsRef.current = key;

    if (agentIds.length === 0) {
      stopPolling();
      return;
    }

    startPolling(agentIds);

    return () => {
      stopPolling();
    };
  }, [agentIds, startPolling, stopPolling]);

  const handleAgentClick = (agentId: string, projectId: string) => {
    const agent = agents?.find(a => a.id === agentId);
    posthog.capture('agent_opened', {
      agent_id: agentId,
      project_id: projectId,
      is_own_agent: agent?.userId === user?.id,
      from_search: searchTerm.length > 0,
      source: 'agents_panel'
    });
    const projectWorkspace = projectWorkspaces.find(p => p.id === projectId);
    if (projectWorkspace) {
      onAgentSelected(projectWorkspace, agentId);
    }
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
        throw new Error(data.error || 'Failed to unarchive agent');
      }

      // Refresh the agents list
      await fetchAgents();
    } catch (error) {
      console.error('Failed to put agent out of trash:', error);
      toast({
        title: 'Failed to put agent out of trash',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleForkAgent = async (agentId: string, projectId: string) => {
    if (!user?.id) {
      toast({
        title: 'Error',
        description: 'You must be logged in to fork an agent',
        variant: 'destructive'
      });
      return;
    }

    posthog.capture('agent_fork_started', {
      agent_id: agentId,
      project_id: projectId,
      source: 'agents_panel'
    });

    // Also track as agent creation
    posthog.capture('agent_creation_started', {
      source: 'fork',
      source_agent_id: agentId,
      project_id: projectId,
      provider: 'claude-code'
    });

    // Find the project workspace to get localPath
    const projectWorkspace = projectWorkspaces.find(p => p.id === projectId);
    const localPath = projectWorkspace?.localPath;

    const result = await agentCreationService.forkAgent(
      agentId,
      user.id,
      undefined, // newAgentName - let backend generate it
      localPath // Pass localPath for bundle fallback
    );

    if (result.success) {
      posthog.capture('agent_fork_succeeded', {
        source_agent_id: agentId,
        target_agent_id: result.targetAgentId,
        project_id: projectId
      });
      fetchAgents?.();
    } else if (!result.limitExceeded) {
      posthog.capture('agent_fork_failed', {
        agent_id: agentId,
        project_id: projectId,
        error: result.error
      });
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
    <div className="h-full w-full flex flex-col">
      <div className="mb-6 flex flex-col gap-3">
        <Button
          onClick={handleAddAgent}
          variant="transparent"
          hoverVariant="constructive"
          size="sm"
          className="w-full"
        >
          <Plus className="h-4 w-4" />
          <span>Add Agent</span>
        </Button>
        <div className="relative">
          {searchLoading ? (
            <Loader2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4 animate-spin" />
          ) : (
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          )}
          <Input
            placeholder="Search agents..."
            value={searchTerm}
            onChange={(e) => {
              const newValue = e.target.value;
              if (searchTerm.length === 0 && newValue.length > 0) {
                posthog.capture('agents_search_started');
              }
              setSearchTerm(newValue);
            }}
            className="pl-10"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded-md">
        {loading ? (
          <div className="p-4 text-muted-foreground text-sm">Loading agents...</div>
        ) : filteredAgents.length === 0 ? (
          <div className="p-4 text-muted-foreground text-sm">
            {isSearching ? 'No agents match your search' : 'No agents found'}
          </div>
        ) : isSearching && searchResults.length > 0 ? (
          /* When searching, show flat list sorted by score with excerpts */
          <div className="flex flex-col gap-2 w-full">
            {filteredAgents.map((agent) => {
              const projectWorkspace = projectWorkspaces.find(p => p.id === agent.project.id);
              const searchResult = searchResultsMap.get(agent.id);
              return (
                <AgentListItem
                  key={agent.id}
                  agent={agent}
                  projectName={agent.project.name}
                  projectCloneUrl={projectWorkspace?.cloneUrl}
                  projectRepositoryId={projectWorkspace?.repositoryId}
                  onSelect={() => handleAgentClick(agent.id, agent.project.id)}
                  onDelete={deleteAgent}
                  onFork={() => handleForkAgent(agent.id, agent.project.id)}
                  searchResult={searchResult}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-2 w-full">
            {/* My Agents - Grouped by Time */}
            {groupedAgents.myAgentsByTime.length > 0 && (
              <div className="space-y-3">
                {groupedAgents.myAgentsByTime.map((timeGroup) => {
                  const isExpanded = expandedTimeGroups.has(timeGroup.group.key);

                  return (
                    <div key={timeGroup.group.key} className="space-y-2">
                      {/* Time group header - collapsible if has label */}
                      {timeGroup.group.label ? (
                        <button
                          className="w-full text-left flex items-center gap-2 text-xs text-muted-foreground/50 px-3 pt-1 hover:text-muted-foreground/70 transition-colors"
                          onClick={() => toggleTimeGroup(timeGroup.group.key)}
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 flex-shrink-0" />
                          )}
                          <span>{timeGroup.group.label}</span>
                          <span className="text-muted-foreground/30">({timeGroup.agents.length})</span>
                        </button>
                      ) : null}

                      {/* Agents in this time group - show if no label OR if expanded */}
                      {(!timeGroup.group.label || isExpanded) && (
                        <div className="space-y-2">
                          {timeGroup.agents.map((agent) => {
                            const projectWorkspace = projectWorkspaces.find(p => p.id === agent.project.id);
                            return (
                              <AgentListItem
                                key={agent.id}
                                agent={agent}
                                projectName={agent.project.name}
                                projectCloneUrl={projectWorkspace?.cloneUrl}
                                projectRepositoryId={projectWorkspace?.repositoryId}
                                onSelect={() => handleAgentClick(agent.id, agent.project.id)}
                                onDelete={deleteAgent}
                                onFork={() => handleForkAgent(agent.id, agent.project.id)}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Shared Agents - Grouped by Owner with Collapsible Sections and Time Groups */}
            {Object.entries(groupedAgents.sharedAgentsByOwner).map(([ownerId, { agentsByTime, ownerName, ownerImage }]) => {
              const isExpanded = expandedOwners.has(ownerId);
              const totalAgents = agentsByTime.reduce((sum, timeGroup) => sum + timeGroup.agents.length, 0);

              return (
                <div key={ownerId} className="space-y-2">
                  {/* Owner Header */}
                  <Button
                    variant="default"
                    className="w-full h-auto py-2 px-3 justify-start hover:bg-muted/50"
                    onClick={() => toggleOwner(ownerId)}
                  >
                    <div className="flex items-center gap-2 w-full">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 flex-shrink-0" />
                      )}
                      <Avatar className="h-6 w-6 flex-shrink-0">
                        {ownerImage && <AvatarImage src={ownerImage} />}
                        <AvatarFallback className="text-xs">
                          {ownerName === 'Anonymous' ? 'A' : ownerName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium truncate">{ownerName}</span>
                      <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                        {totalAgents}
                      </span>
                    </div>
                  </Button>

                  {/* Owner's Agents - Grouped by Time */}
                  {isExpanded && (
                    <div className="space-y-3">
                      {agentsByTime.map((timeGroup) => {
                        const timeGroupKey = `${ownerId}-${timeGroup.group.key}`;
                        const isTimeGroupExpanded = expandedTimeGroups.has(timeGroupKey);

                        return (
                          <div key={timeGroup.group.key} className="space-y-2">
                            {/* Time group header - collapsible if has label */}
                            {timeGroup.group.label ? (
                              <button
                                className="w-full text-left flex items-center gap-2 text-xs text-muted-foreground/50 px-3 pt-1 hover:text-muted-foreground/70 transition-colors"
                                onClick={() => toggleTimeGroup(timeGroupKey)}
                              >
                                {isTimeGroupExpanded ? (
                                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 flex-shrink-0" />
                                )}
                                <span>{timeGroup.group.label}</span>
                                <span className="text-muted-foreground/30">({timeGroup.agents.length})</span>
                              </button>
                            ) : null}

                            {/* Agents in this time group - show if no label OR if expanded */}
                            {(!timeGroup.group.label || isTimeGroupExpanded) && (
                              <div className="space-y-2">
                                {timeGroup.agents.map((agent) => {
                                  const projectWorkspace = projectWorkspaces.find(p => p.id === agent.project.id);
                                  return (
                                    <AgentListItem
                                      key={agent.id}
                                      agent={agent}
                                      projectName={agent.project.name}
                                      projectCloneUrl={projectWorkspace?.cloneUrl}
                                      projectRepositoryId={projectWorkspace?.repositoryId}
                                      onSelect={() => handleAgentClick(agent.id, agent.project.id)}
                                      onDelete={deleteAgent}
                                      onFork={() => handleForkAgent(agent.id, agent.project.id)}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Trashed Agents Section */}
            {groupedAgents.trashedAgents.length > 0 && (
              <div className="space-y-2">
                {/* Trash header - collapsible, styled like time groups */}
                <button
                  className="w-full text-left flex items-center gap-2 text-xs text-muted-foreground/50 px-3 pt-1 hover:text-muted-foreground/70 transition-colors"
                  onClick={() => toggleTimeGroup('trashed')}
                >
                  {expandedTimeGroups.has('trashed') ? (
                    <ChevronDown className="h-3 w-3 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 flex-shrink-0" />
                  )}
                  <div className="h-4 w-4">
                    <Trash className='max-w-full max-h-full text-inherit'/>
                  </div>
                  <span>Trash</span>
                  <span className="text-muted-foreground/30">({groupedAgents.trashedAgents.length})</span>
                </button>

                {/* Trashed agents list */}
                {expandedTimeGroups.has('trashed') && (
                  <div className="space-y-2">
                    {groupedAgents.trashedAgents.map((agent) => {
                      const projectWorkspace = projectWorkspaces.find(p => p.id === agent.project.id);
                      return (
                        <AgentListItem
                          key={agent.id}
                          agent={agent}
                          projectName={agent.project.name}
                          projectCloneUrl={projectWorkspace?.cloneUrl}
                          projectRepositoryId={projectWorkspace?.repositoryId}
                          onSelect={() => handleAgentClick(agent.id, agent.project.id)}
                          onDelete={deleteAgent}
                          onFork={() => handleForkAgent(agent.id, agent.project.id)}
                          isTrashed={true}
                          onUntrash={handleUntrashAgent}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
