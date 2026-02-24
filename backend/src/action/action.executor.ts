/**
 * Action executor for the schema-driven action system.
 * Validates input, checks authorization, and executes actions.
 *
 * SECURITY: All actions are scoped to user's own data or shared access.
 */

import type {
  ActionInput,
  ActionResponse,
  ActionResult,
  ActionError,
  ActionErrorCode,
  ActionConfig,
  ParamConfig,
} from './action.types';
import { ACTION_CONFIG } from './action.config';
import { getLogger } from '../utils/logger';
import type { EnvironmentJSON } from '../services/personalEnvironment.service';
import type { AutomationTriggerType, AutomationScriptLanguage } from '@shared/types/automation.types';

const logger = getLogger(['action', 'executor']);

/**
 * Minimal interface for agent service operations.
 * Using interface to avoid circular dependencies.
 */
export interface ActionAgentService {
  archiveAgent(agentId: string): Promise<{ success: boolean; error?: string }>;
  queuePrompt(
    agentId: string,
    prompt: { message: string; model?: 'opus' | 'sonnet' | 'haiku'; additionalPlainTextData: string | null },
    userId: string
  ): Promise<void>;
  trashAgent(agentId: string, userId: string): Promise<void>;
  untrashAgent(agentId: string, userId: string): Promise<void>;
  resumeArchivedAgent(agentId: string): Promise<void>;
  userOwnsAgent(agentId: string, userId: string): Promise<boolean>;
  createAgent(params: {
    projectId: string;
    userId: string;
    baseBranch?: string | null;
    name?: string;
    environmentId?: string | null;
  }): Promise<string>;
  startAgent(agentId: string, params: {
    setupType?: string;
    cloneUrl?: string;
    branch?: string;
    baseBranch?: string;
  }, userId: string): Promise<void>;
  interruptAgent(agentId: string, userId: string): Promise<void>;
  revertToCheckpoint(agentId: string, checkpointSha: string): Promise<void>;
  // MCP actions
  getAgentById(agentId: string): Promise<{ id: string; state: string; name: string } | null>;
  waitForAgentState(agentId: string, targetStates: string[], timeoutMs: number): Promise<{ success: boolean; finalState: string; error?: string }>;
  getAgentConversation(agentId: string, limit: number, beforeTimestamp?: number): Promise<ConversationEvent[]>;
}

/** Fork/resume service interface */
export interface ActionAgentMovementsService {
  forkOrResume(params: {
    sourceAgentId: string;
    newOwnerId: string;
    newAgentName?: string;
    forceNewAgent?: boolean;
  }): Promise<{ targetAgentId: string; agent: unknown; message: string }>;
}

/** Environment service interface for MCP actions (uses shared service logic) */
export interface ActionEnvironmentService {
  getAgentEnvironmentAsJSON(agentId: string): Promise<EnvironmentJSON | null>;
  setAgentEnvironmentFromJSON(
    agentId: string,
    userId: string,
    projectId: string,
    json: EnvironmentJSON
  ): Promise<{ success: boolean; error?: string; environmentId?: string }>;
  getDefaultEnvironmentId(projectId: string, userId: string): Promise<string | null>;
}

/** Usage limits service interface */
export interface ActionUsageLimitsService {
  checkAndIncrementUsage(userId: string, resourceType: 'agent' | 'prompt' | 'project'): Promise<{
    allowed: boolean;
    userNotFound?: boolean;
    limitType?: string;
    resourceType?: string;
    current?: number;
    max?: number;
    isMonthlyLimit?: boolean;
  }>;
}

/** Automation config for actions */
export interface ActionAutomationConfig {
  name: string;
  trigger: {
    type: AutomationTriggerType;
    fileGlob?: string;
    commandRegex?: string;
    automationId?: string;
  };
  scriptLanguage: AutomationScriptLanguage;
  scriptContent: string;
  blocking: boolean;
  feedOutput: boolean;
}

/** Automation with data for action results */
export interface ActionAutomation {
  id: string;
  projectId: string;
  userId: string;
  data: ActionAutomationConfig;
  createdAt: Date;
  updatedAt: Date;
}

/** Automation service interface for MCP actions */
export interface ActionAutomationService {
  getProjectAutomations(projectId: string, userId: string): Promise<ActionAutomation[]>;
  getAutomation(automationId: string): Promise<ActionAutomation | null>;
  createAutomation(data: {
    projectId: string;
    userId: string;
    automationData: ActionAutomationConfig;
  }): Promise<ActionAutomation>;
  updateAutomation(automationId: string, data: ActionAutomationConfig): Promise<ActionAutomation | null>;
  deleteAutomation(automationId: string): Promise<void>;
}

/** Port domain service interface (cert-gateway proxy) */
export interface ActionPortDomainService {
  registerPortDomain(agentId: string, port: number, machineSubdomain: string, machineIp: string): Promise<{
    success: boolean;
    url?: string;
    error?: string;
  }>;
  unregisterPortDomain(agentId: string, port: number): Promise<{
    success: boolean;
    error?: string;
  }>;
  getAgentDomainCount(agentId: string): Promise<number>;
}

/** Summarized conversation event for MCP */
export interface ConversationEvent {
  id: string;
  type: 'prompt' | 'response' | 'git_checkpoint' | 'automation' | 'reset';
  timestamp: number;
  taskId: string | null;
  summary: string;
  data: Record<string, unknown>;
}

/**
 * Minimal interface for project service operations.
 */
export interface ActionProjectService {
  createProject(data: { name: string; cloneUrl?: string }): Promise<{ id: string; name: string }>;
  deleteProject(projectId: string): Promise<void>;
  isProjectMember(projectId: string, userId: string): Promise<boolean>;
  upsertProjectMember(data: { projectId: string; userId: string; role: string }): Promise<unknown>;
}

/**
 * Minimal interface for repositories needed by actions.
 */
export interface ActionRepositories {
  agents: {
    getAgentById(
      id: string
    ): Promise<{
      id: string;
      userId: string;
      state: string;
      isTrashed: boolean;
      name: string;
      projectId: string;
      machineUrl?: string | null;
      machineIpv4?: string | null;
    } | null>;
    updateAgentFields(id: string, fields: Record<string, unknown>): Promise<void>;
  };
  userAgentAccesses: {
    hasWriteAccess(userId: string, agentId: string): Promise<boolean>;
  };
  projects: {
    findById(id: string): Promise<{ id: string; name: string; repositoryId?: string | null } | null>;
  };
  repositories: {
    findById(id: string): Promise<{ id: string; baseBranch: string | null } | null>;
  };
  githubTokens: {
    findByUserId(userId: string): Promise<{ accessToken: string } | null>;
  };
  users: {
    findById(id: string): Promise<{ githubProfileId: string | null } | null>;
  };
  projectMembers: {
    userHasAccess(projectId: string, userId: string): Promise<boolean>;
  };
  agentPrompts: {
    getPromptById(id: string): Promise<{ id: string; agentId: string; status: string } | null>;
    deletePrompt(promptId: string): Promise<void>;
  };
}

interface ActionContext {
  userId: string;
  callerAgentId?: string;
  agent?: {
    id: string;
    userId: string;
    state: string;
    isTrashed: boolean;
    name: string;
    projectId: string;
    machineUrl?: string | null;
    machineIpv4?: string | null;
  };
  project?: {
    id: string;
    name: string;
    repositoryId?: string | null;
  };
  prompt?: {
    id: string;
    agentId: string;
    status: string;
  };
}

export class ActionExecutor {
  constructor(
    private agentService: ActionAgentService,
    private projectService: ActionProjectService,
    private repositories: ActionRepositories,
    private agentMovementsService?: ActionAgentMovementsService,
    private environmentService?: ActionEnvironmentService,
    private automationService?: ActionAutomationService,
    private usageLimitsService?: ActionUsageLimitsService,
    private portDomainService?: ActionPortDomainService
  ) {}

  /**
   * Execute an action with user authorization.
   */
  async execute(input: ActionInput, userId: string, callerAgentId?: string): Promise<ActionResponse> {
    logger.info`[ACTION] Executing: action=${input.action}, userId=${userId}`;

    // 1. Validate action exists
    const actionConfig = ACTION_CONFIG[input.action];
    if (!actionConfig) {
      return this.error(
        'INVALID_ACTION',
        `Unknown action: ${input.action}. Available: ${Object.keys(ACTION_CONFIG).join(', ')}`
      );
    }

    // 2. Validate parameters
    const paramResult = this.validateParams(input.params, actionConfig);
    if (!paramResult.success) {
      return paramResult.error;
    }

    // 3. Authorization based on target entity type
    let context: ActionContext = { userId, callerAgentId };

    if (actionConfig.targetEntity === 'agent' && actionConfig.targetIdParam) {
      const agentId = input.params[actionConfig.targetIdParam] as string;
      const agent = await this.repositories.agents.getAgentById(agentId);
      if (!agent) {
        return this.error('NOT_FOUND', `Agent not found: ${agentId}`);
      }
      context.agent = agent;
      // Prevent agents from acting on themselves for dangerous actions (prevents recursive loops)
      // Allow: forkAgent, renameAgent, getAgentConversation, interruptAgent
      const selfAllowedActions = ['forkAgent', 'renameAgent', 'getAgentConversation', 'interruptAgent'];
      if (context.callerAgentId && agentId === context.callerAgentId && !selfAllowedActions.includes(input.action)) {
        return this.error('INVALID_PARAM', 'Agent cannot act on itself');
      }

      // Authorization check for agent
      const authResult = await this.checkAgentAuthorization(agent, actionConfig, userId);
      if (!authResult.success) return authResult.error;

      // State validation
      const stateResult = this.checkAgentState(agent, actionConfig);
      if (!stateResult.success) return stateResult.error;

    } else if (actionConfig.targetEntity === 'project' && actionConfig.targetIdParam) {
      const projectId = input.params[actionConfig.targetIdParam] as string;
      const project = await this.repositories.projects.findById(projectId);
      if (!project) {
        return this.error('NOT_FOUND', `Project not found: ${projectId}`);
      }
      context.project = project;

      // Authorization check for project
      const isMember = await this.repositories.projectMembers.userHasAccess(projectId, userId);
      if (!isMember) {
        return this.error('UNAUTHORIZED', 'You are not a member of this project');
      }

    } else if (actionConfig.targetEntity === 'prompt' && actionConfig.targetIdParam) {
      const promptId = input.params[actionConfig.targetIdParam] as string;
      const prompt = await this.repositories.agentPrompts.getPromptById(promptId);
      if (!prompt) {
        return this.error('NOT_FOUND', `Prompt not found: ${promptId}`);
      }
      context.prompt = prompt;

      // Get agent for authorization
      const agent = await this.repositories.agents.getAgentById(prompt.agentId);
      if (!agent) {
        return this.error('NOT_FOUND', `Agent not found for prompt`);
      }
      context.agent = agent;

      // Authorization: must have write access to the agent
      const authResult = await this.checkAgentAuthorization(agent, actionConfig, userId);
      if (!authResult.success) return authResult.error;

    } else if (actionConfig.scopeType === 'user_only') {
      // No entity required, just authenticated user
    } else if (actionConfig.scopeType === 'caller_agent') {
      // Self-action: operates on the calling agent
      if (!callerAgentId) {
        return this.error('UNAUTHORIZED', 'This action can only be called by an agent');
      }
      const agent = await this.repositories.agents.getAgentById(callerAgentId);
      if (!agent) {
        return this.error('NOT_FOUND', 'Calling agent not found');
      }
      context.agent = agent;
    }

    // 4. Execute the action
    return this.executeAction(input, actionConfig, context);
  }

  /**
   * Check authorization for agent-targeted actions.
   */
  private async checkAgentAuthorization(
    agent: { id: string; userId: string },
    config: ActionConfig,
    userId: string
  ): Promise<{ success: true } | { success: false; error: ActionError }> {
    const isOwner = agent.userId === userId;

    switch (config.scopeType) {
      case 'agent_owner':
        if (!isOwner) {
          return {
            success: false,
            error: this.error('UNAUTHORIZED', 'You do not own this agent'),
          };
        }
        break;

      case 'agent_write':
        if (!isOwner) {
          const hasWriteAccess =
            await this.repositories.userAgentAccesses.hasWriteAccess(userId, agent.id);
          if (!hasWriteAccess) {
            return {
              success: false,
              error: this.error('UNAUTHORIZED', 'You do not have write access to this agent'),
            };
          }
        }
        break;
    }

    return { success: true };
  }

  /**
   * Validate action parameters.
   */
  private validateParams(
    params: Record<string, unknown>,
    config: ActionConfig
  ): { success: true } | { success: false; error: ActionError } {
    for (const [name, paramConfig] of Object.entries(config.params)) {
      const value = params[name];

      // Check required
      if (
        paramConfig.required &&
        (value === undefined || value === null || value === '')
      ) {
        return {
          success: false,
          error: this.error('MISSING_PARAM', `Missing required parameter: ${name}`),
        };
      }

      if (value === undefined || value === null) continue;

      // Type validation
      const typeResult = this.validateParamType(name, value, paramConfig);
      if (!typeResult.success) {
        return { success: false, error: typeResult.error };
      }
    }

    return { success: true };
  }

  /**
   * Validate parameter type and constraints.
   */
  private validateParamType(
    name: string,
    value: unknown,
    config: ParamConfig
  ): { success: true } | { success: false; error: ActionError } {
    switch (config.type) {
      case 'string':
        if (typeof value !== 'string') {
          return {
            success: false,
            error: this.error('INVALID_PARAM', `${name} must be a string`),
          };
        }
        if (config.minLength && value.length < config.minLength) {
          return {
            success: false,
            error: this.error(
              'INVALID_PARAM',
              `${name} must be at least ${config.minLength} characters`
            ),
          };
        }
        if (config.maxLength && value.length > config.maxLength) {
          return {
            success: false,
            error: this.error(
              'INVALID_PARAM',
              `${name} must be at most ${config.maxLength} characters`
            ),
          };
        }
        break;

      case 'number':
        if (typeof value !== 'number') {
          return {
            success: false,
            error: this.error('INVALID_PARAM', `${name} must be a number`),
          };
        }
        if (config.min !== undefined && value < config.min) {
          return {
            success: false,
            error: this.error(
              'INVALID_PARAM',
              `${name} must be at least ${config.min}`
            ),
          };
        }
        if (config.max !== undefined && value > config.max) {
          return {
            success: false,
            error: this.error(
              'INVALID_PARAM',
              `${name} must be at most ${config.max}`
            ),
          };
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean') {
          return {
            success: false,
            error: this.error('INVALID_PARAM', `${name} must be a boolean`),
          };
        }
        break;

      case 'enum':
        if (!config.enumValues?.includes(value as string)) {
          return {
            success: false,
            error: this.error(
              'INVALID_PARAM',
              `${name} must be one of: ${config.enumValues?.join(', ')}`
            ),
          };
        }
        break;
    }

    return { success: true };
  }

  /**
   * Check agent state requirements.
   */
  private checkAgentState(
    agent: { state: string },
    config: ActionConfig
  ): { success: true } | { success: false; error: ActionError } {
    if (
      config.requiredAgentStates &&
      !config.requiredAgentStates.includes(agent.state)
    ) {
      return {
        success: false,
        error: this.error(
          'INVALID_STATE',
          `Agent must be in state: ${config.requiredAgentStates.join(' or ')}. Current: ${agent.state}`
        ),
      };
    }

    if (
      config.blockedAgentStates &&
      config.blockedAgentStates.includes(agent.state)
    ) {
      return {
        success: false,
        error: this.error(
          'INVALID_STATE',
          `Cannot perform this action when agent is ${agent.state}`
        ),
      };
    }

    return { success: true };
  }

  /**
   * Execute the action.
   */
  private async executeAction(
    input: ActionInput,
    config: ActionConfig,
    context: ActionContext
  ): Promise<ActionResponse> {
    const { userId, agent, project, prompt } = context;

    try {
      switch (input.action) {
        case 'sendPrompt': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId, prompt: promptText, model } = input.params as {
            agentId: string;
            prompt: string;
            model?: 'opus' | 'sonnet' | 'haiku';
          };
          // Already checked above, but double-check here
          if (context.callerAgentId && agentId === context.callerAgentId) {
            return this.error('INVALID_PARAM', 'Agent cannot send prompt to itself');
          }
          await this.agentService.queuePrompt(
            agentId,
            { message: promptText, model: model || 'sonnet', additionalPlainTextData: null },
            userId
          );
          // Auto-resume archived agents after queuing prompt
          if (agent.state === 'archived') {
            this.agentService.resumeArchivedAgent(agentId).catch(err => {
              console.error(`[ActionExecutor] Failed to auto-resume archived agent ${agentId}:`, err);
            });
            return this.success(
              'sendPrompt',
              `Prompt queued for archived agent "${agent.name}". Agent is being resumed and will process it when ready.`,
              { agentId, wasArchived: true }
            );
          }
          return this.success(
            'sendPrompt',
            `Prompt sent to agent "${agent.name}". The agent will process it.`,
            { agentId }
          );
        }

        case 'archiveAgent': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId } = input.params as { agentId: string };
          const result = await this.agentService.archiveAgent(agentId);
          if (!result.success) {
            return this.error('EXECUTION_ERROR', result.error || 'Failed to archive agent');
          }
          return this.success('archiveAgent', `Agent "${agent.name}" archived successfully.`, { agentId });
        }

        case 'resumeAgent': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId } = input.params as { agentId: string };
          await this.agentService.resumeArchivedAgent(agentId);
          return this.success(
            'resumeAgent',
            `Agent "${agent.name}" is being resumed. It may take a moment to provision.`,
            { agentId }
          );
        }

        case 'renameAgent': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId, name } = input.params as { agentId: string; name: string };
          await this.repositories.agents.updateAgentFields(agentId, { name });
          return this.success('renameAgent', `Agent renamed to "${name}".`, { agentId, name });
        }

        case 'trashAgent': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId } = input.params as { agentId: string };
          await this.agentService.trashAgent(agentId, userId);
          return this.success('trashAgent', `Agent "${agent.name}" moved to trash.`, { agentId });
        }

        case 'restoreAgent': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId } = input.params as { agentId: string };
          await this.agentService.untrashAgent(agentId, userId);
          return this.success('restoreAgent', `Agent "${agent.name}" restored from trash.`, { agentId });
        }

        case 'interruptAgent': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId } = input.params as { agentId: string };
          await this.agentService.interruptAgent(agentId, userId);
          return this.success('interruptAgent', `Agent "${agent.name}" has been interrupted.`, { agentId });
        }

        case 'revertToCheckpoint': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId, commitSha } = input.params as { agentId: string; commitSha: string };
          await this.agentService.revertToCheckpoint(agentId, commitSha);
          return this.success(
            'revertToCheckpoint',
            `Agent "${agent.name}" reverted to commit ${commitSha.substring(0, 7)}.`,
            { agentId, commitSha }
          );
        }

        case 'createAgent': {
          if (!project) return this.error('NOT_FOUND', 'Project not found');
          const { projectId, name, baseBranch } = input.params as {
            projectId: string;
            name?: string;
            baseBranch?: string;
          };
          let resolvedBaseBranch = baseBranch || null;
          if (!resolvedBaseBranch && project.repositoryId) {
            const repository = await this.repositories.repositories.findById(project.repositoryId);
            if (repository?.baseBranch) {
              resolvedBaseBranch = repository.baseBranch;
            } else {
              return this.error(
                'INVALID_PARAM',
                `Project "${project.name}" has no default branch. Please provide a baseBranch.`
              );
            }
          }
          if (context.callerAgentId && project.repositoryId) {
            const user = await this.repositories.users.findById(userId);
            const githubProfileId = user?.githubProfileId;
            if (!githubProfileId) {
              return this.error(
                'INVALID_PARAM',
                `Project "${project.name}" requires GitHub access. Please connect GitHub and try again.`
              );
            }
            const githubToken = await this.repositories.githubTokens.findByUserId(githubProfileId);
            if (!githubToken?.accessToken) {
              return this.error(
                'INVALID_PARAM',
                `Project "${project.name}" requires GitHub access. Please connect GitHub and try again.`
              );
            }
          }
          // Get default environment for this project/user
          let defaultEnvironmentId: string | null = null;
          if (this.environmentService) {
            try {
              defaultEnvironmentId = await this.environmentService.getDefaultEnvironmentId(projectId, userId);
            } catch (err) {
              console.warn(`[createAgent] Failed to get default environment:`, err);
            }
          }
          const newAgentId = await this.agentService.createAgent({
            projectId,
            userId,
            baseBranch: resolvedBaseBranch,
            name,
            environmentId: defaultEnvironmentId,
          });
          return this.success(
            'createAgent',
            `Agent created successfully in project "${project.name}".`,
            { agentId: newAgentId, projectId }
          );
        }

        case 'startAgent': {
          if (!agent) return this.error('NOT_FOUND', 'Agent not found');
          const { agentId, setupType, cloneUrl, branch, baseBranch } = input.params as {
            agentId: string;
            setupType?: string;
            cloneUrl?: string;
            branch?: string;
            baseBranch?: string;
          };

          await this.agentService.startAgent(
            agentId,
            {
              setupType: cloneUrl ? 'git-clone-public' : (setupType || 'existing'),
              cloneUrl,
              branch,
              baseBranch,
            },
            userId
          );

          return this.success(
            'startAgent',
            `Agent "${agent.name}" started successfully.`,
            { agentId }
          );
        }

        case 'createProject': {
          const { name, cloneUrl } = input.params as { name: string; cloneUrl: string };
          const newProject = await this.projectService.createProject({ name, cloneUrl });
          // Add user as project member
          await this.projectService.upsertProjectMember({
            projectId: newProject.id,
            userId,
            role: 'ADMIN',
          });
          return this.success(
            'createProject',
            `Project "${name}" created successfully.`,
            { projectId: newProject.id, name }
          );
        }

        case 'deleteProject': {
          if (!project) return this.error('NOT_FOUND', 'Project not found');
          const { projectId } = input.params as { projectId: string };
          await this.projectService.deleteProject(projectId);
          return this.success(
            'deleteProject',
            `Project "${project.name}" has been deleted.`,
            { projectId }
          );
        }

        case 'cancelPrompt': {
          if (!prompt) return this.error('NOT_FOUND', 'Prompt not found');
          if (prompt.status !== 'queued') {
            return this.error('INVALID_STATE', `Cannot cancel prompt: status is "${prompt.status}" (must be "queued")`);
          }
          const { promptId } = input.params as { promptId: string };
          await this.repositories.agentPrompts.deletePrompt(promptId);
          return this.success('cancelPrompt', `Prompt cancelled successfully.`, { promptId });
        }

        // === MCP-focused actions ===

        case 'spawnAgent': {
          if (!project) return this.error('NOT_FOUND', 'Project not found');
          const { projectId, baseBranch, name } = input.params as {
            projectId: string;
            baseBranch: string;
            name?: string;
          };

          // Check usage limits before creating agent
          if (this.usageLimitsService) {
            const limitCheck = await this.usageLimitsService.checkAndIncrementUsage(userId, 'agent');
            if (!limitCheck.allowed) {
              if (limitCheck.userNotFound) {
                return this.error('NOT_FOUND', 'User not found');
              }
              return this.error(
                'LIMIT_EXCEEDED' as ActionErrorCode,
                `Agent creation limit reached (${limitCheck.current}/${limitCheck.max} ${limitCheck.limitType || 'agents'}). ` +
                `To increase your limit, go to your profile icon at the top of the app, then "Profile & Subscription" to upgrade your plan.`
              );
            }
          }

          // 1. Get default environment for this project/user
          let defaultEnvironmentId: string | null = null;
          if (this.environmentService) {
            try {
              defaultEnvironmentId = await this.environmentService.getDefaultEnvironmentId(projectId, userId);
            } catch (err) {
              console.warn(`[spawnAgent] Failed to get default environment:`, err);
            }
          }

          // 2. Create the agent (returns immediately, provisioning happens in background)
          const newAgentId = await this.agentService.createAgent({
            projectId,
            userId,
            baseBranch,
            name,
            environmentId: defaultEnvironmentId,
          });

          // 3. Fire-and-forget: wait for provisioned then start
          // This runs in background so spawn returns immediately
          (async () => {
            try {
              const provisionResult = await this.agentService.waitForAgentState(
                newAgentId,
                ['provisioned'],
                0 // no timeout - machines can take minutes to hours to provision
              );
              if (provisionResult.success) {
                await this.agentService.startAgent(newAgentId, { baseBranch }, userId);
              } else {
                console.error(`[spawnAgent] Agent ${newAgentId} failed to provision: ${provisionResult.error}`);
              }
            } catch (err) {
              console.error(`[spawnAgent] Error starting agent ${newAgentId}:`, err);
            }
          })();

          // Return immediately - agent will start in background
          return this.success(
            'spawnAgent',
            `Agent "${name || newAgentId}" created and provisioning. Send prompts immediately - they queue automatically.`,
            { agentId: newAgentId, projectId, baseBranch, state: 'init' }
          );
        }

        case 'forkAgent': {
          if (!this.agentMovementsService) {
            return this.error('EXECUTION_ERROR', 'Fork service not available');
          }
          const { sourceAgentId, name: forkName } = input.params as {
            sourceAgentId: string;
            name?: string;
          };

          const result = await this.agentMovementsService.forkOrResume({
            sourceAgentId,
            newOwnerId: userId,
            newAgentName: forkName,
            forceNewAgent: true,
          });

          return this.success(
            'forkAgent',
            result.message,
            { agentId: result.targetAgentId, sourceAgentId }
          );
        }

        case 'waitForAgentReady': {
          const { agentId, timeoutMs } = input.params as {
            agentId: string;
            timeoutMs?: number;
          };

          const timeout = Math.min(timeoutMs || 120000, 300000);
          const result = await this.agentService.waitForAgentState(
            agentId,
            ['ready', 'idle'],
            timeout
          );

          if (!result.success) {
            return this.error(
              'EXECUTION_ERROR',
              `Agent did not reach ready state: ${result.error || `ended in ${result.finalState}`}`
            );
          }

          return this.success(
            'waitForAgentReady',
            `Agent is now ${result.finalState}.`,
            { agentId, state: result.finalState }
          );
        }

        case 'getAgentConversation': {
          const { agentId, limit, beforeTimestamp } = input.params as {
            agentId: string;
            limit?: number;
            beforeTimestamp?: number;
          };

          const events = await this.agentService.getAgentConversation(
            agentId,
            Math.min(limit || 50, 200),
            beforeTimestamp
          );

          return this.success(
            'getAgentConversation',
            `Retrieved ${events.length} conversation events.`,
            { agentId, events, count: events.length }
          );
        }

        // === Environment self-actions (uses shared service logic) ===

        case 'getMyEnvironment': {
          if (!this.environmentService) {
            return this.error('EXECUTION_ERROR', 'Environment service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const envJson = await this.environmentService.getAgentEnvironmentAsJSON(agent.id);

          if (!envJson) {
            return this.success(
              'getMyEnvironment',
              'No environment configured for this agent.',
              { environment: null }
            );
          }

          return this.success(
            'getMyEnvironment',
            `Environment "${envJson.name}" retrieved.`,
            { environment: envJson }
          );
        }

        case 'setMyEnvironment': {
          if (!this.environmentService) {
            return this.error('EXECUTION_ERROR', 'Environment service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const { environment: envJson } = input.params as { environment: EnvironmentJSON };

          // Basic validation (detailed validation happens in service)
          if (!envJson || typeof envJson !== 'object') {
            return this.error('INVALID_PARAM', 'environment must be a JSON object');
          }
          if (!envJson.name || typeof envJson.name !== 'string') {
            return this.error('INVALID_PARAM', 'environment.name is required and must be a string');
          }
          if (typeof envJson.envContents !== 'string') {
            return this.error('INVALID_PARAM', 'environment.envContents must be a string');
          }
          if (!Array.isArray(envJson.secretFiles)) {
            return this.error('INVALID_PARAM', 'environment.secretFiles must be an array');
          }

          // Delegate to shared service logic
          const result = await this.environmentService.setAgentEnvironmentFromJSON(
            agent.id,
            userId,
            agent.projectId,
            envJson
          );

          if (!result.success) {
            return this.error('EXECUTION_ERROR', result.error || 'Failed to set environment');
          }

          return this.success(
            'setMyEnvironment',
            `Environment "${envJson.name}" configured and applied.`,
            { environmentId: result.environmentId, name: envJson.name }
          );
        }

        // === Automation actions ===

        case 'listAutomations': {
          if (!this.automationService) {
            return this.error('EXECUTION_ERROR', 'Automation service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const automations = await this.automationService.getProjectAutomations(agent.projectId, userId);

          return this.success(
            'listAutomations',
            `Found ${automations.length} automation(s).`,
            {
              automations: automations.map(a => ({
                id: a.id,
                name: a.data.name,
                trigger: a.data.trigger,
                scriptLanguage: a.data.scriptLanguage,
                blocking: a.data.blocking,
                feedOutput: a.data.feedOutput,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
              })),
              count: automations.length
            }
          );
        }

        case 'getAutomation': {
          if (!this.automationService) {
            return this.error('EXECUTION_ERROR', 'Automation service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const { automationId } = input.params as { automationId: string };
          const automation = await this.automationService.getAutomation(automationId);

          if (!automation) {
            return this.error('NOT_FOUND', `Automation not found: ${automationId}`);
          }

          // Verify ownership
          if (automation.userId !== userId) {
            return this.error('UNAUTHORIZED', 'You do not own this automation');
          }

          return this.success(
            'getAutomation',
            `Retrieved automation "${automation.data.name}".`,
            {
              id: automation.id,
              projectId: automation.projectId,
              ...automation.data,
              createdAt: automation.createdAt,
              updatedAt: automation.updatedAt,
            }
          );
        }

        case 'createAutomation': {
          if (!this.automationService) {
            return this.error('EXECUTION_ERROR', 'Automation service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const { automation: automationConfig } = input.params as { automation: ActionAutomationConfig };

          // Basic validation
          if (!automationConfig || typeof automationConfig !== 'object') {
            return this.error('INVALID_PARAM', 'automation must be a JSON object');
          }
          if (!automationConfig.name || typeof automationConfig.name !== 'string') {
            return this.error('INVALID_PARAM', 'automation.name is required');
          }
          if (!automationConfig.trigger || !automationConfig.trigger.type) {
            return this.error('INVALID_PARAM', 'automation.trigger.type is required');
          }
          if (!['bash', 'javascript', 'python'].includes(automationConfig.scriptLanguage)) {
            return this.error('INVALID_PARAM', 'automation.scriptLanguage must be bash, javascript, or python');
          }
          if (typeof automationConfig.scriptContent !== 'string') {
            return this.error('INVALID_PARAM', 'automation.scriptContent is required');
          }
          if (typeof automationConfig.blocking !== 'boolean') {
            return this.error('INVALID_PARAM', 'automation.blocking must be a boolean');
          }
          if (typeof automationConfig.feedOutput !== 'boolean') {
            return this.error('INVALID_PARAM', 'automation.feedOutput must be a boolean');
          }

          const newAutomation = await this.automationService.createAutomation({
            projectId: agent.projectId,
            userId,
            automationData: automationConfig,
          });

          return this.success(
            'createAutomation',
            `Automation "${automationConfig.name}" created.`,
            { automationId: newAutomation.id, name: automationConfig.name }
          );
        }

        case 'updateAutomation': {
          if (!this.automationService) {
            return this.error('EXECUTION_ERROR', 'Automation service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const { automationId: updateId, automation: updateConfig } = input.params as {
            automationId: string;
            automation: ActionAutomationConfig;
          };

          // Check ownership
          const existingAutomation = await this.automationService.getAutomation(updateId);
          if (!existingAutomation) {
            return this.error('NOT_FOUND', `Automation not found: ${updateId}`);
          }
          if (existingAutomation.userId !== userId) {
            return this.error('UNAUTHORIZED', 'You do not own this automation');
          }

          // Full validation
          if (!updateConfig || typeof updateConfig !== 'object') {
            return this.error('INVALID_PARAM', 'automation must be a JSON object');
          }
          if (!updateConfig.name || typeof updateConfig.name !== 'string') {
            return this.error('INVALID_PARAM', 'automation.name is required');
          }
          if (!updateConfig.trigger || !updateConfig.trigger.type) {
            return this.error('INVALID_PARAM', 'automation.trigger.type is required');
          }
          if (!['bash', 'javascript', 'python'].includes(updateConfig.scriptLanguage)) {
            return this.error('INVALID_PARAM', 'automation.scriptLanguage must be bash, javascript, or python');
          }
          if (typeof updateConfig.scriptContent !== 'string') {
            return this.error('INVALID_PARAM', 'automation.scriptContent is required');
          }
          if (typeof updateConfig.blocking !== 'boolean') {
            return this.error('INVALID_PARAM', 'automation.blocking must be a boolean');
          }
          if (typeof updateConfig.feedOutput !== 'boolean') {
            return this.error('INVALID_PARAM', 'automation.feedOutput must be a boolean');
          }

          const updatedAutomation = await this.automationService.updateAutomation(updateId, updateConfig);

          return this.success(
            'updateAutomation',
            `Automation "${updateConfig.name}" updated.`,
            { automationId: updateId, name: updateConfig.name }
          );
        }

        case 'deleteAutomation': {
          if (!this.automationService) {
            return this.error('EXECUTION_ERROR', 'Automation service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const { automationId: deleteId } = input.params as { automationId: string };

          // Check ownership
          const automationToDelete = await this.automationService.getAutomation(deleteId);
          if (!automationToDelete) {
            return this.error('NOT_FOUND', `Automation not found: ${deleteId}`);
          }
          if (automationToDelete.userId !== userId) {
            return this.error('UNAUTHORIZED', 'You do not own this automation');
          }

          await this.automationService.deleteAutomation(deleteId);

          return this.success(
            'deleteAutomation',
            `Automation "${automationToDelete.data.name}" deleted.`,
            { automationId: deleteId }
          );
        }

        // === Port domain management ===

        case 'registerPortDomain': {
          if (!this.portDomainService) {
            return this.error('EXECUTION_ERROR', 'Port domain service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const { port } = input.params as { port: number };

          // Check agent has machine assigned
          if (!agent.machineUrl) {
            return this.error('INVALID_STATE', 'Agent has no machine URL - cannot register port domain');
          }

          // Extract subdomain from machineUrl (e.g., https://frazil-pneuma-rallye.on.ariana.dev -> frazil-pneuma-rallye)
          const machineSubdomain = agent.machineUrl
            .replace(/^https?:\/\//, '')
            .replace(/\.[^.]+\.ariana\.dev.*$/, '');

          if (!machineSubdomain || !agent.machineIpv4) {
            return this.error('INVALID_STATE', 'Agent missing machine subdomain or IP');
          }

          // Check domain count limit (50 per agent)
          const currentCount = await this.portDomainService.getAgentDomainCount(agent.id);
          if (currentCount >= 50) {
            return this.error(
              'LIMIT_EXCEEDED' as ActionErrorCode,
              `Port domain limit reached (50 max per agent). Current: ${currentCount}`
            );
          }

          const result = await this.portDomainService.registerPortDomain(
            agent.id,
            port,
            machineSubdomain,
            agent.machineIpv4
          );

          if (!result.success) {
            return this.error('EXECUTION_ERROR', result.error || 'Failed to register port domain');
          }

          return this.success(
            'registerPortDomain',
            `Port ${port} registered at ${result.url || `${machineSubdomain}-${port}.ariana.dev`}`,
            { port, url: result.url, count: currentCount + 1 }
          );
        }

        case 'unregisterPortDomain': {
          if (!this.portDomainService) {
            return this.error('EXECUTION_ERROR', 'Port domain service not available');
          }
          if (!agent) {
            return this.error('NOT_FOUND', 'Agent context not found');
          }

          const { port } = input.params as { port: number };

          const result = await this.portDomainService.unregisterPortDomain(agent.id, port);

          if (!result.success) {
            return this.error('EXECUTION_ERROR', result.error || 'Failed to unregister port domain');
          }

          return this.success(
            'unregisterPortDomain',
            `Port ${port} subdomain unregistered.`,
            { port }
          );
        }

        default:
          return this.error('INVALID_ACTION', `Action not implemented: ${input.action}`);
      }
    } catch (err) {
      logger.error`Action execution error: ${err}`;
      const message = err instanceof Error ? err.message : 'Unknown error';
      return this.error('EXECUTION_ERROR', message);
    }
  }

  private success(action: string, message: string, data?: Record<string, unknown>): ActionResult {
    logger.info`[ACTION] Success: ${action} - ${message}`;
    return { success: true, action, message, data };
  }

  private error(code: ActionErrorCode, message: string): ActionError {
    logger.warn`[ACTION] Error: ${code} - ${message}`;
    return { success: false, error: message, code };
  }
}
