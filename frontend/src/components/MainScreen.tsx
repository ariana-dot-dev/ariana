import { useState, useEffect, useRef } from 'react';
import { CustomHeader } from './CustomHeader';
import { ProjectView } from './ProjectView';
import { ScrollArea } from '@/components/ui/scroll-area';
import {MainMenu} from "@/components/main-menu/MainMenu.tsx";
import { projectService } from '@/services/project.service';
import { useAppStore, type ProjectWorkspace } from '@/stores/useAppStore';
import { ProviderValidationDialog } from './ProviderValidationDialog';
import { useAgentCreation } from '@/hooks/useAgentCreation';
import { useRouter } from '@/hooks/useRouter';
import { routerService } from '@/services/router.service';
import { useProjects } from '@/hooks/useProjects';
import { UsernameMismatchDialog } from './UsernameMismatchDialog';
import { cn } from '@/lib/utils';

export function MainScreen() {
  const [loading, setLoading] = useState(false);
  const { projects: projectWorkspaces } = useProjects();

  const { route } = useRouter();
  const projectId = route.type === 'project' ? route.projectId : route.type === 'agent' ? route.projectId : null;
  const agentId = route.type === 'agent' ? route.agentId : null;
  const user = useAppStore(state => state.user);
  const [showUsernameMismatch, setShowUsernameMismatch] = useState(false);
  const [expectedUsername, setExpectedUsername] = useState<string>('');

  // Project tab state
  const openProjectIds = useAppStore(state => state.openProjectIds);
  const openProjectTab = useAppStore(state => state.openProjectTab);

  // Track initial agent IDs per project
  const initialAgentIds = useRef<Map<string, string>>(new Map());

  // Centralized agent creation with provider validation
  const agentCreation = useAgentCreation();

  // Sync route -> project tabs (only when projectId/agentId actually changes)
  useEffect(() => {
    if (projectId) {
      if (agentId) {
        initialAgentIds.current.set(projectId, agentId);
      }
      openProjectTab(projectId);
    }
  }, [projectId, agentId]);

  // Get current project from route
  const selectedProject = projectId
    ? projectWorkspaces.find(p => p.id === projectId) || null
    : null;

  // Username validation - check if expected username matches current user
  useEffect(() => {
    if ((route.type === 'project' || route.type === 'agent') && route.expectedUsername && user?.name) {
      // Check if there's a username mismatch
      if (user.name !== route.expectedUsername) {
        // console.log(`[MainScreen] Username mismatch: expected ${route.expectedUsername}, current ${user.name}`);
        setExpectedUsername(route.expectedUsername);
        setShowUsernameMismatch(true);
      } else {
        setShowUsernameMismatch(false);
      }
    } else {
      // Reset if we're not on a project/agent route or no expected username
      setShowUsernameMismatch(false);
    }
  }, [route, user?.name]);

  const handleBackToRepositories = () => {
    routerService.navigateTo({ type: 'main-menu' });
  };

  const handleProjectWorkspaceSelected = (projectWorkspace: ProjectWorkspace, selectedAgentId?: string) => {
    // console.log('ProjectWorkspaceSelected', JSON.stringify(projectWorkspace, null, 2));
    projectService.markProjectOpened(projectWorkspace.id);

    // Navigate to project or agent route
    if (selectedAgentId) {
      routerService.navigateTo({ type: 'agent', projectId: projectWorkspace.id, agentId: selectedAgentId });
    } else {
      // Just navigate to project - the useEffect above will restore last agent if there was one
      routerService.navigateTo({ type: 'project', projectId: projectWorkspace.id });
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="h-full flex flex-col">
        <CustomHeader />
        <ScrollArea className="flex-1">
        </ScrollArea>
      </div>
    );
  }

  // Project/Agent view (both project and agent routes use ProjectView)
  if ((route.type === 'project' || route.type === 'agent') && selectedProject) {
    return (
      <>
        {/* Render all open project tabs with stable keys - show/hide via CSS */}
        {openProjectIds.map((pid) => {
          const pw = projectWorkspaces.find(p => p.id === pid);
          if (!pw) return null;
          const isActive = pid === selectedProject.id;
          return (
            <div key={pid} className={cn("h-full", isActive ? '' : 'hidden')}>
              <ProjectView
                projectWorkspace={pw}
                onBack={handleBackToRepositories}
                initialAgentId={isActive ? (agentId || undefined) : initialAgentIds.current.get(pid)}
                agentCreation={agentCreation}
                onProjectWorkspaceSelected={handleProjectWorkspaceSelected}
              />
            </div>
          );
        })}
        <ProviderValidationDialog
          open={agentCreation.providerDialogOpen}
          onOpenChange={agentCreation.setProviderDialogOpen}
          onSkip={agentCreation.handleProviderSkip}
        />
        {showUsernameMismatch && user?.name && (
          <UsernameMismatchDialog
            open={showUsernameMismatch}
            expectedUsername={expectedUsername}
            currentUsername={user.name}
          />
        )}
      </>
    );
  }

  // Main menu view (default)
  return (
    <>
      <div className="h-full flex flex-col">
        <CustomHeader />
        <MainMenu
          onProjectWorkspaceSelected={handleProjectWorkspaceSelected}
          agentCreation={agentCreation}
        />
      </div>
      <ProviderValidationDialog
        open={agentCreation.providerDialogOpen}
        onOpenChange={agentCreation.setProviderDialogOpen}
        onSkip={agentCreation.handleProviderSkip}
      />
      {/* Show username mismatch dialog even in main menu if route expects a specific user */}
      {showUsernameMismatch && user?.name && (
        <UsernameMismatchDialog
          open={showUsernameMismatch}
          expectedUsername={expectedUsername}
          currentUsername={user.name}
        />
      )}
    </>
  );
}