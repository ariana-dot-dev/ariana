import type { ServiceContainer } from '@/services';
import type { ProjectAPI } from '@shared/types';
import { ProjectRole } from '@shared/types';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';
import type { RestEndpointMethodTypes } from '@octokit/rest';
import type { AutomationConfig } from '@shared/types/automation.types';
import { emitProjectCreated, emitProjectDeleted, emitProjectUpdated } from '@/websocket/emit-helpers';

const logger = getLogger(['api', 'projects']);

// Helper function to create default environment with default automations
async function createDefaultEnvironmentWithAutomations(
  services: ServiceContainer,
  projectId: string,
  userId: string
): Promise<void> {
  // Create the default environment
  const defaultEnv = await services.personalEnvironments.createEnvironment({
    projectId,
    userId,
    environmentData: {
      name: 'Default',
      envContents: '',
      secretFiles: []
    }
  });

  // Set it as default
  await services.personalEnvironments.setDefaultEnvironment(projectId, userId, defaultEnv.id);

  // Create default Setup automation
  const setupAutomationConfig: AutomationConfig = {
    name: 'Setup',
    trigger: { type: 'on_agent_ready' },
    scriptLanguage: 'bash',
    scriptContent: 'echo "This is your setup automation. For now it does nothing but you can have it install your dependencies. You can edit it from the \\"Automations\\" menu."',
    blocking: false,
    feedOutput: false
  };

  const setupAutomation = await services.automations.createAutomation({
    projectId,
    userId,
    automationData: setupAutomationConfig
  });

  // Install Setup automation to environment
  await services.automations.installAutomationToEnvironment(setupAutomation.id, defaultEnv.id);

  // Create default Pre-commit automation
  const preCommitAutomationConfig: AutomationConfig = {
    name: 'Pre-commit',
    trigger: { type: 'on_before_commit' },
    scriptLanguage: 'bash',
    scriptContent: 'echo "This is your pre-commit automation. It runs before the agent tries to commit his changes. For now it does nothing, but you can have it run type checks, formatting or tests. Its output can be fed to the agent if you\'d like. You can edit it from the \\"Automations\\" menu."',
    blocking: true,
    feedOutput: false
  };

  const preCommitAutomation = await services.automations.createAutomation({
    projectId,
    userId,
    automationData: preCommitAutomationConfig
  });

  // Install Pre-commit automation to environment
  await services.automations.installAutomationToEnvironment(preCommitAutomation.id, defaultEnv.id);

  logger.info`Created default environment with Setup and Pre-commit automations for project ${projectId} and user ${userId}`;
}

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

// Get user's projects
export async function handleGetProjects(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const projects = await context.services.projects.getUserProjects(auth.user.id);

    return addCorsHeaders(Response.json({
      success: true,
      projects
    }), context.origin);
  } catch (error) {
    logger.error`Get projects failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get single project
export async function handleGetProject(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    const project = await context.services.projects.getProject(projectId);
    if (!project) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Project not found'
      }, { status: 404 }), context.origin);
    }

    return addCorsHeaders(Response.json({
      success: true,
      project
    }), context.origin);
  } catch (error) {
    logger.error`Get project failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Check GitHub access and link repository to project
export async function handleCheckAndLinkRepository(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as { githubUrl?: string };
    const { githubUrl } = body;

    const project = await context.services.projects.getProject(projectId);
    if (!project) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Project not found'
      }, { status: 404 }), context.origin);
    }

    // Check if user is a member of the project
    const members = await context.services.projects.getProjectMembers(projectId);
    const member = members.find(m => m.userId === auth.user.id);
    if (!member) {
      return addCorsHeaders(Response.json({
        error: 'Not a member of this project'
      }, { status: 403 }), context.origin);
    }

    // If project is linked to a fork, skip GitHub checks and return immediately
    // Forks behave like non-GitHub projects with Ariana-managed permissions
    if (project.repositoryId && project.repositoryId.startsWith('fork_')) {
      const forkRepository = await context.services.repositories.getRepositoryById(project.repositoryId);

      if (forkRepository) {
        logger.info`Project ${projectId} is linked to fork ${project.repositoryId}, skipping GitHub checks`;
        return addCorsHeaders(Response.json({
          success: true,
          accessGranted: false, // Not GitHub-managed
          merged: false,
          projectId,
          repository: {
            id: forkRepository.id,
            githubId: forkRepository.githubId,
            fullName: forkRepository.fullName
          },
          branches: [], // No branch fetching for forks
          role: member.role // Keep current Ariana-managed role
        }), context.origin);
      }
    }

    const userTokens = await context.services.github.getUserTokens(auth.user.id);
    if (!userTokens) {
      // No GitHub tokens - if user is VISITOR, keep them as VISITOR (they can still access shared agents)
      if (member.role === ProjectRole.VISITOR) {
        return addCorsHeaders(Response.json({
          success: true,
          accessGranted: false,
          message: 'No GitHub profile linked - staying as VISITOR',
          role: ProjectRole.VISITOR
        }), context.origin);
      }

      return addCorsHeaders(Response.json({
        success: false,
        error: 'User does not have GitHub tokens'
      }, { status: 400 }), context.origin);
    }

    try {
      // Try to get repository by URL
      let repoData = null;
      if (githubUrl) {
        repoData = await context.services.github.getRepositoryByUrl(auth.user.id, githubUrl);
      } else if(project.repositoryId) {
        const dbRepository = await context.services.repositories.getRepositoryById(project.repositoryId);
        if (dbRepository) {
          repoData = await context.services.github.getRepositoryById(auth.user.id, dbRepository.githubId);
        }
      }

      if (!repoData) {
        // No access to repo - if user is VISITOR, keep them as VISITOR
        if (member.role === ProjectRole.VISITOR) {
          return addCorsHeaders(Response.json({
            success: true,
            accessGranted: false,
            message: 'No GitHub access to repository - staying as VISITOR',
            role: ProjectRole.VISITOR
          }), context.origin);
        }

        return addCorsHeaders(Response.json({
          success: false,
          error: 'No access to repository',
          accessGranted: false
        }, { status: 403 }), context.origin);
      }

      const repositoryId = `repo_${repoData.id}`;

      // Check user's personal permission for role assignment
      const userGitHubPermission = await context.services.github.getCurrentUserRepositoryPermission(
        auth.user.id,
        repoData.full_name
      );

      if (!userGitHubPermission) {
        // No GitHub permissions - if user is VISITOR, keep them as VISITOR
        if (member.role === ProjectRole.VISITOR) {
          return addCorsHeaders(Response.json({
            success: true,
            accessGranted: false,
            message: 'No GitHub permissions for repository - staying as VISITOR',
            role: ProjectRole.VISITOR
          }), context.origin);
        }

        return addCorsHeaders(Response.json({
          success: false,
          error: 'No access to repository',
          accessGranted: false
        }), context.origin);
      }

      const userGithubRole = userGitHubPermission.accessLevel;
      logger.info(`User GitHub role: ${userGithubRole}`);
      const user = await context.services.users.getUserWithProfile(auth.user.id);

      // Upsert repository
      let repository = await context.services.repositories.upsertRepository({
        id: repositoryId,
        githubId: repoData.id,
        name: repoData.name,
        fullName: repoData.full_name,
        description: repoData.description || undefined,
        url: repoData.html_url,
        lastCommitAt: repoData.pushed_at ? new Date(repoData.pushed_at) : undefined
      });

      // Check if another project already exists for this repository
      const existingProjectForRepo = await context.services.projects.getProjectByRepository(repository.id);

      let finalProjectId = projectId;
      let merged = false;

      if (existingProjectForRepo && existingProjectForRepo.id !== projectId && userGithubRole !== ProjectRole.READ) {
        // Another project exists for this repo - merge current project into it
        logger.info`Merging project ${projectId} into existing project ${existingProjectForRepo.id} for repository ${repository.fullName}`;

        // Move agents, automations, and environments
        const agentsMoved = await context.services.agents.moveAgentsToProject(projectId, existingProjectForRepo.id);
        const automationsMoved = await context.services.automations.moveAutomationsToProject(projectId, existingProjectForRepo.id);
        const environmentsMoved = await context.services.personalEnvironments.moveEnvironmentsToProject(projectId, existingProjectForRepo.id);

        logger.info`Moved ${agentsMoved} agents, ${automationsMoved} automations, and ${environmentsMoved} environments from project ${projectId} to ${existingProjectForRepo.id}`;

        // Add user as member to existing project with user's GitHub role
        await context.services.projects.upsertProjectMember({
          projectId: existingProjectForRepo.id,
          userId: auth.user.id,
          role: userGithubRole
        });

        // Ensure user has a default environment for the merged project
        try {
          const defaultEnv = await context.services.personalEnvironments.getDefaultEnvironment(existingProjectForRepo.id, auth.user.id);
          if (!defaultEnv) {
            await createDefaultEnvironmentWithAutomations(context.services, existingProjectForRepo.id, auth.user.id);
          }
        } catch (error) {
          logger.error`Failed to create default environment for merged project: ${error}`;
        }

        // Delete old project
        await context.services.projects.deleteProject(projectId);
        await context.services.repositories.deleteRepository(projectId);
        emitProjectDeleted(projectId, auth.user.id);

        finalProjectId = existingProjectForRepo.id;
        merged = true;

        logger.info`Project ${projectId} merged and deleted, now using ${finalProjectId}`;
      } else if (userGithubRole === ProjectRole.READ) {
        repository = await context.services.repositories.upsertRepository({
          id: `fork_${auth.user.id}_${repositoryId}`,
          githubId: repoData.id,
          name: `${repoData.name} (fork)`,
          fullName: repoData.full_name,
          description: repoData.description || undefined,
          url: repoData.html_url,
          lastCommitAt: repoData.pushed_at ? new Date(repoData.pushed_at) : undefined
        });

        // link fork to project
        await context.services.projects.updateProjectRepository(projectId, repository.id);
        emitProjectUpdated(projectId);

        // Ensure user has a default environment for this forked project
        try {
          const defaultEnv = await context.services.personalEnvironments.getDefaultEnvironment(projectId, auth.user.id);
          if (!defaultEnv) {
            await createDefaultEnvironmentWithAutomations(context.services, projectId, auth.user.id);
          }
        } catch (error) {
          logger.error`Failed to create default environment for forked project: ${error}`;
        }

        logger.info`Project ${projectId} linked to repository fork ${repository.fullName} with role ${userGithubRole}`;
      } else {
        // No existing project, just link this one
        await context.services.projects.updateProjectRepository(projectId, repository.id);
        emitProjectUpdated(projectId);

        // Always use user's GitHub role
        await context.services.projects.upsertProjectMember({
          projectId,
          userId: auth.user.id,
          role: userGithubRole
        });

        // Ensure user has a default environment for this project
        try {
          const defaultEnv = await context.services.personalEnvironments.getDefaultEnvironment(projectId, auth.user.id);
          if (!defaultEnv) {
            await createDefaultEnvironmentWithAutomations(context.services, projectId, auth.user.id);
          }
        } catch (error) {
          logger.error`Failed to create default environment for linked project: ${error}`;
        }

        logger.info`Project ${projectId} linked to repository ${repository.fullName} with role ${userGithubRole}`;
      }

      // Fetch branches
      const branches = await context.services.github.getRepositoryBranches(
        auth.user.id,
        repoData.full_name
      );

      return addCorsHeaders(Response.json({
        success: true,
        accessGranted: true,
        merged,
        projectId: finalProjectId,
        repository: {
          id: repository.id,
          githubId: repository.githubId,
          fullName: repository.fullName
        },
        branches,
        role: userGithubRole
      }), context.origin);

    } catch (error) {
      // Check if this is a GitHub authentication error
      if (error instanceof Error && error.message === 'GITHUB_AUTH_REQUIRED') {
        logger.warn`GitHub authentication required for user ${auth.user.id} in project ${projectId}`;
        return addCorsHeaders(Response.json({
          success: false,
          error: 'GitHub authentication required',
          code: 'GITHUB_AUTH_REQUIRED',
          accessGranted: false
        }, { status: 401 }), context.origin);
      }

      logger.warn`Repository access check failed for project ${projectId}: ${error}`;
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Repository not accessible or permissions not granted yet',
        accessGranted: false
      }), context.origin);
    }

  } catch (error) {
    // Check if this is a GitHub authentication error
    if (error instanceof Error && error.message === 'GITHUB_AUTH_REQUIRED') {
      logger.warn`GitHub authentication required for user ${auth.user.id} in project ${projectId}`;
      return addCorsHeaders(Response.json({
        success: false,
        error: 'GitHub authentication required',
        code: 'GITHUB_AUTH_REQUIRED'
      }, { status: 401 }), context.origin);
    }

    logger.error`Check and link repository failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Create project from GitHub repository
export async function handleCreateProject(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as ProjectAPI.CreateFromGitHubRequest;
    const { githubUrl, githubRepositoryId, localFolderName, cloneUrl } = body;

    // Get user info (may be anonymous)
    const user = await context.services.users.getUserWithProfile(auth.user.id);
    const isAnonymous = user?.isAnonymous || false;

    let repoData: RestEndpointMethodTypes['repos']['get']['response']['data'] | null = null;
    let repositoryId: string | undefined;
    let repository: any = null;

    // Atomically check and increment usage limits (prevents race conditions)
    const limitCheck = await context.services.usageLimits.checkAndIncrementUsage(auth.user.id, 'project');
    if (!limitCheck.allowed) {
      // User doesn't exist in database
      if (limitCheck.userNotFound) {
        return addCorsHeaders(Response.json({
          success: false,
          error: 'User not found'
        }, { status: 404 }), context.origin);
      }

      // Rate limit exceeded
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Project creation limit reached',
        code: 'LIMIT_EXCEEDED',
        limitInfo: {
          limitType: limitCheck.limitType,
          resourceType: limitCheck.resourceType,
          current: limitCheck.current,
          max: limitCheck.max,
          isMonthlyLimit: limitCheck.isMonthlyLimit || false
        }
      }, { status: 429 }), context.origin);
    }

    let projectRole: ProjectRole = ProjectRole.ADMIN;

    // Only try GitHub operations if user has GitHub profile and tokens
    if (!isAnonymous && user?.githubProfile) {
      const userTokens = await context.services.github.getUserTokens(auth.user.id);

      if (userTokens) {
        try {
          if (githubRepositoryId) {
            // Get repository by ID using GitHub service
            repoData = await context.services.github.getRepositoryById(auth.user.id, githubRepositoryId);
          } else if (githubUrl) {
            // Get repository by URL using GitHub service
            repoData = await context.services.github.getRepositoryByUrl(auth.user.id, githubUrl!);
          }

          if (repoData) {
            repositoryId = `repo_${repoData.id}`;
            const userPermission = await context.services.github.getCurrentUserRepositoryPermission(
              auth.user.id,
              repoData.full_name
            );
            if (userPermission && userPermission.accessLevel !== ProjectRole.READ) {
              projectRole = userPermission.accessLevel;

              repository = await context.services.repositories.upsertRepository({
                id: repositoryId!,
                githubId: repoData.id,
                name: repoData.name,
                fullName: repoData.full_name,
                description: repoData.description || undefined,
                url: repoData.html_url,
                lastCommitAt: repoData.pushed_at ? new Date(repoData.pushed_at) : undefined
              });

              // First check if any project exists for this repository
              let existingProject = await context.services.projects.getProjectByRepository(repository.id);

              if (existingProject) {
                // Always upsert member to keep permissions in sync with GitHub
                await context.services.projects.upsertProjectMember({
                  projectId: existingProject.id,
                  userId: auth.user.id,
                  role: projectRole
                });

                // Check if user has a default environment for this project, if not create one
                try {
                  const defaultEnv = await context.services.personalEnvironments.getDefaultEnvironment(existingProject.id, auth.user.id);
                  if (!defaultEnv) {
                    await createDefaultEnvironmentWithAutomations(context.services, existingProject.id, auth.user.id);
                  }
                } catch (error) {
                  logger.error`Failed to create default environment for existing project ${existingProject.id}: ${error}`;
                }

                const response: ProjectAPI.CreateFromGitHubResponse = {
                  success: true,
                  project: existingProject,
                  repository: {
                    id: repository.id,
                    githubId: repository.githubId
                  },
                  message: `Synced project access with GitHub role: ${projectRole}`
                };
                return addCorsHeaders(Response.json(response), context.origin);
              }
            } else {
              repository = await context.services.repositories.upsertRepository({
                id: `fork_${auth.user.id}_${repositoryId}`,
                githubId: repoData.id,
                name: `${repoData.name} (fork)`,
                fullName: repoData.full_name,
                description: repoData.description || undefined,
                url: repoData.html_url,
                lastCommitAt: repoData.pushed_at ? new Date(repoData.pushed_at) : undefined
              });
            }
          }
        } catch (error) {
          // Repository not accessible through GitHub app, continue with independent project
          logger.warn`Repository not accessible through GitHub app, creating independent project: ${error}`;
        }
      }
    }

    // Create independent project (either repo not found or no permissions)
    const projectName = repoData?.name || githubUrl?.split('/').pop()?.replace('.git', '') || localFolderName || 'Untitled Project';

    const project = await context.services.projects.createProject({
      name: projectName,
      repositoryId: repository?.id,
      cloneUrl: cloneUrl
    });
    emitProjectCreated(auth.user.id, project.id);

    // Add user as admin
    await context.services.projects.upsertProjectMember({
      projectId: project.id,
      userId: auth.user.id,
      role: projectRole
    });

    // Create default empty environment for the project with default automations
    try {
      await createDefaultEnvironmentWithAutomations(context.services, project.id, auth.user.id);
    } catch (error) {
      logger.error`Failed to create default environment for project ${project.id}: ${error}`;
      // Don't fail project creation if environment creation fails
    }

    const response: ProjectAPI.CreateFromGitHubResponse = {
      success: true,
      project,
      ...(repository && {
        repository: {
          id: repository.id,
          githubId: repository.githubId
        }
      })
    };
    return addCorsHeaders(Response.json(response), context.origin);

  } catch (error) {
    // Check if this is a GitHub authentication error
    if (error instanceof Error && error.message === 'GITHUB_AUTH_REQUIRED') {
      logger.warn`GitHub authentication required for user ${auth.user.id}`;
      return addCorsHeaders(Response.json({
        success: false,
        error: 'GitHub authentication required',
        code: 'GITHUB_AUTH_REQUIRED'
      }, { status: 401 }), context.origin);
    }

    logger.error`Create project from GitHub failed: ${error}`;
    const response: ProjectAPI.CreateFromGitHubResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    return addCorsHeaders(Response.json(response, { status: 500 }), context.origin);
  }
}

// Get GitHub issues for a project's repository
export async function handleGetIssues(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Get project
    const project = await context.services.projects.getProject(projectId);
    if (!project) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Project not found'
      }, { status: 404 }), context.origin);
    }

    // Check if project has a linked repository
    if (!project.repositoryId) {
      return addCorsHeaders(Response.json({
        success: true,
        issues: []
      }), context.origin);
    }

    // Get repository to get the full name
    const repository = await context.services.repositories.getRepositoryById(project.repositoryId);
    if (!repository) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Repository not found'
      }, { status: 404 }), context.origin);
    }

    // Fetch issues from GitHub
    const issues = await context.services.github.getRepositoryIssues(auth.user.id, repository.fullName);

    return addCorsHeaders(Response.json({
      success: true,
      issues
    }), context.origin);
  } catch (error) {
    // Check if this is a GitHub authentication error
    if (error instanceof Error && error.message === 'GITHUB_AUTH_REQUIRED') {
      logger.warn`GitHub authentication required for user ${auth.user.id} in project ${projectId}`;
      return addCorsHeaders(Response.json({
        success: false,
        error: 'GitHub authentication required',
        code: 'GITHUB_AUTH_REQUIRED'
      }, { status: 401 }), context.origin);
    }

    logger.error`Get issues failed for project ${projectId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get project collaborators with their roles and profile info
export async function handleGetProjectCollaborators(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Get all project members
    const members = await context.services.projects.getProjectMembers(projectId);

    // Enrich with user profile info
    const collaborators = await Promise.all(
      members.map(async (member) => {
        const user = await context.services.users.getUserWithProfile(member.userId);
        return {
          userId: member.userId,
          role: member.role as ProjectRole,
          profile: user?.githubProfile ? {
            name: user.githubProfile.name,
            image: user.githubProfile.image || null
          } : null
        };
      })
    );

    return addCorsHeaders(Response.json({
      success: true,
      collaborators
    }), context.origin);
  } catch (error) {
    logger.error`Get project collaborators failed for project ${projectId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Remove a VISITOR from a project (only VISITORS can be removed, others are managed through GitHub)
export async function handleRemoveCollaborator(
  req: Request,
  context: RequestContext,
  projectId: string,
  userId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check if requesting user is an admin
    const members = await context.services.projects.getProjectMembers(projectId);
    const requestingMember = members.find(m => m.userId === auth.user.id);

    if (!requestingMember || requestingMember.role !== ProjectRole.ADMIN) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Only project admins can remove collaborators'
      }, { status: 403 }), context.origin);
    }

    // Check if target user exists in project
    const targetMember = members.find(m => m.userId === userId);
    if (!targetMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'User is not a collaborator on this project'
      }, { status: 404 }), context.origin);
    }

    // Only allow removing VISITORS - other roles are managed through GitHub
    if (targetMember.role !== ProjectRole.VISITOR) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Can only remove VISITOR role - other roles are managed through GitHub permissions'
      }, { status: 400 }), context.origin);
    }

    // Prevent removing yourself
    if (userId === auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Cannot remove yourself from the project'
      }, { status: 400 }), context.origin);
    }

    // Remove project membership
    await context.services.projects.removeProjectMember(projectId, userId);

    // Remove read access from all agents in this project
    const projectAgents = await context.services.agents.getAllProjectAgents(projectId);
    for (const agent of projectAgents) {
      try {
        await context.services.userAgentAccesses.revokeAccess(userId, agent.id);
      } catch (error) {
        // Ignore if access doesn't exist
        logger.debug`Could not remove access for user ${userId} to agent ${agent.id}: ${error}`;
      }
    }

    logger.info`User ${auth.user.id} removed VISITOR ${userId} from project ${projectId}`;

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Visitor removed successfully'
    }), context.origin);
  } catch (error) {
    logger.error`Remove collaborator failed for project ${projectId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Delete a project and all related data (hard delete)
export async function handleDeleteProject(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check if user is an admin of the project
    const members = await context.services.projects.getProjectMembers(projectId);
    const requestingMember = members.find(m => m.userId === auth.user.id);

    if (!requestingMember || requestingMember.role !== ProjectRole.ADMIN) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Only project admins can delete projects'
      }, { status: 403 }), context.origin);
    }

    // Get the project to check if it exists and get repository info
    const project = await context.services.projects.getProject(projectId);
    if (!project) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Project not found'
      }, { status: 404 }), context.origin);
    }

    // Delete the project (cascade deletes will handle:
    // - ProjectMembers
    // - Agents (and their AgentPrompts, AgentCommits, AgentMessages, UserAgentAccess, AgentAttachments, AgentResets, AgentContextEvents)
    // - PersonalEnvironments (and their PersonalEnvironmentAutomations)
    // - Automations (and their AutomationEvents, PersonalEnvironmentAutomations)
    await context.services.projects.deleteProject(projectId);
    emitProjectDeleted(projectId, auth.user.id);

    // Clean up the repository if it was linked and no other project uses it
    if (project.repositoryId) {
      try {
        const otherProject = await context.services.projects.getProjectByRepository(project.repositoryId);
        if (!otherProject) {
          await context.services.repositories.deleteRepository(project.repositoryId);
        }
      } catch (error) {
        logger.warn`Failed to clean up repository ${project.repositoryId} after project deletion: ${error}`;
      }
    }

    logger.info`Project ${projectId} deleted by user ${auth.user.id}`;

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Project deleted successfully'
    }), context.origin);
  } catch (error) {
    logger.error`Delete project failed for project ${projectId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}