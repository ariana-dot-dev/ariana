import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ProjectCard } from './ProjectCard';
import { Search, Plus, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { projectService } from '@/services/project.service';
import { ProjectOriginDialog } from './ProjectOriginDialog';
import type { ProjectOrigin } from '@/types/ProjectOrigin';
import { getTauriAPI } from '@/lib/tauri-api';
import { apiRequest } from '@/lib/auth';
import { useAppStore, type ProjectWorkspace } from '@/stores/useAppStore';
import { useProjects } from '@/hooks/useProjects';
import { posthog } from '@/lib/posthog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

type ProjectsTabProps = {
  onProjectWorkspaceSelected: (projectWorkspace: ProjectWorkspace) => void;
  onNavigateToPermissions?: () => void;
};

export function ProjectsTab({ onProjectWorkspaceSelected, onNavigateToPermissions }: ProjectsTabProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [originDialogOpen, setOriginDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectWorkspace | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();
  const { projects: projectWorkspaces, refreshProjects } = useProjects();

  // Track projects tab opened on mount
  useEffect(() => {
    posthog.capture('projects_tab_opened', {
      project_count: projectWorkspaces.length
    });
  }, []);

  const filteredProjectWorkspaces = projectWorkspaces.filter(project => {
    const searchText = project.relativePath && project.relativePath !== ''
      ? `${project.relativePath} in ${project.name}`
      : project.name;
    return searchText.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const handleOpenProjectWorkspace = async (projectWorkspace: ProjectWorkspace) => {
    posthog.capture('project_opened', {
      project_id: projectWorkspace.id,
      has_local_path: Boolean(projectWorkspace.localPath),
      has_repository_id: Boolean(projectWorkspace.repositoryId),
      from_search: searchTerm.length > 0
    });
    onProjectWorkspaceSelected(projectWorkspace);
  };

  const handleDeleteProject = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      const result = await projectService.deleteProject(deleteTarget.id);
      if (result.success) {
        posthog.capture('project_deleted', {
          project_id: deleteTarget.id,
          source: 'projects_tab'
        });
        toast({
          title: "Project deleted",
          description: `"${deleteTarget.name}" has been permanently deleted.`,
        });
        await refreshProjects();
      } else {
        throw new Error(result.error || 'Failed to delete project');
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete project.",
        variant: "destructive"
      });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleSelectOrigin = async (origin: ProjectOrigin) => {
    try {
      let projectWorkspace: ProjectWorkspace | null = null;
      let existing: ProjectWorkspace | undefined;

      if (origin.type === 'local') {
        // Check if project already exists
        existing = projectWorkspaces.find(p => p.localPath === origin.localPath);

        if (existing) {
          projectWorkspace = existing;
        } else {
          const tauri = getTauriAPI();

          // Get GitHub remote info and git root
          const projectInfo = await tauri.invoke<{ githubUrl: string; gitRoot: string } | null>('get_github_remote_url', {
            folderPath: origin.localPath
          });

          // Use git root if available, otherwise use selected path
          const gitRoot = projectInfo?.gitRoot || origin.localPath;

          // Get the folder name from git root
          const folderName = gitRoot.split(/[/\\]/).filter(Boolean).pop();

          // Create project
          const response = await apiRequest<any>('/api/projects', {
            method: 'POST',
            body: JSON.stringify({
              githubUrl: projectInfo?.githubUrl && projectInfo.githubUrl !== '' ? projectInfo.githubUrl : undefined,
              localFolderName: folderName
            })
          });

          if (response.success && response.project) {
            // Track locally using git root
            useAppStore.getState().trackLocalProject(
              gitRoot,
              response.project.id,
              response.project.name,
              ''
            );

            // Refresh backend projects
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
      } else if (origin.type === 'repository') {
        // Check if project already exists
        existing = projectWorkspaces.find(p =>
          p.repositoryId && p.repositoryId === `repo_${origin.repository.id}`
        );

        if (existing) {
          projectWorkspace = existing;
        } else {
          // Create project from GitHub repository via backend
          projectWorkspace = await projectService.createProjectFromGithub(origin.repository);
        }
      } else if (origin.type === 'cloneUrl') {
        // Check if project already exists by name
        existing = projectWorkspaces.find(p => p.name === origin.name);

        if (existing) {
          projectWorkspace = existing;
        } else {
          projectWorkspace = await projectService.createProjectFromCloneUrl(origin.url, origin.name);
        }
      }

      if (projectWorkspace) {
        if (!existing) {
          posthog.capture('project_created', {
            project_id: projectWorkspace.id,
            origin_type: origin.type,
            source: 'projects_tab',
            has_github_url: origin.type === 'repository' || origin.type === 'cloneUrl'
          });
        }
        onProjectWorkspaceSelected(projectWorkspace);
      } else {
        throw new Error('Failed to create or find project');
      }
    } catch (error) {
      console.error('Failed to create project:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create project.",
        variant: "destructive"
      });
    }
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="mb-6">
        <div className="flex gap-2 mb-4">
          <Button
            variant="default"
            hoverVariant="accent"
            size="default"
            className="text-sm flex items-center gap-2"
            onClick={() => {
              posthog.capture('new_project_clicked', {
                source: 'projects_tab'
              });
              setOriginDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            New Project
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4 secondary-secondary" />
          <Input
            placeholder="Search projects..."
            value={searchTerm}
            onChange={(e) => {
              const newValue = e.target.value;
              if (searchTerm.length === 0 && newValue.length > 0) {
                posthog.capture('projects_search_started');
              }
              setSearchTerm(newValue);
            }}
            className="pl-10"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {filteredProjectWorkspaces.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              {searchTerm ? 'No project found matching your search.' : 'No project found.'}
            </p>
          </div>
        ) : (
          [...filteredProjectWorkspaces].reverse().map((projectWorkspace) => (
            <ProjectCard
              key={projectWorkspace.id}
              projectWorkspace={projectWorkspace}
              onClick={handleOpenProjectWorkspace}
              onDelete={setDeleteTarget}
            />
          ))
        )}
      </div>

      {/* Project Origin Dialog */}
      <ProjectOriginDialog
        open={originDialogOpen}
        onOpenChange={setOriginDialogOpen}
        onSelectOrigin={handleSelectOrigin}
        onNavigateToPermissions={onNavigateToPermissions}
        mode="project"
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm p-6" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete "{deleteTarget?.name}"?</DialogTitle>
            <DialogDescription>
              This will permanently delete the project and all of its agents, environments, automations, and their history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="default"
              size="sm"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              hoverVariant="destructive"
              size="sm"
              disabled={deleting}
              onClick={handleDeleteProject}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete permanently'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
