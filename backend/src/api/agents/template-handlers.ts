// Template agent handlers

import type { ServiceContainer } from '@/services';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { addCorsHeaders } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';
import { enrichWithCreator, type RequestContext } from './handlers';

const logger = getLogger(['api', 'agents', 'templates']);

const MAX_TEMPLATES_PER_PROJECT = 10;

type TemplateVisibility = 'personal' | 'shared';

/**
 * Mark an agent as a template for the project
 * - Only the agent owner can mark as template
 * - Agent must have a snapshot (required for forking)
 * - For 'shared' visibility: grants read access to all project members
 * - For 'personal' visibility: only visible to the owner
 */
export async function handleMakeAgentTemplate(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Parse visibility from request body
    const body = await req.json().catch(() => ({}));
    const visibility: TemplateVisibility = body.visibility === 'personal' ? 'personal' : 'shared';

    // Get the agent
    const agent = await context.services.repositoryContainer.agents.getAgentById(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Only owner can mark as template
    if (agent.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Only the agent owner can mark it as a template'
      }, { status: 403 }), context.origin);
    }

    // Check if agent already is a template
    if (agent.isTemplate) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent is already a template'
      }, { status: 400 }), context.origin);
    }

    // Check if agent has a snapshot (required for forking)
    const snapshotMachineId = agent.machineId || agent.lastMachineId;
    if (!snapshotMachineId || agent.machineType === 'custom') {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent must have a snapshot to be marked as template',
        code: 'NO_SNAPSHOT'
      }, { status: 400 }), context.origin);
    }

    const hasSnapshot = await context.services.machineSnapshots.hasSnapshot(snapshotMachineId);
    if (!hasSnapshot) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent must have a snapshot to be marked as template',
        code: 'NO_SNAPSHOT'
      }, { status: 400 }), context.origin);
    }

    // Check template limit for the project
    const currentTemplateCount = await context.services.repositoryContainer.agents.countTemplatesByProject(agent.projectId);
    if (currentTemplateCount >= MAX_TEMPLATES_PER_PROJECT) {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Template limit reached (${MAX_TEMPLATES_PER_PROJECT}). Remove a template first.`,
        code: 'TEMPLATE_LIMIT_REACHED'
      }, { status: 400 }), context.origin);
    }

    // Mark agent as template with visibility
    await context.services.repositoryContainer.agents.makeTemplate(agentId, visibility);

    // Only grant read access to project members if visibility is 'shared'
    if (visibility === 'shared') {
      const members = await context.services.projects.getProjectMembers(agent.projectId);
      for (const member of members) {
        if (member.userId !== auth.user.id) {
          // Check if user already has access
          const hasAccess = await context.services.userAgentAccesses.hasReadAccess(member.userId, agentId);
          if (!hasAccess) {
            await context.services.userAgentAccesses.grantAccess({
              userId: member.userId,
              agentId: agentId,
              access: 'read'
            });
          }
        }
      }
    }

    logger.info`Agent ${agentId} marked as ${visibility} template by user ${auth.user.id}`;

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Agent marked as template',
      visibility
    }), context.origin);

  } catch (error) {
    logger.error`Error marking agent as template: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to mark agent as template'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Remove an agent from being a template
 * - Only the agent owner can remove template status
 * - Keeps existing access grants (less disruptive)
 */
export async function handleRemoveAgentTemplate(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Get the agent
    const agent = await context.services.repositoryContainer.agents.getAgentById(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Only owner can remove template status
    if (agent.userId !== auth.user.id) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Only the agent owner can remove template status'
      }, { status: 403 }), context.origin);
    }

    // Check if agent is actually a template
    if (!agent.isTemplate) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent is not a template'
      }, { status: 400 }), context.origin);
    }

    // Remove template status (but keep existing access grants - less disruptive)
    await context.services.repositoryContainer.agents.removeTemplate(agentId);

    logger.info`Agent ${agentId} removed from templates by user ${auth.user.id}`;

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Agent removed from templates'
    }), context.origin);

  } catch (error) {
    logger.error`Error removing agent from templates: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to remove agent from templates'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Get all template agents for a project
 * Returns shared templates visible to all members + personal templates for the current user
 */
export async function handleGetProjectTemplates(
  req: Request,
  context: RequestContext,
  projectId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Verify user is a member of the project
    const members = await context.services.projects.getProjectMembers(projectId);
    const isMember = members.some(m => m.userId === auth.user.id);
    if (!isMember) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied to project'
      }, { status: 403 }), context.origin);
    }

    // Get templates for the project (shared + user's personal templates)
    const templates = await context.services.repositoryContainer.agents.getTemplatesByProject(projectId, auth.user.id);

    // Enrich with creator info and snapshot status
    const enrichedTemplates = await Promise.all(
      templates.map((agent) => enrichWithCreator(agent, context.services))
    );

    return addCorsHeaders(Response.json({
      success: true,
      templates: enrichedTemplates,
      limit: MAX_TEMPLATES_PER_PROJECT
    }), context.origin);

  } catch (error) {
    logger.error`Error fetching project templates: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: 'Failed to fetch templates'
    }, { status: 500 }), context.origin);
  }
}
