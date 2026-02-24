import { useAppStore, type ProjectWorkspace } from '@/stores/useAppStore';
import { apiRequest } from '@/lib/auth';
import type { Project, ProjectAPI } from '@/bindings/types';
import { open } from '@tauri-apps/plugin-dialog';
import { getTauriAPI } from '@/lib/tauri-api';

const tauriAPI = getTauriAPI();

class ProjectService {
  async fetchProjects(): Promise<Project[]> {
    try {
      const response = await apiRequest<{ projects: Project[] }>('/api/projects');
      useAppStore.getState().setBackendProjects(response.projects);
      return response.projects;
    } catch (error) {
      console.error('Failed to fetch projects:', error);
      return [];
    }
  }

  async openLocalFolder(): Promise<string | null> {
    try {
      // Open folder selection dialog
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select project folder',
      });

      if (!selected || typeof selected !== 'string') {
        return null;
      }

      // Check if the folder is a GitHub project and get git root
      const projectInfo = await tauriAPI.invoke<{ githubUrl: string; gitRoot: string } | null>('get_github_remote_url', {
        folderPath: selected
      });

      // Use git root if available, otherwise use selected path
      const gitRoot = projectInfo?.gitRoot || selected;

      return gitRoot;
    } catch (error) {
      console.error('Failed to open folder:', error);
      throw error;
    }
  }

  getProjectWorkspace(key: string) {
    const { backendProjects, localProjects } = useAppStore.getState();

    // Check local projects by key first
    const localProject = localProjects.get(key);
    if (localProject) {
      const backendProject = backendProjects.find(p => p.id === localProject.projectId);
      return {
        id: localProject.projectId,
        key,
        name: localProject.name,
        relativePath: localProject.relativePath,
        source: backendProject ? 'backend' as const : 'local' as const,
        repositoryId: backendProject?.repositoryId,
        cloneUrl: backendProject?.cloneUrl,
        localPath: localProject.gitRoot,
        lastOpened: localProject.lastOpened,
        createdAt: backendProject?.createdAt || localProject.createdAt
      };
    }

    // Check backend projects by ID (for projects not opened locally)
    const backendProject = backendProjects.find(p => p.id === key);
    if (backendProject) {
      return {
        id: backendProject.id,
        key,
        name: backendProject.name,
        relativePath: undefined,
        source: 'backend' as const,
        repositoryId: backendProject.repositoryId,
        cloneUrl: backendProject.cloneUrl,
        lastOpened: undefined,
        createdAt: backendProject.createdAt
      };
    }

    return null;
  }

  markProjectOpened(projectId: string) {
    useAppStore.getState().setLastOpenedProjectId(projectId);
    const localProjects = useAppStore.getState().localProjects;
    for (const [key, project] of localProjects) {
      if (project.projectId === projectId) {
        project.lastOpened = Date.now();
      }
    }
    useAppStore.getState().localProjects = new Map(localProjects);
  }

  async createProjectFromCloneUrl(url: string, name: string): Promise<ProjectWorkspace | null> {
    let projectWorkspace = null;
    
    // Create project without repository linking (just a name)
    const response = await apiRequest<any>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        localFolderName: name,
        cloneUrl: url
      })
    });

    if (response.success && response.project) {
      useAppStore.getState().setBackendProjects([...useAppStore.getState().backendProjects, response.project]);

      projectWorkspace = {
        id: response.project.id,
        name: response.project.name,
        relativePath: undefined,
        repositoryId: response.project.repositoryId,
        localPath: undefined,
        createdAt: response.project?.createdAt,
        cloneUrl: response.project?.cloneUrl
      };
    } else {
      throw new Error(response.error || 'Failed to create project');
    }

    return projectWorkspace;
  }

  async createProjectFromGithub(repo: { id: number; fullName: string; name: string; url: string }): Promise<ProjectWorkspace | null> {
    try {
      // Create project from GitHub repository
      const createRequest: ProjectAPI.CreateFromGitHubRequest = {
        githubUrl: repo.url,
        githubRepositoryId: repo.id
      };

      const response = await apiRequest<ProjectAPI.CreateFromGitHubResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(createRequest)
      });

      if (response.success && response.project) {
        // Add to backend projects immediately
        useAppStore.getState().setBackendProjects([...useAppStore.getState().backendProjects, response.project]);

        // Return project workspace (no local tracking)
        return {
          id: response.project.id,
          name: response.project.name,
          relativePath: undefined,
          repositoryId: response.project.repositoryId,
          localPath: undefined,
          createdAt: response.project.createdAt
        };
      } else {
        throw new Error(response.error || 'Unknown error occurred');
      }
    } catch (error) {
      console.error('Failed to create project from GitHub:', error);
      throw error;
    }
  }

  async createProjectFromPath(localPath: string): Promise<ProjectWorkspace | null> {
    try {
      // Get GitHub info and git root for the path
      const projectInfo = await tauriAPI.invoke<{ githubUrl: string; gitRoot: string } | null>('get_github_remote_url', {
        folderPath: localPath
      });

      // Use git root if available, otherwise use provided path
      const gitRoot = projectInfo?.gitRoot || localPath;

      // First, check if a project already exists for this git root
      const { backendProjects, localProjects } = useAppStore.getState();

      // Check local projects for matching git root
      for (const [key, localProject] of localProjects) {
        if (localProject.gitRoot === gitRoot) {
          console.log('[ProjectService] Found existing local project for git root:', gitRoot);

          // Get backend project info if available
          const backendProject = backendProjects.find(p => p.id === localProject.projectId);

          return {
            id: localProject.projectId,
            name: localProject.name,
            relativePath: undefined,
            repositoryId: backendProject?.repositoryId,
            localPath: localProject.gitRoot,
            lastOpened: localProject.lastOpened,
            createdAt: backendProject?.createdAt || localProject.createdAt
          };
        }
      }

      // No existing project found, create a new one
      console.log('[ProjectService] No existing project found for git root, creating new:', gitRoot);

      // Get folder name from git root
      const folderName = gitRoot.split(/[/\\]/).filter(Boolean).pop();

      // Create project
      const createRequest: ProjectAPI.CreateFromGitHubRequest = {
        githubUrl: projectInfo?.githubUrl && projectInfo.githubUrl !== '' ? projectInfo.githubUrl : undefined,
        localFolderName: folderName
      };

      const response = await apiRequest<ProjectAPI.CreateFromGitHubResponse>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(createRequest)
      });

      if (response.success && response.project) {
        // Track locally using git root
        useAppStore.getState().trackLocalProject(
          gitRoot, // Always use git root
          response.project.id,
          response.project.name,
          '' // No relative path tracking
        );

        // Add to backend projects immediately
        useAppStore.getState().setBackendProjects([...useAppStore.getState().backendProjects, response.project]);

        return {
          id: response.project.id,
          name: response.project.name,
          relativePath: undefined,
          repositoryId: response.project.repositoryId,
          localPath: gitRoot, // Always use git root
          createdAt: response.project.createdAt
        };
      } else {
        throw new Error(response.error || 'Unknown error occurred');
      }
    } catch (error) {
      console.error('Failed to create project from path:', error);
      throw error;
    }
  }

  async deleteProject(projectId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await apiRequest<{ success: boolean; error?: string }>(
        `/api/projects/${projectId}`,
        { method: 'DELETE' }
      );

      if (response.success) {
        // Remove from backend projects in store
        const currentProjects = useAppStore.getState().backendProjects;
        useAppStore.getState().setBackendProjects(currentProjects.filter(p => p.id !== projectId));

        // Remove any local project entries for this project
        const localProjects = new Map(useAppStore.getState().localProjects);
        for (const [key, lp] of localProjects) {
          if (lp.projectId === projectId) {
            localProjects.delete(key);
          }
        }
        useAppStore.getState().localProjects = localProjects;
      }

      return response;
    } catch (error) {
      console.error('Failed to delete project:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async removeCollaborator(projectId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await apiRequest<{ success: boolean; message?: string; error?: string }>(
        `/api/projects/${projectId}/collaborators/${userId}`,
        { method: 'DELETE' }
      );

      return response;
    } catch (error) {
      console.error('Failed to remove collaborator:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export const projectService = new ProjectService();