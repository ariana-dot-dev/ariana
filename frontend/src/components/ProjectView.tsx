import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Users,
  AlertCircle,
  GitPullRequestClosed,
  Settings,
  RefreshCw,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  UserX,
  ExternalLink,
  MoreHorizontal
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProjectViewContent } from './ProjectViewContent';
import { CustomHeader } from './CustomHeader';
import { Project, ProjectRole } from '@/bindings/types';

import { useState, useEffect, useCallback } from 'react';
import { ProjectWorkspace, useAppStore } from '@/stores/useAppStore';
import { routerService } from '@/services/router.service';
import { useOS } from '@/contexts/OSContext';
import { cn } from '@/lib/utils';
import { checkAndLinkRepository } from '@/services/project-link.service';
import type { UseAgentCreationReturn } from '@/hooks/useAgentCreation';
import { useProjectCollaborators } from '@/stores/useProjectCollaboratorsStore';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { useGitHubPermissions } from '@/hooks/useGitHubPermissions';
import { projectService } from '@/services/project.service';
import { useToast } from '@/hooks/use-toast';
import { useProjects } from '@/hooks/useProjects';
import { GradientPattern } from '@/components/ui/gradient-pattern';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import Home from './ui/icons/home';
import Access from './ui/icons/Access';
import Refresh from './ui/icons/Refresh';
import GitDisabled from './ui/icons/GitDisabled';
import { OpenInBrowserDialog } from './OpenInBrowserDialog';
import LinkSquare from './ui/icons/LinkSquare';
import { PermissionsDropdownContent } from './PermissionsDropdownContent';
import Eye from './ui/icons/Eye';
import { OpenInIDEButton } from './OpenInIDEButton';
import { useIDEIntegration } from '@/hooks/useIDEIntegration';

interface ProjectViewProps {
  projectWorkspace: ProjectWorkspace;
  onBack: () => void;
  initialAgentId?: string;
  agentCreation: UseAgentCreationReturn;
  onProjectWorkspaceSelected?: (projectWorkspace: ProjectWorkspace) => void;
}

const COLORS = [
  '#14B8A6', // Teal
  '#993bc2', // Purple
  '#FF6B6B', // Red
  '#c2862c', // Amber
  '#2564c2', // Blue
  '#29c993', // Emerald
  '#696d84', // Showers
];

// Simple hash function to convert string ID to number
const hashString = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};

interface HeaderItemsProps {
  shouldShowLinkingWarning: boolean;
  openChangePermissions: () => void;
  handleRefreshPermissions: () => Promise<void>;
  isRefreshingPermissions: boolean;
  currentUserRole: ProjectRole | null;
  currentUserCollaborator: any;
  currentProjectWorkspace: ProjectWorkspace;
  currentProjectName: string | null;
  allCollaborators: any[];
  isCollaboratorsOpen: boolean;
  setIsCollaboratorsOpen: (open: boolean) => void;
  handleRemoveCollaborator: (userId: string) => Promise<void>;
  removingUserId: string | null;
  isBrowser: boolean;
  setIsOpenInBrowserDialogOpen: (open: boolean) => void;
  projectWorkspace: ProjectWorkspace;
  className?: string;
  inDropdown?: boolean;
  currentUserId?: string;
}

function HeaderItems({
  shouldShowLinkingWarning,
  openChangePermissions,
  handleRefreshPermissions,
  isRefreshingPermissions,
  currentUserRole,
  currentUserCollaborator,
  currentProjectWorkspace,
  currentProjectName,
  allCollaborators,
  isCollaboratorsOpen,
  setIsCollaboratorsOpen,
  handleRemoveCollaborator,
  removingUserId,
  isBrowser,
  setIsOpenInBrowserDialogOpen,
  projectWorkspace,
  className,
  inDropdown = false,
  currentUserId
}: HeaderItemsProps) {
  // IDE integration - encapsulated in hook
  const { openInIDE } = useIDEIntegration(projectWorkspace.id);
  return (
    <>
      {/* Repository Not Linked Warning */}
      {shouldShowLinkingWarning && (
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild className={cn(!inDropdown && 'pr-4')}>
              <div className={cn(
                "flex items-center gap-1.5 text-muted-foreground/60 cursor-help",
                inDropdown ? "w-fit" : "px-4"
              )}>
                  <span className="flex h-4 w-4 pr-[1px] items-center justify-center rounded-full bg-muted/50 text-[9px] font-medium text-muted-foreground">
                    !
                  </span>
                <div className="h-4 w-4"><GitDisabled className="max-w-full max-h-full text-inherit" /></div>
                <span className="text-xs font-medium">No GitHub Access</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="p-3">
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Grant Ariana access to this private repository to enable collaborative features and agent commit pushes.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    hoverVariant="background"
                    size="sm"
                    onClick={openChangePermissions}
                    className="flex items-center gap-1.5"
                  >
                    <Access className="!min-h-3.5 !min-w-3.5 text-inherit" />
                      Change Permissions
                    </Button>
                    <Button
                      variant="default"
                      hoverVariant="background"
                      size="sm"
                      onClick={handleRefreshPermissions}
                      disabled={isRefreshingPermissions}
                      className="flex items-center gap-1.5"
                    >
                      <Refresh className={`!min-h-3.5 !min-w-3.5 text-inherit ${isRefreshingPermissions ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

        {currentUserRole && allCollaborators.length > 1 && (
      <div className={cn("flex items-center gap-1", inDropdown && "w-fit")}>
        {/* Team Section */}
          <DropdownMenu open={isCollaboratorsOpen} onOpenChange={setIsCollaboratorsOpen}>
            <DropdownMenuTrigger asChild>
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-md hover:bg-background text-muted-foreground px-2 text-xs outline-none whitespace-nowrap transition-all h-5"
              >
                <span>Team & Visitors {allCollaborators.length > 1 && `(${allCollaborators.length})`}</span>
                <ChevronDown className={cn("h-3 w-3 transition-transform", isCollaboratorsOpen && "rotate-180")} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-fit p-3 border-(length:--border-width) border-muted/40 bg-background"
              align="start"
            >
              <div className="flex flex-wrap gap-2 max-w-[300px]">
                {allCollaborators.map((collaborator) => {
                  const isCurrentUser = collaborator.userId === currentUserId;
                  return (
                    <DropdownMenu key={collaborator.userId}>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={cn(
                            "relative h-8 w-8 rounded-full flex items-center justify-center overflow-hidden border-(length:--border-width) hover:border-accent/50 border-transparent bg-background-darker hover:saturate-100 saturate-50 transition-all cursor-pointer",
                            isCurrentUser && "ring-2 ring-accent/30"
                          )}
                        >
                          {collaborator.profile?.image ? (
                            <img
                              src={collaborator.profile.image}
                              alt={collaborator.profile.name}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-4 w-4">
                              <Eye className="max-h-full max-w-full text-muted-foreground" />
                            </div>
                          )}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="bottom" className="text-xs max-w-[50ch] p-4 border-(length:--border-width) border-muted/40 bg-background z-[100]">
                        <PermissionsDropdownContent
                          name={isCurrentUser ? 'You' : (collaborator.profile?.name || 'Anonymous user')}
                          role={collaborator.role}
                          isCurrentUser={isCurrentUser}
                          viewerIsAdmin={currentUserRole === ProjectRole.ADMIN}
                          onKick={!isCurrentUser ? () => handleRemoveCollaborator(collaborator.userId) : undefined}
                          isRemoving={removingUserId === collaborator.userId}
                          hasRepository={!!currentProjectWorkspace.repositoryId}
                          projectName={currentProjectName}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
      </div>
        )}

      {/* Open in Browser Button */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild className={cn('w-fit h-5')}>
            <div>
              <button
                onClick={() => setIsOpenInBrowserDialogOpen(true)}
                className={cn(
                  "inline-flex w-full items-center justify-center gap-2 rounded-md hover:bg-background text-muted-foreground px-0.5 text-xs outline-none whitespace-nowrap transition-all h-5"
                )}
              >
                <div className="h-4 w-4"><LinkSquare className='max-h-full max-w-full text-inherit'/></div>
                {/* <span>Open {isBrowser ? '' : 'in browser /'} on mobile</span> */}
              </button>
            </div>
          </TooltipTrigger>
        </Tooltip>
      </TooltipProvider>

      {projectWorkspace.localPath && (
        <OpenInIDEButton
          projectId={projectWorkspace.id}
          size="small"
          inDropdown={inDropdown}
          onOpen={(ideId) => openInIDE(projectWorkspace.localPath!, ideId)}
        />
      )}
    </>
  );
}

export function ProjectView({ projectWorkspace, onBack, initialAgentId, agentCreation, onProjectWorkspaceSelected }: ProjectViewProps) {
  const user = useAppStore(state => state.user);
  const { isMacOS } = useOS();
  const [currentProjectWorkspace, setCurrentProjectWorkspace] = useState(projectWorkspace);
  const updateProjectId = useAppStore.getState().updateProjectId;
  const backgroundMode = useAppStore(state => state.backgroundMode);
  const isBrowser = useIsBrowser();
  const [isRefreshingPermissions, setIsRefreshingPermissions] = useState(false);
  const [isCollaboratorsOpen, setIsCollaboratorsOpen] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const { toast } = useToast();
  const { projects } = useProjects();
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [currentProjectName, setCurrentProjectName] = useState<string | null>(null);
  const [isOpenInBrowserDialogOpen, setIsOpenInBrowserDialogOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);

  // Project tabs
  const openProjectIds = useAppStore(state => state.openProjectIds);
  const closeProjectTab = useAppStore(state => state.closeProjectTab);

  // GitHub permissions hook (don't auto-fetch, we'll fetch on demand)
  const {
    openChangePermissions,
    refresh: refreshPermissions
  } = useGitHubPermissions({ autoFetch: false });

  const collaborators = useProjectCollaborators(currentProjectWorkspace.id);

  // Get current user's role and info
  const currentUserCollaborator = collaborators.find(c => c.userId === user?.id);
  const currentUserRole = currentUserCollaborator?.role || null;

  // Get all collaborators including current user for the Team dropdown
  const allCollaborators = collaborators;

  // Check if cloneUrl is a GitHub URL
  const isGitHubCloneUrl = (url?: string): boolean => {
    if (!url) return false;
    return /^https:\/\/github\.com\//.test(url);
  };

  // Determine if we should show the GitHub linking warning
  // Don't show for non-GitHub clone URLs (GitLab, Bitbucket, etc.) since we can't link them
  const shouldShowLinkingWarning = !isBrowser && !currentProjectWorkspace.repositoryId &&
    (!currentProjectWorkspace.cloneUrl || isGitHubCloneUrl(currentProjectWorkspace.cloneUrl));

  useEffect(() => {
    const project = projects.find(p => p.id === currentProjectWorkspace.id);
    if (!project) return;
    if (!project.repositoryId) return;

    // Only fetch if we don't have a name yet
    if (currentProjectName) return;

    const fetchRepositoryName = async () => {
      try {
        // console.log('Fetching repository name for project:', project.repositoryId);
        const response = await authenticatedFetch(`${API_URL}/api/repositories/${project.repositoryId}`);
        if (response.ok) {
          const data = await response.json();
          setCurrentProjectName(data.repository?.name || null);
        }
      } catch (error) {
        console.error('Failed to fetch repository fullName:', error);
      }
    };

    // Set initial name from project
    setCurrentProjectName(project?.name || currentProjectWorkspace.name);
    // Then fetch the full repository name
    fetchRepositoryName();
  }, [currentProjectWorkspace.id, projects, currentProjectName])

  // Check and link repository on project open
  useEffect(() => {
    const checkRepository = async () => {
      try {
        const result = await checkAndLinkRepository(
          currentProjectWorkspace.id,
          currentProjectWorkspace.localPath,
          currentProjectWorkspace.cloneUrl || undefined
        );

        if (result.success && result.accessGranted) {
          // Check if project was merged
          if (result.merged && result.projectId && result.projectId !== currentProjectWorkspace.id) {
            console.log(`Project ${currentProjectWorkspace.id} merged into ${result.projectId} - updating silently`);

            // Silently update project ID in memory
            setCurrentProjectWorkspace((prev: ProjectWorkspace) => ({
              ...prev,
              id: result.projectId!,
              repositoryId: result.repository?.id || prev.repositoryId
            }));

            // Update persisted state
            if (currentProjectWorkspace.localPath) {
              updateProjectId(currentProjectWorkspace.id, result.projectId, currentProjectWorkspace.localPath);
            }

            return;
          }

          // Update repositoryId if linked
          if (result.repository && !currentProjectWorkspace.repositoryId) {
            setCurrentProjectWorkspace((prev: ProjectWorkspace) => ({
              ...prev,
              repositoryId: result.repository!.id
            }));
          }
        }
      } catch (error) {
        console.error('Failed to check repository on project open:', error);
      }
    };

    checkRepository();
  }, [currentProjectWorkspace.id]);

  // Update current workspace when prop changes
  useEffect(() => {
    setCurrentProjectWorkspace(projectWorkspace);
    setCurrentProjectName(null); // Reset name when project changes
  }, [projectWorkspace.id]);

  const handleProjectMerged = (newProjectId: string, repositoryId?: string) => {
    console.log(`Project ${currentProjectWorkspace.id} merged into ${newProjectId} - updating silently`);

    // Silently update project ID in memory
    setCurrentProjectWorkspace((prev: ProjectWorkspace) => ({
      ...prev,
      id: newProjectId,
      repositoryId: repositoryId || prev.repositoryId
    }));

    // Update persisted state
    if (currentProjectWorkspace.localPath) {
      updateProjectId(currentProjectWorkspace.id, newProjectId, currentProjectWorkspace.localPath);
    }
  };

  const handleRefreshPermissions = async () => {
    setIsRefreshingPermissions(true);
    try {
      // 1. Refresh GitHub installations
      await refreshPermissions();

      // 2. Re-check and link repository (like on project open)
      const result = await checkAndLinkRepository(
        currentProjectWorkspace.id,
        currentProjectWorkspace.localPath,
        currentProjectWorkspace.cloneUrl || undefined
      );

      if (result.success && result.accessGranted) {
        // Check if project was merged
        if (result.merged && result.projectId && result.projectId !== currentProjectWorkspace.id) {
          console.log(`Project ${currentProjectWorkspace.id} merged into ${result.projectId} - updating silently`);

          // Silently update project ID in memory
          setCurrentProjectWorkspace((prev: ProjectWorkspace) => ({
            ...prev,
            id: result.projectId!,
            repositoryId: result.repository?.id || prev.repositoryId
          }));

          // Update persisted state
          if (currentProjectWorkspace.localPath) {
            updateProjectId(currentProjectWorkspace.id, result.projectId, currentProjectWorkspace.localPath);
          }
        } else if (result.repository && !currentProjectWorkspace.repositoryId) {
          // Update repositoryId if linked
          setCurrentProjectWorkspace((prev: ProjectWorkspace) => ({
            ...prev,
            repositoryId: result.repository!.id
          }));
        }
      }
    } catch (error) {
      console.error('Failed to refresh permissions:', error);
    } finally {
      setIsRefreshingPermissions(false);
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    if (!userId) return;

    setRemovingUserId(userId);
    try {
      const result = await projectService.removeCollaborator(currentProjectWorkspace.id, userId);

      if (result.success) {
        toast({
          title: 'Collaborator removed',
          description: 'The collaborator has been removed from this project.',
        });
      } else {
        toast({
          title: 'Failed to remove collaborator',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to remove collaborator',
        variant: 'destructive',
      });
    } finally {
      setRemovingUserId(null);
    }
  };

  return (
    <div className={cn(
      "h-full flex flex-col px-1 pb-1 md:pl-2 md:pr-2 md:pb-2",
      backgroundMode?.type === 'image' && '[DELETED]backdrop-blur-[2px] bg-background-darker/70',
      backgroundMode?.type === 'pattern' && 'bg-background-darker/60'
    )}>
      {/* Main Header */}
      <CustomHeader/>
      
      {/* Repo Header */}
      <div className={cn(
        "w-fit flex gap-3 items-center z-20 pt-2 pb-2",
        (isMacOS && !isBrowser) ? ' ml-33' : 'ml-11 md:ml-12'
      )}>
        <div className="relative h-full w-fit max-w-[55vw] md:max-w-[80vw] z-20 rounded-lg box-content flex items-center flex-wrap gap-x-5 gap-y-1">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center m-0 justify-center hover:text-accent"
            >
              <ArrowLeft className="text-foreground h-4 w-4" />
            </button>

            {/* Mobile: project dropdown */}
            <div className="md:hidden">
              <DropdownMenu open={isProjectDropdownOpen} onOpenChange={setIsProjectDropdownOpen}>
                <DropdownMenuTrigger asChild className='m-0'>
                  <button className="flex items-center gap-1.5 text-sm font-medium hover:text-accent transition-colors">
                    {currentProjectName || currentProjectWorkspace.name}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isProjectDropdownOpen && "rotate-180")} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-fit min-w-[300px] max-w-[500px] p-3 border-(length:--border-width) border-muted/40 bg-background"
                  align="start"
                >
                  <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
                    <div className="text-xs text-muted-foreground px-2 pb-1">All projects:</div>
                    {[...projects].reverse().map((project) => {
                      const colorIndex = hashString(project.id) % COLORS.length;
                      const color = COLORS[colorIndex] || COLORS[0];

                      return (
                        <button
                          key={project.id}
                          onClick={() => {
                            if (onProjectWorkspaceSelected) {
                              onProjectWorkspaceSelected(project);
                              setIsProjectDropdownOpen(false);
                            }
                          }}
                          className={cn(
                            "flex items-center gap-3 px-2 py-1.5 text-left text-sm rounded hover:bg-background-darker transition-colors",
                            project.id === currentProjectWorkspace.id && "bg-muted/30"
                          )}
                        >
                          <GradientPattern className="w-7 h-7 rounded-md flex-shrink-0" baseColor={color} />
                          <span className="truncate">{project.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Desktop: inline project tabs */}
            <div className="hidden md:flex items-center gap-1">
              {openProjectIds.map((pid) => {
                const isCurrent = pid === currentProjectWorkspace.id;
                const pw = projects.find(p => p.id === pid);
                const name = isCurrent ? (currentProjectName || currentProjectWorkspace.name) : (pw?.name || 'Project');
                const colorIndex = hashString(pid) % COLORS.length;
                const color = COLORS[colorIndex] || COLORS[0];

                return (
                  <button
                    key={pid}
                    onClick={() => {
                      if (!isCurrent) {
                        const targetPw = projects.find(p => p.id === pid);
                        if (targetPw && onProjectWorkspaceSelected) {
                          onProjectWorkspaceSelected(targetPw);
                        }
                      }
                    }}
                    className={cn(
                      'group flex items-center gap-1.5 pr-1 pl-2 py-0.5 rounded-md text-sm font-medium transition-all max-w-[20ch]',
                      isCurrent
                        ? 'text-foreground bg-muted/30'
                        : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/15'
                    )}
                  >
                    <GradientPattern className="h-3 w-3 shrink-0 rounded" baseColor={color}/>
                    <span className="truncate">{name}</span>
                    <div
                      className='group-hover:opacity-100 opacity-0 h-3.5 w-3.5 p-0.5 hover:bg-destructive/30 rounded items-center justify-center shrink-0'
                      onClick={(e) => {
                        e.stopPropagation();
                        closeProjectTab(pid);
                      }}
                    >
                      <X className="h-full w-full" />
                    </div>
                  </button>
                );
              })}

              {/* Chevron to open project dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center justify-center h-5 w-5 rounded hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors ml-0.5">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-fit min-w-[300px] max-w-[500px] p-3 border-(length:--border-width) border-muted/40 bg-background"
                  align="start"
                >
                  <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
                    <div className="text-xs text-muted-foreground px-2 pb-1">All projects:</div>
                    {[...projects].reverse().map((project) => {
                      const colorIndex = hashString(project.id) % COLORS.length;
                      const color = COLORS[colorIndex] || COLORS[0];

                      return (
                        <button
                          key={project.id}
                          onClick={() => {
                            if (onProjectWorkspaceSelected) {
                              onProjectWorkspaceSelected(project);
                            }
                          }}
                          className={cn(
                            "flex items-center gap-3 px-2 py-1.5 text-left text-sm rounded hover:bg-background-darker transition-colors",
                            project.id === currentProjectWorkspace.id && "bg-muted/30"
                          )}
                        >
                          <GradientPattern className="w-7 h-7 rounded-md flex-shrink-0" baseColor={color} />
                          <span className="truncate">{project.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Render header items inline on md+ */}
          <div className="hidden md:flex items-center gap-2 px-2">
            <HeaderItems
              shouldShowLinkingWarning={shouldShowLinkingWarning}

              openChangePermissions={openChangePermissions}
              handleRefreshPermissions={handleRefreshPermissions}
              isRefreshingPermissions={isRefreshingPermissions}
              currentUserRole={currentUserRole}
              currentUserCollaborator={currentUserCollaborator}
              currentProjectWorkspace={currentProjectWorkspace}
              currentProjectName={currentProjectName}
              allCollaborators={allCollaborators}
              isCollaboratorsOpen={isCollaboratorsOpen}
              setIsCollaboratorsOpen={setIsCollaboratorsOpen}
              handleRemoveCollaborator={handleRemoveCollaborator}
              removingUserId={removingUserId}
              isBrowser={isBrowser}
              setIsOpenInBrowserDialogOpen={setIsOpenInBrowserDialogOpen}
              projectWorkspace={projectWorkspace}
              className="hidden md:contents"
              currentUserId={user?.id}
            />
          </div>

          {/* More menu for mobile (< md) */}
          <DropdownMenu open={isMoreMenuOpen} onOpenChange={setIsMoreMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button className="md:hidden relative flex items-center justify-center h-5 w-5 rounded hover:bg-background text-muted-foreground transition-all">
                <MoreHorizontal className="h-4 w-4" />
                {shouldShowLinkingWarning && (
                  <span className="absolute -right-5 flex h-4 w-4 pr-[1px] items-center justify-center rounded-full bg-muted/50 text-[9px] font-medium text-muted-foreground">
                    !
                  </span>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="flex flex-row items-center justify-center flex-wrap w-[95vw] gap-x-3 gap-y-2 p-3 border-(length:--border-width) border-muted/40 bg-background-darker"
              align="end"
            >
                <HeaderItems
                  shouldShowLinkingWarning={shouldShowLinkingWarning}
    
                  openChangePermissions={openChangePermissions}
                  handleRefreshPermissions={handleRefreshPermissions}
                  isRefreshingPermissions={isRefreshingPermissions}
                  currentUserRole={currentUserRole}
                  currentUserCollaborator={currentUserCollaborator}
                  currentProjectWorkspace={currentProjectWorkspace}
                  currentProjectName={currentProjectName}
                  allCollaborators={allCollaborators}
                  isCollaboratorsOpen={isCollaboratorsOpen}
                  setIsCollaboratorsOpen={setIsCollaboratorsOpen}
                  handleRemoveCollaborator={handleRemoveCollaborator}
                  removingUserId={removingUserId}
                  isBrowser={isBrowser}
                  setIsOpenInBrowserDialogOpen={setIsOpenInBrowserDialogOpen}
                  projectWorkspace={projectWorkspace}
                  inDropdown={true}
                  currentUserId={user?.id}
                />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className='flex-1 min-h-0 z-20 w-full pt-0'>
        <div className="w-full h-full">
          <div className="rounded-b-lg md:pt-0.5 overflow-hidden h-full flex flex-col">
            {user ? (
              <ProjectViewContent
                projectWorkspace={currentProjectWorkspace}
                onProjectMerged={handleProjectMerged}
                initialAgentId={initialAgentId}
                agentCreation={agentCreation}
                currentUserRole={currentUserRole}
              />
            ) : (
              <div className="p-4 text-center text-muted-foreground">
                User authentication required for agent management
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Open in Browser Dialog */}
      <OpenInBrowserDialog
        open={isOpenInBrowserDialogOpen}
        onClose={() => setIsOpenInBrowserDialogOpen(false)}
        projectId={currentProjectWorkspace.id}
      />
    </div>
  );
}