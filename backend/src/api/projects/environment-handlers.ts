// Personal environment handlers

import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';
import { ProjectRole } from '@shared/types';
import type { EnvironmentData } from '@/data/repositories/personalEnvironment.repository';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

const logger = getLogger(['api', 'projects', 'environments']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

// Helper to enrich environment with owner info
async function enrichEnvironmentWithOwner(
  env: { id: string; projectId: string; userId: string; isDefault: boolean; createdAt: Date | null; updatedAt: Date | null; parsedData: any },
  services: ServiceContainer
) {
  const owner = await services.users.getUserWithProfile(env.userId);
  return {
    owner: owner?.githubProfile ? {
      id: owner.id,
      name: owner.githubProfile.name,
      image: owner.githubProfile.image || null
    } : {
      id: owner?.id || env.userId,
      name: 'Anonymous',
      image: null
    }
  };
}

// Helper function to get user's project role
async function getUserProjectRole(
  services: ServiceContainer,
  projectId: string,
  userId: string
): Promise<ProjectRole | null> {
  const members = await services.projects.getProjectMembers(projectId);
  const member = members.find(m => m.userId === userId);
  return member ? (member.role as ProjectRole) : null;
}

// Get user's environments for a project
export async function handleGetEnvironments(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check project membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Get user's environments for this project (environments are private to the user)
    const environments = await context.services.personalEnvironments.getProjectEnvironments(projectId, auth.user.id);

    // Populate automations and owner info for each environment
    const environmentsWithData = await Promise.all(environments.map(async (env) => {
      const automations = await context.services.automations.getAutomationsForEnvironment(env.id);
      const ownerInfo = await enrichEnvironmentWithOwner(env, context.services);
      return {
        id: env.id,
        projectId: env.projectId,
        userId: env.userId,
        isDefault: env.isDefault,
        createdAt: env.createdAt,
        updatedAt: env.updatedAt,
        ...env.parsedData,
        ...ownerInfo,
        automations: automations.map(a => ({
          id: a.id,
          ...a.parsedData
        }))
      };
    }));

    return addCorsHeaders(Response.json({
      success: true,
      environments: environmentsWithData
    }), context.origin);
  } catch (error) {
    logger.error`Get environments failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get a single environment
// Note: Project members can view any environment in the project (for template agents)
// but only the owner can modify it
export async function handleGetEnvironment(
  req: Request,
  context: RequestContext,
  projectId: string,
  environmentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check project membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Get the environment
    const environment = await context.services.personalEnvironments.getEnvironment(environmentId);

    // Verify environment exists and belongs to the project
    // Note: We allow reading environments owned by other users (for template agents)
    if (!environment || environment.projectId !== projectId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Environment not found'
      }, { status: 404 }), context.origin);
    }

    // Populate automations and owner info
    const automations = await context.services.automations.getAutomationsForEnvironment(environment.id);
    const ownerInfo = await enrichEnvironmentWithOwner(environment, context.services);

    return addCorsHeaders(Response.json({
      success: true,
      environment: {
        id: environment.id,
        projectId: environment.projectId,
        userId: environment.userId,
        isDefault: environment.isDefault,
        createdAt: environment.createdAt,
        updatedAt: environment.updatedAt,
        ...environment.parsedData,
        ...ownerInfo,
        automations: automations.map(a => ({
          id: a.id,
          ...a.parsedData
        }))
      }
    }), context.origin);
  } catch (error) {
    logger.error`Get environment failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Create an environment
export async function handleCreateEnvironment(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as EnvironmentData;

    const { name, envContents, secretFiles } = body;
    if (!name || envContents === undefined) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Name and envContents are required'
      }, { status: 400 }), context.origin);
    }

    // Check project membership
    const userRole = await getUserProjectRole(context.services, projectId, auth.user.id);
    if (!userRole) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // VISITOR role cannot create environments
    if (userRole === ProjectRole.VISITOR) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'VISITOR role cannot create environments. Please sync with GitHub to upgrade permissions.',
        code: 'VISITOR_ROLE_RESTRICTION'
      }, { status: 403 }), context.origin);
    }

    const environment = await context.services.personalEnvironments.createEnvironment({
      projectId,
      userId: auth.user.id,
      environmentData: {
        name,
        envContents,
        secretFiles: secretFiles || []
      }
    });

    // Handle automationIds array (list of automation IDs to install)
    if (body.automationIds && Array.isArray(body.automationIds)) {
      for (const automationId of body.automationIds) {
        try {
          // Verify the automation exists and belongs to this user+project
          const automation = await context.services.automations.getAutomation(automationId);
          if (automation && automation.projectId === projectId && automation.userId === auth.user.id) {
            await context.services.automations.installAutomationToEnvironment(automationId, environment.id);
          } else {
            logger.warn`Skipping automation ${automationId} - not found or access denied`;
          }
        } catch (error) {
          logger.error`Failed to install automation ${automationId} to new environment: ${error}`;
        }
      }
    }

    // Handle automation references from JSON (full automation objects)
    if (body.automations) {
      for (const automationRef of body.automations) {
        // Find automation by name for this user+project
        const allUserAutomations = await context.services.automations.getProjectAutomations(projectId, auth.user.id);
        const automation = allUserAutomations.find(a => a.parsedData.name === automationRef.name);

        if (!automation) {
          // Automation doesn't exist, create it with the full data from JSON
          try {
            const created = await context.services.automations.createAutomation({
              projectId,
              userId: auth.user.id,
              automationData: {
                name: automationRef.name,
                trigger: (automationRef.trigger as any) || { type: 'manual' },
                scriptLanguage: (automationRef.scriptLanguage as any) || 'bash',
                scriptContent: automationRef.scriptContent || '# New automation\necho "Hello"',
                blocking: automationRef.blocking ?? false,
                feedOutput: automationRef.feedOutput ?? true
              }
            });
            // Install to environment
            await context.services.automations.installAutomationToEnvironment(created.id, environment.id);
          } catch (error) {
            logger.error`Failed to create and install new automation from JSON: ${error}`;
          }
        } else {
          // Automation exists, install it
          try {
            await context.services.automations.installAutomationToEnvironment(automation.id, environment.id);
          } catch (error) {
            logger.error`Failed to install automation ${automation.id} to new environment: ${error}`;
          }
        }
      }
    }

    // Get automations for the new environment
    const automations = await context.services.automations.getAutomationsForEnvironment(environment.id);

    return addCorsHeaders(Response.json({
      success: true,
      environment: {
        id: environment.id,
        projectId: environment.projectId,
        userId: environment.userId,
        isDefault: environment.isDefault,
        createdAt: environment.createdAt,
        updatedAt: environment.updatedAt,
        ...environment.parsedData,
        automations: automations.map(a => ({
          id: a.id,
          ...a.parsedData
        }))
      }
    }), context.origin);
  } catch (error) {
    logger.error`Create environment failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Update an environment
export async function handleUpdateEnvironment(
  req: Request,
  context: RequestContext,
  projectId: string,
  environmentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as EnvironmentData;

    // Check project membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Verify environment belongs to user and project
    const environment = await context.services.personalEnvironments.getEnvironment(environmentId);
    if (!environment || environment.projectId !== projectId || environment.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Environment not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Handle automation references from JSON
    if (body.automations) {
      // Get current automations for this environment
      const currentAutomations = await context.services.automations.getAutomationsForEnvironment(environmentId);
      const currentAutomationNames = new Set(currentAutomations.map(a => a.parsedData.name));
      const requestedAutomationNames = new Set(body.automations.map(a => a.name));

      // Uninstall automations that are no longer referenced
      for (const automation of currentAutomations) {
        if (!requestedAutomationNames.has(automation.parsedData.name)) {
          try {
            await context.services.automations.uninstallAutomationFromEnvironment(automation.id, environmentId);
          } catch (error) {
            logger.error`Failed to uninstall automation ${automation.id} from environment ${environmentId}: ${error}`;
          }
        }
      }

      // Get all user automations for lookup by name
      const allUserAutomations = await context.services.automations.getProjectAutomations(projectId, auth.user.id);

      // Install or update referenced automations
      for (const automationRef of body.automations) {
        // Find automation by name for this user+project
        const automation = allUserAutomations.find(a => a.parsedData.name === automationRef.name);

        if (!automation) {
          // Automation doesn't exist, create it with the full data from JSON
          try {
            const created = await context.services.automations.createAutomation({
              projectId,
              userId: auth.user.id,
              automationData: {
                name: automationRef.name,
                trigger: (automationRef.trigger as any) || { type: 'manual' },
                scriptLanguage: (automationRef.scriptLanguage as any) || 'bash',
                scriptContent: automationRef.scriptContent || '# New automation\necho "Hello"',
                blocking: automationRef.blocking ?? false,
                feedOutput: automationRef.feedOutput ?? true
              }
            });
            // Install to environment
            await context.services.automations.installAutomationToEnvironment(created.id, environmentId);
          } catch (error) {
            logger.error`Failed to create and install new automation from JSON: ${error}`;
          }
        } else {
          // Automation exists and belongs to user
          // Update the automation if any fields have changed
          if (automationRef.trigger || automationRef.scriptLanguage ||
              automationRef.scriptContent !== undefined || automationRef.blocking !== undefined ||
              automationRef.feedOutput !== undefined) {
            try {
              await context.services.automations.updateAutomation(automation.id, {
                name: automationRef.name,
                trigger: (automationRef.trigger as any) ?? automation.parsedData.trigger,
                scriptLanguage: (automationRef.scriptLanguage as any) ?? automation.parsedData.scriptLanguage,
                scriptContent: automationRef.scriptContent ?? automation.parsedData.scriptContent,
                blocking: automationRef.blocking ?? automation.parsedData.blocking,
                feedOutput: automationRef.feedOutput ?? automation.parsedData.feedOutput
              });
            } catch (error) {
              logger.error`Failed to update automation ${automation.id} from JSON: ${error}`;
            }
          }
          // Install if not already installed
          const isInstalled = currentAutomations.some(a => a.id === automation.id);
          if (!isInstalled) {
            try {
              await context.services.automations.installAutomationToEnvironment(automation.id, environmentId);
            } catch (error) {
              logger.error`Failed to install automation ${automation.id} to environment ${environmentId}: ${error}`;
            }
          }
        }
      }
    }

    // Update environment data (excluding automations from the data field)
    const { automations: _, ...environmentData } = body;
    const updated = await context.services.personalEnvironments.updateEnvironment(environmentId, environmentData);

    if (!updated) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Failed to update environment'
      }, { status: 500 }), context.origin);
    }

    // Update agents using this environment
    try {
      const agentIds = await context.services.personalEnvironments.getAgentsUsingEnvironment(environmentId);
      for (const agentId of agentIds) {
        try {
          await context.services.agents.updateEnvironmentForAgent(agentId);
        } catch (error) {
          logger.error`Failed to update agent ${agentId} with updated environment: ${error}`;
        }
      }
    } catch (error) {
      logger.error`Failed to update running agents with updated environment: ${error}`;
    }

    // Get automations for the updated environment
    const automations = await context.services.automations.getAutomationsForEnvironment(environmentId);

    return addCorsHeaders(Response.json({
      success: true,
      environment: {
        id: updated.id,
        projectId: updated.projectId,
        userId: updated.userId,
        isDefault: updated.isDefault,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        ...updated.parsedData,
        automations: automations.map(a => ({
          id: a.id,
          ...a.parsedData
        }))
      }
    }), context.origin);
  } catch (error) {
    logger.error`Update environment failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Install environment to an agent
export async function handleInstallEnvironmentToAgent(
  req: Request,
  context: RequestContext,
  projectId: string,
  environmentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as { agentId: string };

    if (!body.agentId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'agentId is required'
      }, { status: 400 }), context.origin);
    }

    // Check project membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Verify environment belongs to user and project
    const environment = await context.services.personalEnvironments.getEnvironment(environmentId);
    if (!environment || environment.projectId !== projectId || environment.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Environment not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Verify agent belongs to user
    const agent = await context.services.agents.getAgent(body.agentId);
    if (!agent || agent.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Install environment to agent
    const result = await context.services.personalEnvironments.installEnvironmentToAgent(environmentId, body.agentId);

    // Update agent's environment variables if running
    if (agent.isRunning) {
      try {
        await context.services.agents.updateEnvironmentForAgent(body.agentId);
      } catch (error) {
        logger.error`Failed to update running agent ${body.agentId} with new environment: ${error}`;
      }
    }

    return addCorsHeaders(Response.json({
      success: true,
      previousEnvironmentId: result.previousEnvironmentId,
      previousEnvironmentName: result.previousEnvironmentName,
      message: 'Environment installed to agent successfully'
    }), context.origin);
  } catch (error) {
    logger.error`Install environment to agent failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Set default environment
export async function handleSetDefaultEnvironment(
  req: Request,
  context: RequestContext,
  projectId: string,
  environmentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check project membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Verify environment belongs to user and project
    const environment = await context.services.personalEnvironments.getEnvironment(environmentId);
    if (!environment || environment.projectId !== projectId || environment.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Environment not found or access denied'
      }, { status: 404 }), context.origin);
    }

    await context.services.personalEnvironments.setDefaultEnvironment(projectId, auth.user.id, environmentId);

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Default environment set successfully'
    }), context.origin);
  } catch (error) {
    logger.error`Set default environment failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Delete an environment
export async function handleDeleteEnvironment(
  req: Request,
  context: RequestContext,
  projectId: string,
  environmentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check project membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Verify environment belongs to user and project
    const environment = await context.services.personalEnvironments.getEnvironment(environmentId);
    if (!environment || environment.projectId !== projectId || environment.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Environment not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Get agents using this environment before deletion
    const agentIds = await context.services.personalEnvironments.getAgentsUsingEnvironment(environmentId);

    await context.services.personalEnvironments.deleteEnvironment(environmentId);

    // Update agents that were using this environment (they'll fall back to default)
    for (const agentId of agentIds) {
      try {
        const agent = await context.services.agents.getAgent(agentId);
        if (agent && agent.isRunning) {
          await context.services.agents.updateEnvironmentForAgent(agentId);
        }
      } catch (error) {
        logger.error`Failed to update agent ${agentId} after deleting environment: ${error}`;
      }
    }

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Environment deleted successfully'
    }), context.origin);
  } catch (error) {
    logger.error`Delete environment failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Generate SSH key pair for environment
export async function handleGenerateSshKey(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check project membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Create temporary directory for key generation
    const tempDir = path.join(os.tmpdir(), `ssh-keygen-${crypto.randomUUID()}`);
    mkdirSync(tempDir, { recursive: true, mode: 0o700 });

    const keyName = 'id_ed25519';
    const keyPath = path.join(tempDir, keyName);
    const pubKeyPath = `${keyPath}.pub`;

    try {
      // Generate ed25519 keypair (no passphrase, non-interactive)
      logger.info`Generating SSH keypair for environment`;

      // Find ssh-keygen command
      let sshKeygenCmd = 'ssh-keygen';
      if (process.platform === 'win32') {
        // On Windows, try to find ssh-keygen in common locations
        const windowsPaths = [
          'C:\\Windows\\System32\\OpenSSH\\ssh-keygen.exe',
          'C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe'
        ];
        for (const winPath of windowsPaths) {
          if (existsSync(winPath)) {
            sshKeygenCmd = winPath;
            break;
          }
        }
      }

      execSync(`"${sshKeygenCmd}" -t ed25519 -f "${keyPath}" -N "" -C "ariana-ide-environment" -q`, {
        encoding: 'utf8'
      });

      // Read both keys
      const privateKey = readFileSync(keyPath, 'utf8');
      const publicKey = readFileSync(pubKeyPath, 'utf8').trim();

      logger.info`SSH keypair generated successfully`;

      return addCorsHeaders(Response.json({
        success: true,
        publicKey,
        privateKey,
        keyName
      }), context.origin);

    } finally {
      // Clean up temporary directory
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        logger.error`Failed to clean up temporary SSH key directory: ${error}`;
      }
    }
  } catch (error) {
    logger.error`Generate SSH key failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate SSH key'
    }, { status: 500 }), context.origin);
  }
}
