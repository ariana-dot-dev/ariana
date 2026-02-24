import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2, ArrowRight, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import type { GithubRepository } from '@/types/github';
import type { ProjectOrigin } from '@/types/ProjectOrigin';
import { projectService } from '@/services/project.service';
import { useToast } from '@/hooks/use-toast';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { cn } from '@/lib/utils';
import FolderOpen from '../ui/icons/FolderOpen';
import AlertIcon from '../ui/icons/AlertIcon';
import LockOpen from '../ui/icons/LockOpen';
import LockClosed from '../ui/icons/LockClosed';
import Eye from '../ui/icons/Eye';
import CheckmarkBadge from '../ui/icons/CheckmarkBadge';
import { posthog } from '@/lib/posthog';
import GithubLogo from '../ui/icons/GithubLogo';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ProjectOriginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectOrigin: (origin: ProjectOrigin) => void;
  onNavigateToPermissions?: () => void;
  mode: 'project' | 'agent';
}

export function ProjectOriginDialog({
  open,
  onOpenChange,
  onSelectOrigin,
  onNavigateToPermissions,
  mode
}: ProjectOriginDialogProps) {
  const isBrowser = useIsBrowser();
  const { toast } = useToast();

  const [filterTerm, setFilterTerm] = useState('');
  const [newRepoName, setNewRepoName] = useState('');
  const [creatingRepo, setCreatingRepo] = useState(false);
  const cachedRepositories = useAppStore(state => state.userRepositories);
  const setUserRepositories = useAppStore(state => state.setUserRepositories);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doRefresh = async () => {
    if (refreshing) return;

    setRefreshing(true);
    setError(null);

    const term = filterTerm.trim();

    try {
      const url = term
        ? `${API_URL}/api/github/repository/search?searchTerm=${encodeURIComponent(term)}`
        : `${API_URL}/api/github/repository/search`;
      const response = await authenticatedFetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to refresh repositories: ${response.status}`);
      }

      const data = await response.json();
      const fetched: GithubRepository[] = data.repositories || [];

      // Merge new results into cached repositories
      const existing = cachedRepositories || [];
      const existingIds = new Set(existing.map(r => r.id));
      const newRepos = fetched.filter(r => !existingIds.has(r.id));
      if (newRepos.length > 0) {
        setUserRepositories([...existing, ...newRepos]);
      }
    } catch (err) {
      console.error('Failed to refresh GitHub repositories:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh repositories');
    } finally {
      setRefreshing(false);
    }
  };

  // Filter cached repositories locally
  const allRepositories = cachedRepositories || [];
  const repositories = filterTerm.trim()
    ? allRepositories.filter(repo => {
        const term = filterTerm.toLowerCase();
        return repo.fullName.toLowerCase().includes(term) ||
               (repo.description && repo.description.toLowerCase().includes(term));
      })
    : allRepositories;

  const handleSelectRepository = (repo: GithubRepository, branch: string = 'main') => {
    posthog.capture('repository_selected', {
      repository_id: repo.id,
      repository_name: repo.fullName,
      is_private: repo.private,
      has_write_access: repo.permissions === 'write',
      branch: branch,
      from_search: filterTerm.length > 0
    });

    onSelectOrigin({
      type: 'repository',
      repository: repo,
      branch
    });
    onOpenChange(false);
    setFilterTerm('');
  };

  // Validate GitHub repository name
  const isValidRepoName = (name: string): boolean => {
    // GitHub repository name rules: alphanumeric, hyphens, underscores, periods
    const regex = /^[a-zA-Z0-9._-]+$/;
    return name.length > 0 && name.length <= 100 && regex.test(name);
  };

  const handleCreateNewRepo = async () => {
    if (!isValidRepoName(newRepoName)) {
      setError('Invalid repository name. Use only letters, numbers, hyphens, underscores, and periods.');
      return;
    }

    setCreatingRepo(true);
    setError(null);

    posthog.capture('repository_creation_started', {
      repo_name: newRepoName,
      source: 'origin_dialog'
    });

    try {
      const url = `${API_URL}/api/github/repository/create`;
      const response = await authenticatedFetch(url, {
        method: 'POST',
        body: JSON.stringify({ name: newRepoName })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Failed to create repository: ${response.status}`);
      }

      const data = await response.json();
      const createdRepo: GithubRepository = data.repository;

      posthog.capture('repository_created', {
        repository_id: createdRepo.id,
        repository_name: createdRepo.fullName,
        source: 'origin_dialog'
      });

      toast({
        title: "Repository created!",
        description: `Successfully created ${createdRepo.fullName}`,
      });

      // Auto-select the newly created repository
      handleSelectRepository(createdRepo);
      setNewRepoName('');
    } catch (err) {
      console.error('Failed to create GitHub repository:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to create repository';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setCreatingRepo(false);
    }
  };


  const handleOpenLocalFolder = async () => {
    try {
      const localPath = await projectService.openLocalFolder();
      if (localPath) {
        posthog.capture('local_repository_picked', {
          platform: 'desktop'
        });

        onSelectOrigin({
          type: 'local',
          localPath: localPath
        });
        onOpenChange(false);
      }
    } catch (error) {
      console.error('Failed to open folder:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to open folder.",
        variant: "destructive"
      });
    }
  };

  const isInitialLoading = cachedRepositories === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-fit h-[100ch] max-h-[97svh] md:h-[75ch] flex-col overflow-y-auto p-4 md:p-6 flex gap-4">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex flex-col md:flex-row items-center gap-4">
            <div className="text-xl text-left">
              {mode === 'agent' ? 'Agent\'s Repository' : 'Project\'s Repository'}
            </div>
            <div className="text-base text-left font-normal text-muted-foreground">
              {mode === 'agent' ? 'Decide what your agent will work with' : 'Decide what your project\'s agents will work with'}
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className={cn(
          "h-full flex space-x-6",
          "w-[85vw] md:w-[80ch] flex-col md:flex-row"
        )}>
          <div className={cn(
            "flex flex-col",
            'w-full md:w-[30ch]'
          )}>
            {/* Propose New Project Feature */}
            <>
                <div className="flex flex-col gap-3 p-4 bg-background-darker/50 rounded-lg">
                  <div className="text-sm font-medium">New Repository</div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4">
                      <GithubLogo className='max-h-full max-w-full text-inherit' />
                    </div>
                    <span className="text-xs text-muted-foreground">Creates a public repo on GitHub:</span>
                  </div>
                  <Input
                    placeholder="my-new-project"
                    value={newRepoName}
                    onChange={(e) => {
                      setNewRepoName(e.target.value);
                      setError(null);
                    }}
                  />
                  <Button
                    onClick={handleCreateNewRepo}
                    disabled={!newRepoName.trim() || creatingRepo}
                    variant="default"
                    hoverVariant='accent'
                    size="sm"
                  >
                    {creatingRepo ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Confirm'
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-3 my-5">
                  <div className="flex-1 h-[var(--border-width)] bg-muted/30" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 h-[var(--border-width)] bg-muted/30" />
                </div>
              </>

            {/* Local Folder Option */}
            {!isBrowser && (
              <>
                <div className="flex flex-col  p-4 bg-background-darker/50 rounded-lg">
                  <div className="text-sm font-medium mb-2">Git repository on this computer</div>
                  <div className="flex-shrink-0">
                    <Button
                      variant="default"
                      onClick={handleOpenLocalFolder}
                      className="w-full justify-start gap-2"
                    >
                      <div className="h-4 w-4">
                        <FolderOpen className='max-h-full max-w-full text-inherit' />
                      </div>
                      Pick Local Repository
                    </Button>
                  </div>
                </div>
              </>
            )}

            {error && (
              <p className="text-xs text-destructive p-4">{error}</p>
            )}

            <div className="hidden md:flex items-center gap-3 my-5">
              <div className="flex-1 h-[var(--border-width)] bg-muted/30" />
              <span className="text-xs text-muted-foreground">or</span>
              <ArrowRight className="w-3 h-3 text-muted" />
            </div>
            <div className="md:hidden flex items-center gap-3 my-5">
              <div className="flex-1 h-[var(--border-width)] bg-muted/30" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-[var(--border-width)] bg-muted/30" />
            </div>
          </div>

          {/* Repository Selection */}
          <div className="min-h-fit md:min-h-auto h-fit md:h-[63ch] md:flex-1 md:min-w-0 flex flex-col overflow-hidden bg-background-darker/50 p-4 rounded-lg">
              <div className="text-sm font-medium mb-2">GitHub repository</div>
              <div className="flex flex-col min-h-fit md:min-h-auto h-fit overflow-hidden w-full">
                {/* Filter Input + Refresh */}
                <div className="flex gap-2 mb-3 flex-shrink-0">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 pb-1 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                    <Input
                      placeholder="Filter repositories..."
                      value={filterTerm}
                      onChange={(e) => setFilterTerm(e.target.value)}
                      className="pl-10"
                      autoFocus
                    />
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={doRefresh}
                        disabled={refreshing}
                        variant="transparent"
                        size="sm"
                        className="h-9 px-2.5"
                      >
                        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh from GitHub</TooltipContent>
                  </Tooltip>
                </div>

                {/* Repository List */}
                <div className="h-[45ch] md:flex-1 overflow-y-auto rounded-lg md:pr-2">
                  {error ? (
                    <div className="text-center py-8 text-destructive">
                      <p>Error: {error}</p>
                    </div>
                  ) : isInitialLoading ? (
                    <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-2">
                      <Loader2 className="h-6 w-6 animate-spin" />
                      <p>Loading repositories...</p>
                    </div>
                  ) : repositories.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>No repositories found{filterTerm.trim() ? ` matching "${filterTerm}"` : ''}</p>
                    </div>
                  ) : (
                    <div>
                      {repositories.map((repo) => (
                        <div
                          key={repo.id}
                          onClick={() => handleSelectRepository(repo)}
                          className="flex items-center gap-3 px-3 pb-5 pt-2.5 cursor-pointer transition-all duration-200 odd:bg-muted/10 even:bg-muted/20 hover:bg-muted/50"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <div className="flex flex-col gap-1 text-sm text-foreground truncate max-w-[600px]">
                                <span className="opacity-20 text-xs">{repo.fullName.split('/')[0]}</span>
                                <div className='flex items-center gap-1'>
                                  {repo.private ? (
                                    <div className="h-3 w-3"><LockClosed className="max-h-full max-w-full text-muted-foreground" /></div>
                                  ) : (
                                    <div className="h-3 w-3"><LockOpen className="max-h-full max-w-full text-muted-foreground" /></div>
                                  )}
                                  <div>{repo.fullName.split('/')[1]}</div>
                                  {repo.permissions == 'write' ? (
                                    <div className="h-4 w-4 ml-1">
                                      <CheckmarkBadge className="max-h-full max-w-full text-constructive-foreground" />
                                    </div>
                                  ) : (
                                    <div className="h-4 w-4 ml-1">
                                      <Eye className="max-h-full max-w-full text-foreground" />
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            {repo.description && (
                              <p className="text-xs text-muted-foreground truncate mt-1 overflow-ellipsis max-w-[45ch]">
                                {repo.description}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* Footer */}
                <div className="mt-4 flex-shrink-0 flex flex-col gap-4">
                  {repositories.some((repo) => repo.permissions == 'write') && (
                    <span className="text-xs flex items-center gap-2 text-constructive-foreground">
                      <div className="h-4 w-4">
                        <CheckmarkBadge className="max-h-full max-w-full text-constructive-foreground" />
                      </div>
                      <div>Ariana can create branches, push & create pull requests</div>
                    </span>
                  )}
                  {repositories.some((repo) => repo.permissions == 'read') && (
                    <div className="text-xs flex items-center gap-2 text-foreground">
                      <div className="h-4 w-4">
                        <Eye className="max-h-full max-w-full text-foreground" />
                      </div>
                      <div>Ariana can only pull & read from this repository</div>
                    </div>
                  )}
                  <div className="flex gap-2 items-center">
                    <div className="h-4 w-4">
                      <AlertIcon className="max-h-full max-w-full text-inherit" />
                    </div>
                    <div className="flex-1 flex flex-col gap-0">
                      <p className="text-xs text-muted-foreground/50">
                        Can't find your repository? Want to grant push permissions?
                      </p>
                      <button
                        className="text-xs !p-0 text-left text-accent hover:text-accent/80"
                        onClick={() => {
                          if (onNavigateToPermissions) {
                            onOpenChange(false);
                            onNavigateToPermissions();
                          }
                        }}
                      >
                        Configure repository permissions →
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
