import { useState, useMemo, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useAppStore, type ProjectWorkspace } from '@/stores/useAppStore';
import { projectService } from '@/services/project.service';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { AgentConfig } from '@/types/AgentConfig';
import { MACHINE_SPECS, type MachineType, type MachineSource } from '@/bindings/types';
import { apiRequest, authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { machinesService, type CustomMachine } from '@/services/machines.service';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ProjectOriginDialog } from './ProjectOriginDialog';
import type { ProjectOrigin } from '@/types/ProjectOrigin';
import { getProjectOriginDisplay } from '@/types/ProjectOrigin';
import { getTauriAPI } from '@/lib/tauri-api';
import type { UseAgentCreationReturn } from '@/hooks/useAgentCreation';
import { useProjects } from '@/hooks/useProjects';
import GithubLogo from '../ui/icons/GithubLogo';
import FolderOpen from '../ui/icons/FolderOpen';
import CloudFolder from '../ui/icons/CloudFolder';
import CodeFolder from '../ui/icons/CodeFolder';
import { posthog } from '@/lib/posthog';

type LaunchTarget =
  | { type: 'project'; project: ProjectWorkspace }
  | { type: 'origin'; origin: ProjectOrigin };

interface QuickLaunchTabProps {
  onProjectWorkspaceSelected: (projectWorkspace: ProjectWorkspace, agentId?: string) => void;
  onNavigateToPermissions: () => void;
  agentCreation: UseAgentCreationReturn;
}

function getProjectIcon(project: ProjectWorkspace) {
  if (project.repositoryId) return <GithubLogo className='max-h-full max-w-full text-inherit' />;
  if (project.cloneUrl) return <CloudFolder className='max-h-full max-w-full text-inherit' />;
  if (project.localPath) return <FolderOpen className='max-h-full max-w-full text-inherit' />;
  return <CodeFolder className='max-h-full max-w-full text-inherit' />;
}

function getLaunchTargetDisplay(target: LaunchTarget): { icon: React.ReactNode; text: string } {
  if (target.type === 'project') {
    return {
      icon: getProjectIcon(target.project),
      text: target.project.name
    };
  }
  const originDisplay = getProjectOriginDisplay(target.origin);
  const iconMap: Record<string, React.ReactNode> = {
    folder: <FolderOpen className='max-h-full max-w-full text-inherit' />,
    github: <GithubLogo className='max-h-full max-w-full text-inherit' />,
    git: <CloudFolder className='max-h-full max-w-full text-inherit' />,
  };
  return { icon: iconMap[originDisplay.icon], text: originDisplay.text };
}

const MAX_RECENT_PROJECTS = 7;

export function QuickLaunchTab({ onProjectWorkspaceSelected, onNavigateToPermissions, agentCreation }: QuickLaunchTabProps) {
  const [prompt, setPrompt] = useState('');
  const [launchTarget, setLaunchTarget] = useState<LaunchTarget | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<MachineType>('cx43');
  const [machineSource, setMachineSource] = useState<MachineSource>('hetzner');
  const [customMachines, setCustomMachines] = useState<CustomMachine[]>([]);
  const [selectedCustomMachineId, setSelectedCustomMachineId] = useState<string | null>(null);
  const [originDialogOpen, setOriginDialogOpen] = useState(false);
  const [tutorialExpanded, setTutorialExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasUserSelected = useRef(false);

  const { toast } = useToast();
  const { projects: projectWorkspaces, refreshProjects } = useProjects();
  const userRepositories = useAppStore(state => state.userRepositories);
  const defaultAgentProvider = useAppStore(state => state.defaultAgentProvider);
  const lastQuickLaunchOrigin = useAppStore(state => state.lastQuickLaunchOrigin);
  const setLastQuickLaunchOrigin = useAppStore(state => state.setLastQuickLaunchOrigin);
  const lastQuickLaunchProjectId = useAppStore(state => state.lastQuickLaunchProjectId);
  const setLastQuickLaunchProjectId = useAppStore(state => state.setLastQuickLaunchProjectId);
  // Sort projects by recency
  const recentProjects = useMemo(() => {
    return [...projectWorkspaces].sort((a, b) => {
      const aTime = a.lastOpened || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const bTime = b.lastOpened || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return bTime - aTime;
    }).slice(0, MAX_RECENT_PROJECTS);
  }, [projectWorkspaces]);

  // Track quick launch opened on mount
  useEffect(() => {
    posthog.capture('quick_launch_opened', {
      has_projects: projectWorkspaces.length > 0,
      project_count: projectWorkspaces.length,
      has_history_origin: Boolean(lastQuickLaunchOrigin),
      default_machine: selectedMachine
    });
  }, []);

  // Phase 1: Restore persisted origin immediately (for users with no projects yet)
  useEffect(() => {
    if (hasUserSelected.current) return;
    if (lastQuickLaunchOrigin && !launchTarget) {
      setLaunchTarget({ type: 'origin', origin: lastQuickLaunchOrigin });
    }
  }, [lastQuickLaunchOrigin]);

  // Phase 2: When projects load, prefer project over origin
  useEffect(() => {
    if (hasUserSelected.current) return;
    if (recentProjects.length === 0) return;

    const preferred = lastQuickLaunchProjectId
      ? recentProjects.find(p => p.id === lastQuickLaunchProjectId)
      : null;
    setLaunchTarget({ type: 'project', project: preferred || recentProjects[0] });
  }, [recentProjects, lastQuickLaunchProjectId]);

  // Phase 3: Fallback to first repo if nothing else available
  useEffect(() => {
    if (hasUserSelected.current) return;
    if (!launchTarget && userRepositories && userRepositories.length > 0) {
      setLaunchTarget({
        type: 'origin',
        origin: { type: 'repository', repository: userRepositories[0], branch: 'main' }
      });
    }
  }, [userRepositories, launchTarget]);

  // Fetch custom machines on mount
  useEffect(() => {
    const fetchCustomMachines = async () => {
      try {
        const response = await machinesService.getMachines();
        setCustomMachines(response.machines);
      } catch (error) {
        console.error('Failed to fetch custom machines:', error);
      }
    };
    fetchCustomMachines();
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '2ch';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [prompt]);

  const isValid = useMemo(() => {
    return !!launchTarget;
  }, [launchTarget]);

  const selectProject = (project: ProjectWorkspace) => {
    hasUserSelected.current = true;
    posthog.capture('quick_launch_project_selected', {
      project_id: project.id,
      project_name: project.name,
      source: 'quick_launch'
    });
    setLaunchTarget({ type: 'project', project });
    setLastQuickLaunchProjectId(project.id);
  };

  const selectOrigin = (origin: ProjectOrigin) => {
    hasUserSelected.current = true;
    posthog.capture('origin_selected', {
      origin_type: origin.type,
      source: 'quick_launch'
    });
    setLaunchTarget({ type: 'origin', origin });
    setLastQuickLaunchOrigin(origin);
    setOriginDialogOpen(false);
  };

  const handleStartAgent = async () => {
    if (!isValid || !launchTarget) return;

    posthog.capture('agent_creation_started', {
      source: 'quick_launch',
      target_type: launchTarget.type,
      ...(launchTarget.type === 'origin' && { origin_type: launchTarget.origin.type }),
      ...(launchTarget.type === 'project' && { project_id: launchTarget.project.id }),
      machine_type: selectedMachine,
      has_prompt: Boolean(prompt),
      prompt_length: prompt.length,
      provider: defaultAgentProvider
    });

    try {
      let projectWorkspace: ProjectWorkspace | null = null;

      const machineConfig = {
        machine: selectedMachine,
        machineSource,
        customMachineId: machineSource === 'custom' ? selectedCustomMachineId || undefined : undefined
      };

      let config: AgentConfig;

      if (launchTarget.type === 'project') {
        // Fast path: already have the project
        projectWorkspace = launchTarget.project;

        // Determine source from project properties
        let source: AgentConfig['source'];
        if (projectWorkspace.cloneUrl) {
          source = { from: 'clone-url', url: projectWorkspace.cloneUrl, branch: 'main' };
        } else if (projectWorkspace.localPath && !projectWorkspace.repositoryId) {
          source = { from: 'local' };
        } else {
          source = { from: 'branch', branch: 'main' };
        }

        config = {
          source,
          machine: machineConfig,
          provider: defaultAgentProvider || 'claude-code'
        };
      } else {
        // Origin path: find or create project
        const selectedOrigin = launchTarget.origin;

        if (selectedOrigin.type === 'local') {
          const localProjectsMap = useAppStore.getState().localProjects;
          const backendProjectsArray = useAppStore.getState().backendProjects;

          let existing: ProjectWorkspace | undefined;
          for (const [key, lp] of localProjectsMap) {
            if (lp.gitRoot === selectedOrigin.localPath) {
              const backendProject = backendProjectsArray.find(p => p.id === lp.projectId);
              existing = {
                id: lp.projectId,
                name: lp.name,
                relativePath: lp.relativePath,
                repositoryId: backendProject?.repositoryId,
                localPath: lp.gitRoot,
                lastOpened: lp.lastOpened,
                createdAt: backendProject?.createdAt || lp.createdAt
              };
              break;
            }
          }

          if (existing) {
            projectWorkspace = existing;
          } else {
            const tauri = getTauriAPI();
            const projectInfo = await tauri.invoke<{ githubUrl: string; gitRoot: string } | null>('get_github_remote_url', {
              folderPath: selectedOrigin.localPath
            });

            const gitRoot = projectInfo?.gitRoot || selectedOrigin.localPath;
            const folderName = gitRoot.split(/[/\\]/).filter(Boolean).pop();

            const response = await apiRequest<any>('/api/projects', {
              method: 'POST',
              body: JSON.stringify({
                githubUrl: projectInfo?.githubUrl && projectInfo.githubUrl !== '' ? projectInfo.githubUrl : undefined,
                localFolderName: folderName
              })
            });

            if (response.success && response.project) {
              posthog.capture('project_created_for_agent', {
                project_id: response.project.id,
                source: 'local',
                has_github_url: Boolean(projectInfo?.githubUrl)
              });

              useAppStore.getState().trackLocalProject(
                gitRoot,
                response.project.id,
                response.project.name,
                ''
              );

              await refreshProjects();

              projectWorkspace = {
                id: response.project.id,
                name: response.project.name,
                relativePath: undefined,
                repositoryId: response.project.repositoryId,
                localPath: gitRoot,
                createdAt: response.project?.createdAt
              };
            } else {
              throw new Error(response.error || 'Failed to create project');
            }
          }

          config = {
            source: { from: 'local' },
            machine: machineConfig,
            provider: defaultAgentProvider || 'claude-code'
          };
        } else if (selectedOrigin.type === 'repository') {
          const existing = projectWorkspaces.find(p =>
            p.repositoryId && p.repositoryId === `repo_${selectedOrigin.repository.id}`
          );

          if (existing) {
            projectWorkspace = existing;
          } else {
            projectWorkspace = await projectService.createProjectFromGithub(selectedOrigin.repository);
            if (!projectWorkspace) {
              throw new Error('Failed to create project from GitHub');
            }
          }

          config = {
            source: { from: 'branch', branch: selectedOrigin.branch },
            machine: machineConfig,
            provider: defaultAgentProvider || 'claude-code'
          };
        } else {
          // cloneUrl
          const existing = projectWorkspaces.find(p => p.cloneUrl === selectedOrigin.url);

          if (existing) {
            projectWorkspace = existing;
          } else {
            projectWorkspace = await projectService.createProjectFromCloneUrl(selectedOrigin.url, selectedOrigin.name);
          }

          config = {
            source: { from: 'clone-url', url: selectedOrigin.url, branch: selectedOrigin.branch },
            machine: machineConfig,
            provider: defaultAgentProvider || 'claude-code'
          };
        }
      }

      if (!projectWorkspace) {
        throw new Error('Failed to create or find project');
      }

      // Create agent and send prompt
      const promptToSend = prompt.trim();

      await agentCreation.createAgent(
        {
          projectId: projectWorkspace.id,
          projectWorkspace,
          config
        },
        async (agent) => {
          const agentId = agent.id;
          onProjectWorkspaceSelected(projectWorkspace!, agentId);

          if (promptToSend) {
            try {
              const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/prompt`, {
                method: 'POST',
                body: JSON.stringify({
                  prompt: promptToSend,
                  mentions: []
                })
              });

              if (!response.ok) {
                console.error(`[QuickLaunch] Failed to send prompt: ${response.status}`);
              }
            } catch (error) {
              console.error('[QuickLaunch] Error sending prompt:', error);
            }
          }
        }
      );
    } catch (error) {
      console.error('Failed to start agent:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start agent',
        variant: 'destructive'
      });
    }
  };

  // Display for the trigger button
  const targetDisplay = launchTarget ? getLaunchTargetDisplay(launchTarget) : null;

  return (
    <div className="h-full w-full flex flex-col gap-3">
      <div className="text-lg mb-2">Agent Quick Launch</div>

      {/* Project / Origin Selector */}
      <div className="flex flex-col gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="default"
              wFull
              className="justify-between px-3"
            >
              {targetDisplay ? (
                <div className="h-4 w-4">
                  {targetDisplay.icon}
                </div>
              ) : (
                <div className="h-4 w-4">
                  <CodeFolder className='max-h-full max-w-full text-inherit' />
                </div>
              )}
              <div className="truncate flex-1 text-left md:w-[14ch]">
                {targetDisplay?.text || 'Pick a project'}
              </div>
              <ChevronDown className="h-3 w-3 ml-2 flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-[280px] p-2 border-(length:--border-width) border-muted/30 bg-background"
            align="start"
            side="bottom"
          >
            {/* Recent Projects */}
            {recentProjects.length > 0 && (
              <>
                <div className="text-xs font-semibold text-muted-foreground mb-1 px-1">
                  Recent Projects
                </div>
                <div className="flex flex-col gap-0.5 max-h-[250px] overflow-y-auto">
                  {recentProjects.map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      variant="transparent"
                      hoverVariant="default"
                      className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                      onClick={() => selectProject(project)}
                    >
                      <div className="h-3.5 w-3.5 flex-shrink-0">
                        {getProjectIcon(project)}
                      </div>
                      <span className="flex-1 truncate text-sm">{project.name}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuSeparator />
              </>
            )}

            {/* New Project from Repository */}
            <DropdownMenuItem
              variant="transparent"
              hoverVariant="default"
              className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
              onClick={() => setOriginDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="text-sm">New project from repository...</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Prompt Input */}
      <div className="relative h-fit rounded-lg bg-background-darker mb-4">
        <div className="pt-3 pb-1.5 px-3 h-fit min-h-[13ch] max-h-[17ch] xl:max-h-[30ch] overflow-y-auto">
          <textarea
            ref={textareaRef}
            value={prompt}
            spellCheck={false}
            onChange={(e) => {
              const newValue = e.target.value;
              if (prompt.length === 0 && newValue.length > 0) {
                posthog.capture('quick_launch_prompt_started');
              }
              setPrompt(newValue);
            }}
            placeholder="What do you want the Agent to do?"
            className="min-h-[2ch] w-full bg-transparent border-none outline-none resize-none text-base placeholder:text-muted-foreground/50"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                posthog.capture('quick_launch_prompt_submitted', {
                  prompt_length: prompt.length,
                  has_target: Boolean(launchTarget),
                  target_type: launchTarget?.type
                });
                handleStartAgent();
              }
            }}
          />
        </div>
      </div>

      {/* Machine and Create Agent Button Row */}
      <div className="flex flex-col gap-2 w-full">
        <div className="flex items-center w-full justify-between gap-2">
          {customMachines.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="transparent"
                  size='sm'
                  className="flex justify-between flex-1 px-1 text-xs"
                >
                  <div className="flex flex-col flex-1 items-start gap-0.5">
                    <span>Work from: {
                      machineSource === 'custom'
                        ? customMachines.find(m => m.id === selectedCustomMachineId)?.name || 'Custom Machine'
                        : MACHINE_SPECS[0].label
                    }</span>
                  </div>
                  <ChevronDown className="h-4 w-4 transition-transform" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                className="w-fit p-3 border-(length:--border-width) border-muted/30 bg-background"
                align="start"
                side="bottom"
              >
                {/* Default cloud VPS */}
                <div className="mb-3 last:mb-0">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 px-1">{MACHINE_SPECS[0].os}</div>
                  <Button
                    variant="default"
                    onClick={() => {
                      posthog.capture('machine_type_selected', {
                        machine_type: MACHINE_SPECS[0].type,
                        os: MACHINE_SPECS[0].os,
                        source: 'quick_launch'
                      });
                      setMachineSource('hetzner');
                      setSelectedMachine(MACHINE_SPECS[0].type);
                      setSelectedCustomMachineId(null);
                    }}
                    className='flex flex-col items-start justify-start gap-0.5 w-[23ch] h-[9ch] overflow-hidden'
                  >
                    <div>{MACHINE_SPECS[0].label}</div>
                    <div className="text-xs font-mono text-muted-foreground wrap-anywhere text-wrap text-left max-w-full">{MACHINE_SPECS[0].specs}</div>
                  </Button>
                </div>

                {/* Custom machines section */}
                <div className="mb-3 last:mb-0 border-t border-muted/30 pt-3 mt-1">
                  <div className="text-xs font-semibold text-muted-foreground mb-2 px-1">
                    Your Machines
                  </div>
                  <div className="flex flex-col gap-1">
                    {customMachines.map((machine) => {
                      const isAvailable = machine.status === 'online';
                      return (
                        <Button
                          key={machine.id}
                          variant="default"
                          onClick={() => {
                            if (isAvailable) {
                              posthog.capture('custom_machine_selected', {
                                machine_id: machine.id,
                                source: 'quick_launch'
                              });
                              setMachineSource('custom');
                              setSelectedCustomMachineId(machine.id);
                            }
                          }}
                          disabled={!isAvailable}
                          className='flex flex-col items-start justify-start gap-0.5 w-full h-[9ch] overflow-hidden'
                        >
                          <div>
                            {machine.name}
                            {!isAvailable && <span className='text-xs text-muted-foreground'> ({machine.status})</span>}
                          </div>
                          <div className="text-xs font-mono text-muted-foreground wrap-anywhere text-wrap text-left max-w-full">
                            {machine.ipv4}
                          </div>
                          <div className="text-xs font-mono text-muted-foreground wrap-anywhere text-wrap text-left max-w-full">
                            {machine.cpuCount} CPU, {machine.memoryGB}GB RAM
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex flex-1 items-center px-1 text-xs text-muted-foreground">
              Work from: {MACHINE_SPECS[0].label}
            </div>
          )}

          <Button
            variant="accent"
            onClick={handleStartAgent}
            disabled={!isValid || agentCreation.isCreating}
            className="flex-1"
          >
            {agentCreation.isCreating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5 mr-2" />
                Create Agent
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Tutorial Section */}
      <div className='flex flex-col gap-2 mt-4'>
        <button
          onClick={() => {
            const newState = !tutorialExpanded;
            posthog.capture(newState ? 'tutorial_expanded' : 'tutorial_collapsed', {
              source: 'quick_launch'
            });
            setTutorialExpanded(newState);
          }}
          className="flex items-center gap-2 text-left hover:text-accent transition-opacity"
        >
          {tutorialExpanded ? (
            <ChevronDown className="h-4 w-4 " />
          ) : (
            <ChevronRight className="h-4 w-4 " />
          )}
          <span className="text-base">Tutorial</span>
        </button>

        {tutorialExpanded && (
          <div className='flex flex-col text-xs pl-6'>
            <div className="flex gap-2">
              <span className='text-accent w-5'>1.</span>
              <span> Describe your task with as much detail as possible.</span>
            </div>
            <div className="flex gap-2">
              <span className='text-accent w-5'>2.</span>
              <span> Choose the project it should happen on, either from recent projects or a new repository</span>
            </div>
            <div className="flex gap-2">
              <span className='text-accent w-5'>3.</span>
              <span> The agent will get a copy of the files & work on its own computer</span>
            </div>
            <div className="flex gap-2 mt-2">
              <span className='text-accent w-5 mr-0.5'>🎉</span>
              <span> At any point you can: stop the agent, send follow-ups, revert its work, share it with a colleague, fork it, sync locally with its code, connect via SSH to its machine, push its work on GitHub, and if a server runs on its machine you can forward it locally or host it publicly.</span>
            </div>
          </div>
        )}
      </div>

      <ProjectOriginDialog
        open={originDialogOpen}
        onOpenChange={setOriginDialogOpen}
        onSelectOrigin={selectOrigin}
        onNavigateToPermissions={() => {
          setOriginDialogOpen(false);
          onNavigateToPermissions();
        }}
        mode="agent"
      />
    </div>
  );
}
