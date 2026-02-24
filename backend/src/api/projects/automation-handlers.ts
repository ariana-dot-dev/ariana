// Automation handlers

import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';
import { ProjectRole } from '@shared/types';
import type { AutomationConfig } from '@shared/types/automation.types';

const logger = getLogger(['api', 'projects', 'automations']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
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

// Get user's automations for a project
export async function handleGetAutomations(
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

    // Get user's automations for this project (automations are private to the user)
    const automations = await context.services.automations.getProjectAutomations(projectId, auth.user.id);

    // Return automations with their data
    const automationsWithData = automations.map(automation => ({
      id: automation.id,
      projectId: automation.projectId,
      userId: automation.userId,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt,
      ...automation.parsedData
    }));

    return addCorsHeaders(Response.json({
      success: true,
      automations: automationsWithData
    }), context.origin);
  } catch (error) {
    logger.error`Get automations failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Create an automation
export async function handleCreateAutomation(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as AutomationConfig;

    const { name, trigger, scriptLanguage, scriptContent, blocking, feedOutput } = body;
    if (!name || !trigger || !scriptLanguage || scriptContent === undefined) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Name, trigger, scriptLanguage, and scriptContent are required'
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

    // VISITOR role cannot create automations
    if (userRole === ProjectRole.VISITOR) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'VISITOR role cannot create automations. Please sync with GitHub to upgrade permissions.',
        code: 'VISITOR_ROLE_RESTRICTION'
      }, { status: 403 }), context.origin);
    }

    const automation = await context.services.automations.createAutomation({
      projectId,
      userId: auth.user.id,
      automationData: {
        name,
        trigger,
        scriptLanguage,
        scriptContent,
        blocking: blocking ?? false,
        feedOutput: feedOutput ?? true
      }
    });

    return addCorsHeaders(Response.json({
      success: true,
      automation: {
        id: automation.id,
        projectId: automation.projectId,
        userId: automation.userId,
        createdAt: automation.createdAt,
        updatedAt: automation.updatedAt,
        ...automation.parsedData
      }
    }), context.origin);
  } catch (error) {
    logger.error`Create automation failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Update an automation
export async function handleUpdateAutomation(
  req: Request,
  context: RequestContext,
  projectId: string,
  automationId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as AutomationConfig;

    // Check project membership
    const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    // Verify automation belongs to user and project
    const automation = await context.services.automations.getAutomation(automationId);
    if (!automation || automation.projectId !== projectId || automation.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Automation not found or access denied'
      }, { status: 404 }), context.origin);
    }

    const updated = await context.services.automations.updateAutomation(automationId, body);

    if (!updated) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Failed to update automation'
      }, { status: 500 }), context.origin);
    }

    return addCorsHeaders(Response.json({
      success: true,
      automation: {
        id: updated.id,
        projectId: updated.projectId,
        userId: updated.userId,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        ...updated.parsedData
      }
    }), context.origin);
  } catch (error) {
    logger.error`Update automation failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Install automation to an environment
export async function handleInstallAutomationToEnvironment(
  req: Request,
  context: RequestContext,
  projectId: string,
  automationId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as { environmentId: string };

    if (!body.environmentId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'environmentId is required'
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

    // Verify automation belongs to user and project
    const automation = await context.services.automations.getAutomation(automationId);
    if (!automation || automation.projectId !== projectId || automation.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Automation not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Verify environment belongs to user and project
    const environment = await context.services.personalEnvironments.getEnvironment(body.environmentId);
    if (!environment || environment.projectId !== projectId || environment.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Environment not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Install automation to environment
    await context.services.automations.installAutomationToEnvironment(automationId, body.environmentId);

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Automation installed to environment successfully'
    }), context.origin);
  } catch (error) {
    logger.error`Install automation to environment failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Uninstall automation from an environment
export async function handleUninstallAutomationFromEnvironment(
  req: Request,
  context: RequestContext,
  projectId: string,
  automationId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as { environmentId: string };

    if (!body.environmentId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'environmentId is required'
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

    // Verify automation belongs to user and project
    const automation = await context.services.automations.getAutomation(automationId);
    if (!automation || automation.projectId !== projectId || automation.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Automation not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Uninstall automation from environment
    await context.services.automations.uninstallAutomationFromEnvironment(automationId, body.environmentId);

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Automation uninstalled from environment successfully'
    }), context.origin);
  } catch (error) {
    logger.error`Uninstall automation from environment failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get automations for an environment
export async function handleGetAutomationsForEnvironment(
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

    // Get automations for environment
    const automations = await context.services.automations.getAutomationsForEnvironment(environmentId);

    const automationsWithData = automations.map(automation => ({
      id: automation.id,
      projectId: automation.projectId,
      userId: automation.userId,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt,
      ...automation.parsedData
    }));

    return addCorsHeaders(Response.json({
      success: true,
      automations: automationsWithData
    }), context.origin);
  } catch (error) {
    logger.error`Get automations for environment failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Delete an automation
export async function handleDeleteAutomation(
  req: Request,
  context: RequestContext,
  projectId: string,
  automationId: string,
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

    // Verify automation belongs to user and project
    const automation = await context.services.automations.getAutomation(automationId);
    if (!automation || automation.projectId !== projectId || automation.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Automation not found or access denied'
      }, { status: 404 }), context.origin);
    }

    await context.services.automations.deleteAutomation(automationId);

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Automation deleted successfully'
    }), context.origin);
  } catch (error) {
    logger.error`Delete automation failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Stop a running automation on a specific agent
export async function handleStopAutomation(
  req: Request,
  context: RequestContext,
  projectId: string,
  automationId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json();
    const { agentId } = body;

    if (!agentId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent ID is required'
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

    // Verify automation belongs to user and project
    const automation = await context.services.automations.getAutomation(automationId);
    if (!automation || automation.projectId !== projectId || automation.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Automation not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Get agent and verify access
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent || agent.projectId !== projectId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Verify user has access to the agent
    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'No access to this agent'
      }, { status: 403 }), context.origin);
    }

    // Send stop request to agent machine
    try {
      const stopResponse = await context.services.agents.sendToAgentServer(agent.machineId!, '/stop-automation', {
        automationId: automation.id
      });

      if (!stopResponse.ok) {
        const errorData = await stopResponse.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to stop automation on agent');
      }

      return addCorsHeaders(Response.json({
        success: true,
        message: 'Automation stop request sent successfully'
      }), context.origin);
    } catch (error) {
      logger.error`Failed to send stop request to agent: ${error}`;
      throw new Error(`Failed to communicate with agent: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    logger.error`Stop automation failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Manually trigger an automation on a specific agent
export async function handleTriggerManualAutomation(
  req: Request,
  context: RequestContext,
  projectId: string,
  automationId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json();
    const { agentId } = body;

    if (!agentId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent ID is required'
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

    // Verify automation belongs to user and project
    const automation = await context.services.automations.getAutomation(automationId);
    if (!automation || automation.projectId !== projectId || automation.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Automation not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Any automation can be manually triggered for testing purposes
    // The trigger type just determines when it auto-triggers

    // Get agent and verify access
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent || agent.projectId !== projectId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Verify user has access to the agent
    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'No access to this agent'
      }, { status: 403 }), context.origin);
    }

    // Send trigger request to agent machine
    // First load the automation config, then execute it
    try {
      // Step 1: Load the automation config into agents-server
      const loadResponse = await context.services.agents.sendToAgentServer(agent.machineId!, '/trigger-manual-automation', {
        automationId: automation.id,
        automationName: automation.parsedData.name,
        scriptLanguage: automation.parsedData.scriptLanguage,
        scriptContent: automation.parsedData.scriptContent,
        blocking: automation.parsedData.blocking,
        feedOutput: automation.parsedData.feedOutput
      });

      if (!loadResponse.ok) {
        const errorData = await loadResponse.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to load automation on agent');
      }

      // Step 2: Execute the automation via /execute-automations
      const executeResponse = await context.services.agents.sendToAgentServer(agent.machineId!, '/execute-automations', {
        automationIds: [automation.id],
        triggerType: 'manual',
        context: { automationId: automation.id }
      });

      const executeResult = await executeResponse.json();
      if (!executeResult.success) {
        throw new Error(executeResult.error || 'Failed to execute automation on agent');
      }

      return addCorsHeaders(Response.json({
        success: true,
        message: 'Automation triggered successfully'
      }), context.origin);
    } catch (error) {
      logger.error`Failed to send trigger request to agent: ${error}`;
      throw new Error(`Failed to communicate with agent: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    logger.error`Trigger manual automation failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Feed automation logs to an agent: write output to a temp file on the machine,
// then queue a prompt telling the agent to look at the logs.
export async function handleFeedAutomationLogs(
  req: Request,
  context: RequestContext,
  projectId: string,
  automationId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json();
    const { agentId, output, automationName } = body;

    if (!agentId || !output) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'agentId and output are required'
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

    // Get agent and verify access
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent || agent.projectId !== projectId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    if (!agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent has no running machine'
      }, { status: 400 }), context.origin);
    }

    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'No access to this agent'
      }, { status: 403 }), context.origin);
    }

    // Step 1: Write logs to a temp file on the agent machine
    const writeResponse = await context.services.agents.sendToAgentServer(
      agent.machineId,
      '/write-automation-logs',
      { automationId, automationName: automationName || 'unknown', output }
    );

    const writeResult = await writeResponse.json();
    if (!writeResult.success) {
      throw new Error(writeResult.error || 'Failed to write logs to agent machine');
    }

    const { filePath, lineCount, charCount } = writeResult;

    // Step 2: Queue a prompt telling the agent to look at the logs
    let promptText = `Go see the logs of automation "${automationName || 'unknown'}" in ${filePath}`;
    if (charCount > 10000) {
      promptText += ` which is ${lineCount} lines long. Feel free to just search through it to not fill all your context.`;
    }

    // Queue the prompt with interrupt (like commenting on a diff does)
    await context.services.agents.queuePrompt(agentId, {
      message: promptText,
      additionalPlainTextData: null,
      model: 'sonnet',
    }, auth.user.id);

    // Interrupt the agent so it picks up the prompt immediately
    try {
      await context.services.agents.interruptAgent(agentId, auth.user.id);
    } catch {
      // Agent might not be running, that's fine - prompt will be picked up when idle
    }

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Automation logs fed to agent',
      filePath,
    }), context.origin);
  } catch (error) {
    logger.error`Feed automation logs failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
