/**
 * Internal API handlers for agent MCP tools.
 * These endpoints are authenticated via internal JWT tokens (not user OAuth).
 *
 * SECURITY: All agents can call these endpoints using short-lived JWTs.
 * Actions and queries are scoped to the user who owns the calling agent.
 */

import type { ServiceContainer } from '@/services';
import { requireInternalAgent } from '@/middleware/internalAgentAuth';
import { QueryExecutor } from '@/query/query.executor';
import { ActionExecutor, type ActionRepositories, type ActionAgentService, type ActionProjectService, type ActionAgentMovementsService, type ActionEnvironmentService, type ActionAutomationService, type ActionUsageLimitsService, type ActionPortDomainService, type ConversationEvent } from '@/action/action.executor';
import type { EnvironmentJSON } from '@/services/personalEnvironment.service';
import type { QueryInput } from '@/query/query.types';
import type { ActionInput } from '@/action/action.types';
import { getLogger } from '@/utils/logger';
import { ProjectRole } from '@shared/types';

const logger = getLogger(['api', 'internal']);

// Actions allowed for MCP tools
// Expand this list as needed - be careful with destructive actions
const MCP_ACTION_ALLOWLIST = new Set([
  // Core agent actions
  'sendPrompt',
  'interruptAgent',
  'renameAgent',
  // MCP-focused orchestration actions
  'spawnAgent',           // Combined create + wait + start
  'forkAgent',            // Fork from existing agent/template
  'waitForAgentReady',    // Wait for agent to reach ready/idle
  'getAgentConversation', // Get summarized conversation history
  // Environment self-actions (agent manages its own environment)
  'getMyEnvironment',     // Get current environment as JSON
  'setMyEnvironment',     // Update environment from JSON (uses shared service logic)
  // Automation self-actions
  'listAutomations',      // List automations for current project/user
  'getAutomation',        // Get automation details by ID
  'createAutomation',     // Create a new automation
  'updateAutomation',     // Update an existing automation
  'deleteAutomation',     // Delete an automation
  // Port domain management (secure cert-gateway proxy)
  'registerPortDomain',   // Register HTTPS subdomain for a port (max 50 per agent)
  'unregisterPortDomain', // Unregister HTTPS subdomain for a port
]);

export interface InternalRequestContext {
  services: ServiceContainer;
}

/**
 * Create ActionRepositories adapter from RepositoryContainer
 */
function createActionRepositories(services: ServiceContainer): ActionRepositories {
  const repos = services.repositoryContainer;

  return {
    agents: {
      getAgentById: async (id: string) => repos.agents.getAgentById(id),
      updateAgentFields: async (id: string, fields: Record<string, unknown>) => repos.agents.updateAgentFields(id, fields as any),
    },
    userAgentAccesses: {
      hasWriteAccess: async (userId: string, agentId: string) => repos.userAgentAccesses.hasWriteAccess(userId, agentId),
    },
    projects: {
      findById: async (id: string) => repos.projects.findById(id),
    },
    repositories: {
      findById: async (id: string) => repos.repositories.findById(id),
    },
    githubTokens: {
      findByUserId: async (userId: string) => repos.githubTokens.findByUserId(userId),
    },
    users: {
      findById: async (id: string) => repos.users.findById(id),
    },
    projectMembers: {
      userHasAccess: async (projectId: string, userId: string) => repos.projectMembers.userHasAccess(projectId, userId),
    },
    agentPrompts: {
      getPromptById: async (id: string) => repos.agentPrompts.getPromptById(id),
      deletePrompt: async (promptId: string) => repos.agentPrompts.deletePrompt(promptId),
    },
  };
}

/**
 * Create ActionAgentService adapter from AgentService
 */
function createActionAgentService(services: ServiceContainer): ActionAgentService {
  const agentService = services.agents;
  const repos = services.repositoryContainer;

  return {
    archiveAgent: (agentId: string) => agentService.archiveAgent(agentId),
    queuePrompt: (agentId: string, prompt: { message: string; model?: 'opus' | 'sonnet' | 'haiku'; additionalPlainTextData: string | null }, userId: string) =>
      agentService.queuePrompt(agentId, prompt, userId),
    trashAgent: (agentId: string, userId: string) => agentService.trashAgent(agentId, userId),
    untrashAgent: (agentId: string, userId: string) => agentService.untrashAgent(agentId, userId),
    resumeArchivedAgent: (agentId: string) => agentService.resumeArchivedAgent(agentId),
    userOwnsAgent: (agentId: string, userId: string) => agentService.userOwnsAgent(agentId, userId),
    createAgent: (params: { projectId: string; userId: string; baseBranch?: string | null; name?: string; environmentId?: string | null }) =>
      agentService.createAgent(params),
    startAgent: async (agentId: string, params: {
      setupType?: string;
      cloneUrl?: string;
      branch?: string;
      baseBranch?: string;
    }, userId: string) => {
      const { environment, config } = await services.users.getActiveCredentials(userId);
      await agentService.startAgent(agentId, {
        setupType: params.setupType,
        cloneUrl: params.cloneUrl,
        branch: params.branch,
        baseBranch: params.baseBranch,
        credentialsEnvironment: environment,
        agentProviderConfig: config,
      });
    },
    interruptAgent: (agentId: string, userId: string) => agentService.interruptAgent(agentId, userId),
    revertToCheckpoint: (agentId: string, checkpointSha: string) => agentService.revertToCheckpoint(agentId, checkpointSha),

    // MCP-specific methods
    getAgentById: async (agentId: string) => {
      const agent = await repos.agents.getAgentById(agentId);
      return agent ? { id: agent.id, state: agent.state, name: agent.name } : null;
    },

    waitForAgentState: async (agentId: string, targetStates: string[], timeoutMs: number) => {
      const startTime = Date.now();
      const pollInterval = 2000; // 2 second polling

      while (timeoutMs <= 0 || Date.now() - startTime < timeoutMs) {
        const agent = await repos.agents.getAgentById(agentId);
        if (!agent) {
          return { success: false, finalState: 'not_found', error: 'Agent not found' };
        }

        if (targetStates.includes(agent.state)) {
          return { success: true, finalState: agent.state };
        }

        // Check for terminal failure states
        if (agent.state === 'error' || agent.state === 'archived') {
          return { success: false, finalState: agent.state, error: `Agent entered ${agent.state} state` };
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      const finalAgent = await repos.agents.getAgentById(agentId);
      return {
        success: false,
        finalState: finalAgent?.state || 'unknown',
        error: 'Timeout waiting for agent state'
      };
    },

    getAgentConversation: async (agentId: string, limit: number, beforeTimestamp?: number): Promise<ConversationEvent[]> => {
      // Fetch events from the database using existing service method
      let events = await agentService.getAgentChatEvents(agentId);

      // Filter by timestamp if provided
      if (beforeTimestamp) {
        events = events.filter(e => e.timestamp < beforeTimestamp);
      }

      // Apply limit
      events = events.slice(0, limit);

      // Transform to summarized format
      return events.map(event => summarizeEvent(event));
    },
  };
}

/**
 * Create ActionAgentMovementsService adapter
 */
function createActionAgentMovementsService(services: ServiceContainer): ActionAgentMovementsService {
  return {
    forkOrResume: (params) => services.agentMovements.forkOrResume(params),
  };
}

/**
 * Create ActionEnvironmentService adapter using shared service methods
 * This uses the same logic as the API handlers (no duplication)
 */
function createActionEnvironmentService(services: ServiceContainer): ActionEnvironmentService {
  return {
    getAgentEnvironmentAsJSON: (agentId: string) =>
      services.personalEnvironments.getEnvironmentAsJSON(agentId, services.automations),

    setAgentEnvironmentFromJSON: (agentId: string, userId: string, projectId: string, json: EnvironmentJSON) =>
      services.personalEnvironments.upsertEnvironmentFromJSON(agentId, userId, projectId, json, {
        automationService: services.automations,
        onEnvironmentUpdated: (agentId) => services.agents.updateEnvironmentForAgent(agentId),
      }),

    getDefaultEnvironmentId: async (projectId: string, userId: string) => {
      const defaultEnv = await services.personalEnvironments.getDefaultEnvironment(projectId, userId);
      return defaultEnv ? defaultEnv.id : null;
    },
  };
}

/**
 * Create ActionAutomationService adapter using shared service methods
 * Maps AutomationWithData (with parsedData) to ActionAutomation (with data)
 */
function createActionAutomationService(services: ServiceContainer): ActionAutomationService {
  // Helper to transform repository format to action format
  const toActionAutomation = (a: { id: string; projectId: string; userId: string; parsedData: any; createdAt: Date | null; updatedAt: Date | null }) => ({
    id: a.id,
    projectId: a.projectId,
    userId: a.userId,
    data: a.parsedData,
    createdAt: a.createdAt || new Date(),
    updatedAt: a.updatedAt || new Date(),
  });

  return {
    getProjectAutomations: async (projectId: string, userId: string) => {
      const automations = await services.automations.getProjectAutomations(projectId, userId);
      return automations.map(toActionAutomation);
    },

    getAutomation: async (automationId: string) => {
      const automation = await services.automations.getAutomation(automationId);
      return automation ? toActionAutomation(automation) : null;
    },

    createAutomation: async (data) => {
      const automation = await services.automations.createAutomation(data);
      return toActionAutomation(automation);
    },

    updateAutomation: async (automationId: string, data) => {
      const automation = await services.automations.updateAutomation(automationId, data);
      return automation ? toActionAutomation(automation) : null;
    },

    deleteAutomation: (automationId: string) =>
      services.automations.deleteAutomation(automationId),
  };
}

/**
 * Create ActionUsageLimitsService adapter
 */
function createActionUsageLimitsService(services: ServiceContainer): ActionUsageLimitsService {
  return {
    checkAndIncrementUsage: (userId: string, resourceType: 'agent' | 'prompt' | 'project') =>
      services.usageLimits.checkAndIncrementUsage(userId, resourceType),
  };
}

/**
 * Create ActionPortDomainService adapter
 */
function createActionPortDomainService(services: ServiceContainer) {
  return {
    registerPortDomain: (agentId: string, port: number, machineSubdomain: string, machineIp: string) =>
      services.portDomains.registerPortDomain(agentId, port, machineSubdomain, machineIp),
    unregisterPortDomain: (agentId: string, port: number) =>
      services.portDomains.unregisterPortDomain(agentId, port),
    getAgentDomainCount: (agentId: string) =>
      services.portDomains.getAgentDomainCount(agentId),
  };
}

/**
 * Summarize a chat event for MCP consumption
 */
function summarizeEvent(event: any): ConversationEvent {
  const base = {
    id: event.id,
    timestamp: event.timestamp,
    taskId: event.taskId || null,
  };

  switch (event.type) {
    case 'prompt':
      return {
        ...base,
        type: 'prompt',
        summary: truncate(event.data.prompt, 200),
        data: {
          status: event.data.status,
          isReverted: event.data.is_reverted,
        },
      };

    case 'response':
      const toolCount = event.data.tools?.length || 0;
      const toolSummaries = (event.data.tools || []).slice(0, 5).map((t: any) => summarizeTool(t));
      return {
        ...base,
        type: 'response',
        summary: truncate(event.data.content || '', 300),
        data: {
          model: event.data.model,
          toolCount,
          tools: toolSummaries,
          isReverted: event.data.is_reverted,
        },
      };

    case 'git_checkpoint':
      return {
        ...base,
        type: 'git_checkpoint',
        summary: `${event.data.commitSha?.substring(0, 7)}: ${truncate(event.data.commitMessage || '', 80)}`,
        data: {
          commitSha: event.data.commitSha,
          branch: event.data.branch,
          filesChanged: event.data.filesChanged,
          additions: event.data.additions,
          deletions: event.data.deletions,
          pushed: event.data.pushed,
        },
      };

    case 'automation':
      const duration = event.data.finishedAt && event.data.startedAt
        ? Math.round((event.data.finishedAt - event.data.startedAt) / 1000)
        : null;
      return {
        ...base,
        type: 'automation',
        summary: `${event.data.automationName} (${event.data.trigger}) - ${event.data.status}${duration ? ` (${duration}s)` : ''}`,
        data: {
          automationId: event.data.automationId,
          name: event.data.automationName,
          trigger: event.data.trigger,
          status: event.data.status,
          exitCode: event.data.exitCode,
          durationSeconds: duration,
          blocking: event.data.blocking,
        },
      };

    case 'reset':
      return {
        ...base,
        type: 'reset',
        summary: 'Conversation reset',
        data: {},
      };

    default:
      return {
        ...base,
        type: event.type,
        summary: `Unknown event: ${event.type}`,
        data: event.data,
      };
  }
}

/**
 * Summarize a tool call for MCP consumption
 */
function summarizeTool(tool: { use: any; result?: any }): { name: string; summary: string } {
  const name = tool.use?.name || 'unknown';
  const input = tool.use?.input || {};

  switch (name) {
    case 'Read':
      return { name, summary: `Read ${getFileName(input.file_path)}` };
    case 'Edit':
    case 'MultiEdit':
      return { name, summary: `Edit ${getFileName(input.file_path)}` };
    case 'Write':
      return { name, summary: `Write ${getFileName(input.file_path)}` };
    case 'Bash':
    case 'BashOutput':
      return { name, summary: `$ ${truncate(input.command || '', 60)}` };
    case 'Grep':
      return { name, summary: `Grep '${truncate(input.pattern || '', 30)}'` };
    case 'Glob':
      return { name, summary: `Glob '${truncate(input.pattern || '', 30)}'` };
    case 'WebSearch':
      return { name, summary: `Search: ${truncate(input.query || '', 40)}` };
    case 'WebFetch':
      return { name, summary: `Fetch: ${truncate(input.url || '', 50)}` };
    case 'Task':
      return { name, summary: `Task: ${truncate(input.description || '', 40)}` };
    default:
      return { name, summary: name };
  }
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.substring(0, maxLen - 3) + '...' : str;
}

function getFileName(filePath: string): string {
  if (!filePath) return 'unknown';
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

/**
 * Create ActionProjectService adapter from ProjectService
 */
function createActionProjectService(services: ServiceContainer): ActionProjectService {
  const projectService = services.projects;

  return {
    createProject: (data: { name: string; cloneUrl?: string }) => projectService.createProject(data),
    deleteProject: (projectId: string) => projectService.deleteProject(projectId),
    isProjectMember: (projectId: string, userId: string) => projectService.isProjectMember(projectId, userId),
    upsertProjectMember: (data: { projectId: string; userId: string; role: ProjectRole }) =>
      projectService.upsertProjectMember(data),
  };
}

/**
 * Handle internal query request from agent MCP tool
 * POST /api/internal/agent/query
 */
export async function handleInternalQuery(
  req: Request,
  context: InternalRequestContext
): Promise<Response> {
  try {
    // 1. Validate internal JWT token
    const claims = requireInternalAgent(req);
    logger.info`Internal query from agentId=${claims.agentId}, userId=${claims.userId}`;

    // 2. Parse request body
    const body = await req.json() as QueryInput;

    // 3. Create QueryExecutor with PrismaClient
    const queryExecutor = new QueryExecutor(context.services.repositoryContainer.prisma);

    // 4. Execute query with user's identity (scoped to their data)
    const result = await queryExecutor.execute(body, claims.userId);

    return Response.json(result);
  } catch (error) {
    logger.error`Internal query error: ${error}`;

    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('token') || message.includes('authorization') ? 401 : 500;

    return Response.json({
      success: false,
      error: message,
      code: status === 401 ? 'UNAUTHORIZED' : 'EXECUTION_ERROR',
    }, { status });
  }
}

/**
 * Handle internal action request from agent MCP tool
 * POST /api/internal/agent/action
 */
export async function handleInternalAction(
  req: Request,
  context: InternalRequestContext
): Promise<Response> {
  try {
    // 1. Validate internal JWT token
    const claims = requireInternalAgent(req);
    logger.info`Internal action from agentId=${claims.agentId}, userId=${claims.userId}`;

    // 2. Parse request body
    const body = await req.json() as ActionInput;
    if (!MCP_ACTION_ALLOWLIST.has(body.action)) {
      return Response.json({
        success: false,
        error: `Action not allowed via MCP: ${body.action}`,
        code: 'UNAUTHORIZED',
      }, { status: 403 });
    }

    // 3. Create ActionExecutor with service adapters
    const actionExecutor = new ActionExecutor(
      createActionAgentService(context.services),
      createActionProjectService(context.services),
      createActionRepositories(context.services),
      createActionAgentMovementsService(context.services),
      createActionEnvironmentService(context.services),
      createActionAutomationService(context.services),
      createActionUsageLimitsService(context.services),
      createActionPortDomainService(context.services)
    );

    // 4. Execute action with user's identity
    const result = await actionExecutor.execute(body, claims.userId, claims.agentId);

    return Response.json(result);
  } catch (error) {
    logger.error`Internal action error: ${error}`;

    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('token') || message.includes('authorization') ? 401 : 500;

    return Response.json({
      success: false,
      error: message,
      code: status === 401 ? 'UNAUTHORIZED' : 'EXECUTION_ERROR',
    }, { status });
  }
}
