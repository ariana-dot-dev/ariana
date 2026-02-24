import { useState, useEffect, useMemo } from 'react';
import { ArrowRight, Loader2, Settings, ChevronDown, HelpCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectGroupRoot, SelectGroupOption } from '@/components/ui/select-group';
import { BranchSelector } from '@/components/BranchSelector';
import { EnvironmentPicker } from '@/components/EnvironmentPicker';
import type { AgentConfig } from '@/types/AgentConfig';
import { ProjectWorkspace, useAppStore } from '@/stores/useAppStore';
import { MACHINE_SPECS, type MachineType, type MachineSource } from '@/bindings/types';
import { useProviderStore, isSubscriptionConnected, isApiKeyConnected } from '@/stores/useProviderStore';
import { useRepositoryAccess } from '@/hooks/useRepositoryAccess';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { posthog } from '@/lib/posthog';
import { PersonalEnvironment } from '@/hooks/useEnvironments';
import { machinesService, type CustomMachine } from '@/services/machines.service';
import { MachineSpecsDialog } from '@/components/shared/MachineSpecsDialog';
import { usePollingTrackerStore } from '@/stores/usePollingTrackerStore';

interface AgentConfigDropdownProps {
  trigger: React.ReactNode;
  projectWorkspace: ProjectWorkspace;
  onConfirm: (config: AgentConfig) => void;
  onProjectMerged?: (newProjectId: string, repositoryId?: string) => void;
  environments?: PersonalEnvironment[];
}

type SourceOption = 'code' | 'branch' | 'clone-url';

export function AgentConfigDropdown({ trigger, projectWorkspace, onConfirm, onProjectMerged, environments = [] }: AgentConfigDropdownProps) {
  const getLastAgentConfig = useAppStore((state) => state.getLastAgentConfig);
  const setLastAgentConfig = useAppStore((state) => state.setLastAgentConfig);
  const defaultAgentProvider = useAppStore((state) => state.defaultAgentProvider);
  const user = useAppStore((state) => state.user);
  const lastAgentConfig = getLastAgentConfig(projectWorkspace.id);

  // Get provider status from store
  const config = useProviderStore(state => state.config);
  const providerReady = useMemo(() => isSubscriptionConnected(config) || isApiKeyConnected(config), [config]);

  const [open, setOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceOption>(
    lastAgentConfig?.source.from === 'branch' ? 'branch'
    : lastAgentConfig?.source.from === 'clone-url' ? 'clone-url'
    : 'code'
  );
  const [selectedBranch, setSelectedBranch] = useState<string>(
    lastAgentConfig?.source.from === 'branch' ? lastAgentConfig.source.branch
    : lastAgentConfig?.source.from === 'clone-url' ? lastAgentConfig.source.branch
    : 'main'
  );
  const [selectedMachine, setSelectedMachine] = useState<MachineType>(
    lastAgentConfig?.machine.machine || 'cx43'
  );
  const [machineSource, setMachineSource] = useState<MachineSource>(
    lastAgentConfig?.machine.machineSource || 'hetzner'
  );
  const [customMachines, setCustomMachines] = useState<CustomMachine[]>([]);
  const [selectedCustomMachineId, setSelectedCustomMachineId] = useState<string | null>(
    lastAgentConfig?.machine.customMachineId || null
  );

  // Initialize with last used environment, or null
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(
    lastAgentConfig?.environmentId || null
  );

  const [permissionsLoading, setPermissionsLoading] = useState(false);

  // Use the new repository access hook
  const { access, repositoryFullName, isLoading: isLoadingGithubAccess, openUpdatePermissionsLinkAndAwaitAccess } = useRepositoryAccess(projectWorkspace.repositoryId);

  const hasLocalPath = !!projectWorkspace.localPath;
  const hasRepositoryId = !!projectWorkspace.repositoryId;
  const hasCloneUrl = !!projectWorkspace.cloneUrl;

  // Determine if configuration is valid
  const isValid = useMemo(() => {
    // if (!providerReady) return false;

    if (selectedSource === 'code') {
      // For local project files, only require localPath - no GitHub access needed
      return hasLocalPath;
    }

    if (selectedSource === 'branch') {
      // For GitHub branch, require both repositoryId and a selected branch
      return hasRepositoryId && !!selectedBranch;
    }

    if (selectedSource === 'clone-url') {
      // For clone URL, require cloneUrl and a selected branch
      return hasCloneUrl && !!selectedBranch;
    }

    return false;
  }, [providerReady, selectedSource, hasLocalPath, hasRepositoryId, hasCloneUrl, selectedBranch]);

  // Polling tracker for debug overlay
  const registerPoll = usePollingTrackerStore((state) => state.registerPoll);
  const unregisterPoll = usePollingTrackerStore((state) => state.unregisterPoll);
  const recordPollAttempt = usePollingTrackerStore((state) => state.recordPollAttempt);

  // Fetch and poll custom machines health when dropdown opens
  useEffect(() => {
    if (!open) return;

    const POLLING_KEY = 'agent-config-machines-health';
    registerPoll(POLLING_KEY, 'AgentConfig: Machines Health');

    const checkMachinesHealth = async () => {
      try {
        recordPollAttempt(POLLING_KEY);
        const response = await machinesService.checkMachinesHealth();
        setCustomMachines(response.machines);
      } catch (error) {
        console.error('Failed to check machines health:', error);
      }
    };

    // Initial fetch
    checkMachinesHealth();

    // Poll every 5 seconds while open
    const healthCheckInterval = setInterval(checkMachinesHealth, 5000);

    return () => {
      clearInterval(healthCheckInterval);
      unregisterPoll(POLLING_KEY);
    };
  }, [open, registerPoll, unregisterPoll, recordPollAttempt]);

  // Set default selection when dropdown first opens
  useEffect(() => {
    if (!open) {
      return;
    }

    posthog.capture('agent_config_dropdown_opened', {
      project_id: projectWorkspace.id,
      has_local_path: hasLocalPath,
      has_repository_id: hasRepositoryId,
      has_clone_url: hasCloneUrl
    });

    // Re-fetch saved config for current project (useState initializers don't re-run on prop changes)
    const savedConfig = getLastAgentConfig(projectWorkspace.id);

    // Reset source selection from saved config
    if (savedConfig?.source.from === 'local') {
      setSelectedSource('code');
    } else if (savedConfig?.source.from === 'branch') {
      setSelectedSource('branch');
    } else if (savedConfig?.source.from === 'clone-url') {
      setSelectedSource('clone-url');
    } else if (hasLocalPath) {
      setSelectedSource('code');
    } else if (hasRepositoryId) {
      setSelectedSource('branch');
    } else if (hasCloneUrl) {
      setSelectedSource('clone-url');
    }

    // Reset branch selection from saved config
    setSelectedBranch(
      savedConfig?.source.from === 'branch' ? savedConfig.source.branch
      : savedConfig?.source.from === 'clone-url' ? savedConfig.source.branch
      : 'main'
    );

    // Reset machine selection from saved config
    setSelectedMachine(savedConfig?.machine.machine ?? 'cx43');
    setMachineSource(savedConfig?.machine.machineSource ?? 'hetzner');
    setSelectedCustomMachineId(savedConfig?.machine.customMachineId ?? null);

    // Reset environment selection from saved config
    const defaultEnv = environments.find(env => env.isDefault);
    setSelectedEnvironmentId(savedConfig?.environmentId ?? defaultEnv?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectWorkspace.id]);

  const handleChangePermissions = () => {
    setPermissionsLoading(true);

    openUpdatePermissionsLinkAndAwaitAccess(
      'read',
      (result) => {
        setPermissionsLoading(false);

        // Handle project merge if needed
        if (result.merged && result.newProjectId && result.newProjectId !== projectWorkspace.id) {
          console.log(`Project ${projectWorkspace.id} merged into ${result.newProjectId}`);
          projectWorkspace.id = result.newProjectId;

          if (onProjectMerged && result.repositoryId) {
            onProjectMerged(result.newProjectId, result.repositoryId);
          }
        }

        // Update repositoryId if now linked
        if (result.repositoryId) {
          projectWorkspace.repositoryId = result.repositoryId;
        }

        // Set default branch
        setSelectedBranch('main');
      },
      60, // 60 second timeout
      () => {
        setPermissionsLoading(false);
        console.error('Timeout waiting for GitHub access');
      }
    );
  };

  const handleConfirm = () => {
    if (!isValid) return;

    const config: AgentConfig = {
      source: selectedSource === 'code'
        ? { from: 'local' }
        : selectedSource === 'branch'
        ? { from: 'branch', branch: selectedBranch }
        : { from: 'clone-url', url: projectWorkspace.cloneUrl!, branch: selectedBranch },
      machine: {
        machine: selectedMachine,
        machineSource,
        customMachineId: machineSource === 'custom' ? selectedCustomMachineId || undefined : undefined
      },
      provider: defaultAgentProvider || 'claude-code',
      environmentId: selectedEnvironmentId
    };

    posthog.capture('agent_creation_confirmed', {
      project_id: projectWorkspace.id,
      source_type: selectedSource,
      machine_type: selectedMachine,
      branch: selectedSource !== 'code' ? selectedBranch : undefined,
      provider: config.provider,
      environment_id: selectedEnvironmentId
    });

    setLastAgentConfig(projectWorkspace.id, config);
    setOpen(false);
    onConfirm(config);
  };

  function cropLeft(str: string, length: number) {
    return str.length > length ? '...' + str.slice(str.length - length + 2, str.length) : str;
  }

  const branchOptionDisabled = !hasRepositoryId && !repositoryFullName;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {trigger}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="flex w-[38ch] h-fit p-2 bg-background border-(length:--border-width) border-muted/30"
        align="center"
      >
        <div className="flex flex-col justify-between px-2 pt-1.5 pb-2 w-full h-full">
          <div className="flex flex-col gap-4 w-full">
            {/* Source Selection */}
            <div className="flex flex-col gap-2">
              <div className="text-sm font-medium">Agent will work based on...</div>
              <SelectGroupRoot inverted rounded={false} value={selectedSource} onValueChange={(v) => {
                posthog.capture('agent_source_selected', {
                  project_id: projectWorkspace.id,
                  source_type: v,
                  previous_source: selectedSource
                });
                setSelectedSource(v as SourceOption);
              }}>
                {hasLocalPath && (
                  <SelectGroupOption value="code">
                    <div className="flex flex-col gap-1">
                      <div className="text-sm">Local project files</div>
                      <code className="text-xs text-muted-foreground/50 font-mono">{cropLeft(projectWorkspace.localPath ?? '/home/example/my-code', 28)}</code>
                    </div>
                  </SelectGroupOption>
                )}

                {(hasRepositoryId || isLoadingGithubAccess || repositoryFullName) && (
                  <SelectGroupOption value="branch" disabled={branchOptionDisabled}>
                    <div className="flex flex-col gap-1 w-full">
                      <div className="text-sm">GitHub branch</div>
                      {hasRepositoryId ? (
                        <BranchSelector
                          disabled={selectedSource !== 'branch'}
                          currentBranch={selectedBranch}
                          onBranchSelect={(branch) => {
                            posthog.capture('agent_branch_selected', {
                              project_id: projectWorkspace.id,
                              branch: branch,
                              repository_id: projectWorkspace.repositoryId
                            });
                            setSelectedBranch(branch);
                          }}
                          repositoryId={projectWorkspace.repositoryId!}
                          className="w-fit max-w-full"
                        />
                      ) : isLoadingGithubAccess ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Checking GitHub repository...
                        </div>
                      ) : repositoryFullName && access === 'none' ? (
                        <div className="flex flex-col items-start gap-2 dark:text-amber-200 text-amber-600">
                          <div className="text-xs text-left">
                            ⚠️ You need to allow Ariana to access <span className='font-mono font-semibold'>{repositoryFullName}</span>
                          </div>
                          <Button
                            variant={selectedSource === 'branch' ? 'caution' : 'muted'}
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleChangePermissions();
                            }}
                            disabled={permissionsLoading}
                            className="flex items-center gap-2"
                          >
                            {permissionsLoading ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading...
                              </>
                            ) : (
                              <>
                                <Settings className="h-3 w-3" />
                                Review GitHub Permissions
                              </>
                            )}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </SelectGroupOption>
                )}

                {/* Clone URL option - for projects created from clone URL */}
                {hasCloneUrl && (
                  <SelectGroupOption value="clone-url">
                    <div className="flex flex-col gap-3 w-full">
                      <div className="text-sm">Clone from URL</div>
                      <code className="text-xs text-muted-foreground/50 font-mono break-all">
                        {cropLeft(projectWorkspace.cloneUrl!, 35)}
                      </code>
                      <Input
                        placeholder="Branch name (e.g., main)"
                        value={selectedBranch}
                        onChange={(e) => setSelectedBranch(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={selectedSource !== 'clone-url'}
                        className="w-full"
                      />
                    </div>
                  </SelectGroupOption>
                )}
              </SelectGroupRoot>
              <div className='text-xs px-1 text-muted-foreground'>
                {selectedSource === 'branch'
                  ? `Agent will clone the ${selectedBranch} branch on his VM and create a new branch for his work.`
                  : selectedSource === 'clone-url'
                  ? `Agent will clone the ${selectedBranch} branch from the repository and create a new branch for his work.`
                  : `Agent will copy relevant parts of ${projectWorkspace.localPath} to his VM and create a new branch for his work.`
                }
              </div>
            </div>

            {/* Agent's Computer Documentation */}
            <div className="w-full">
              <MachineSpecsDialog
                trigger={
                  <Button variant="transparent" size="sm" className="h-7 gap-1.5 text-xs w-full justify-start">
                    <HelpCircle className="h-3.5 w-3.5" />
                    Agent's Computer Documentation
                  </Button>
                }
              />
            </div>

            <div className="flex gap-6 flex-wrap justify-start">
              {/* Machine Type */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  Machine
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs text-xs">
                          Agents work from their own VM with Docker and most programming languages pre-installed.
                          You will get SSH access, ability to forward its network locally, and ability to open ports to the internet for hosting.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {customMachines.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild className='w-fit'>
                      <Button
                        variant="default"
                        className="flex justify-between"
                      >
                        <div className="flex flex-col items-start gap-0.5">
                          <span>{
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
                            posthog.capture('agent_machine_type_selected', {
                              project_id: projectWorkspace.id,
                              machine_type: MACHINE_SPECS[0].type,
                              os: MACHINE_SPECS[0].os,
                              source: 'agent_config_dropdown'
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
                                      project_id: projectWorkspace.id,
                                      machine_id: machine.id,
                                      source: 'agent_config_dropdown'
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
                  <div className="flex flex-col gap-0.5 px-1">
                    <span className="text-sm">{MACHINE_SPECS[0].label}</span>
                    <span className="text-xs font-mono text-muted-foreground">{MACHINE_SPECS[0].specs}</span>
                  </div>
                )}
              </div>

              {/* Environment Selection */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  Environment
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs text-xs">
                          Select an environment to pre-configure the agent with environment variables and secret files.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                {environments.length > 0 ? (
                  <EnvironmentPicker
                    variant="in-form"
                    currentEnvironmentId={selectedEnvironmentId}
                    environments={environments}
                    onEnvironmentSelect={(environmentId) => {
                      posthog.capture('agent_environment_selected', {
                        project_id: projectWorkspace.id,
                        environment_id: environmentId,
                        source: 'agent_config_dropdown'
                      });
                      setSelectedEnvironmentId(environmentId);
                    }}
                    currentUserId={user?.id}
                  />
                ) : (
                  <div className='text-xs px-1 text-muted-foreground'>
                    No environments available. Create one in the Environments tab.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Confirm button */}
          <div className="flex justify-end mt-6">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <Button
                    variant="accent"
                    onClick={handleConfirm}
                    disabled={!isValid}
                  >
                    Create Agent
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              </TooltipTrigger>
              {!isValid && (
                <TooltipContent>
                  {!providerReady
                    ? 'Please configure an API key or OAuth token first'
                    : selectedSource === 'code' && !hasLocalPath
                    ? 'Local path not available'
                    : selectedSource === 'branch' && !hasRepositoryId
                    ? 'GitHub repository access required'
                    : selectedSource === 'branch' && !selectedBranch
                    ? 'Please select a branch'
                    : selectedSource === 'clone-url' && !hasCloneUrl
                    ? 'Clone URL not available'
                    : selectedSource === 'clone-url' && !selectedBranch
                    ? 'Please enter a branch name'
                    : ''}
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
