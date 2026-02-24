// Agent route handlers - typed handlers using AgentService

import type { ServiceContainer } from '@/services';

import type { AgentAPI, ChatEvent, PromptEvent, ResponseEvent, GitCheckpointEvent, ResetEvent, ToolResult, ToolUse, Agent } from '@shared/types';
import { AgentState, ProjectRole } from '@shared/types';
import { addCorsHeaders, createAuthErrorResponse } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';
import type { Prompt } from '@shared/types/agent/prompt.types';

const logger = getLogger(['api', 'agents']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

// Generic helper to enrich any agent type with creator info and snapshot status
export async function enrichWithCreator<T extends Agent>(agent: T, services: ServiceContainer): Promise<T & { creator: { id: string; name: string; image: string | null }; hasSnapshot: boolean }> {
  const creator = await services.users.getUserWithProfile(agent.userId);
  if (!creator) {
    throw new Error('User not found');
  }

  // Check if agent's machine has a snapshot (required for forking)
  // Custom machines and agents without machineId cannot have snapshots
  // For archived agents, machineId is null but lastMachineId preserves the snapshot reference
  let hasSnapshot = false;
  const snapshotMachineId = agent.machineId || agent.lastMachineId;
  if (snapshotMachineId && agent.machineType !== 'custom') {
    hasSnapshot = await services.machineSnapshots.hasSnapshot(snapshotMachineId);
  }

  return {
    ...agent,
    hasSnapshot,
    creator: creator.githubProfile ? {
      id: creator.id,
      name: creator.githubProfile.name,
      image: creator.githubProfile.image || null
    } : {
      id: creator.id,
      name: 'Anonymous',
      image: null
    }
  };
}

// Create agent handler - expects projectId from URL path
export async function handleCreateAgent(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest,
  projectId: string
): Promise<Response> {
  try {
    const body = await req.json() as AgentAPI.CreateRequest;

    // Get project details
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
        success: false,
        error: 'Access denied to project'
      }, { status: 403 }), context.origin);
    }

    // VISITOR role cannot create agents (only access shared ones and fork)
    if (member.role === ProjectRole.VISITOR) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'VISITOR role cannot create agents. Please sync with GitHub to upgrade permissions.',
        code: 'VISITOR_ROLE_RESTRICTION'
      }, { status: 403 }), context.origin);
    }

    // Check machine pool capacity BEFORE decrementing user quota
    const activeMachineCount = await context.services.machinePool.getActiveMachineCount();
    const maxActiveMachines = parseInt(process.env.MAX_ACTIVE_MACHINES!); // Will throw if not set

    if (activeMachineCount >= maxActiveMachines) {
      logger.warn`Machine pool exhausted: ${activeMachineCount}/${maxActiveMachines} active machines`;
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Server is currently at capacity. Please try again in a few minutes.',
        code: 'MACHINE_POOL_EXHAUSTED',
        details: {
          currentMachines: activeMachineCount,
          maxMachines: maxActiveMachines
        }
      }, { status: 503 }), context.origin);
    }

    // Atomically check and increment usage limits (prevents race conditions)
    const limitCheck = await context.services.usageLimits.checkAndIncrementUsage(auth.user.id, 'agent');
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
        error: 'Agent creation limit reached',
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

    // Get default environment for this project/user if one exists
    let defaultEnvironmentId = null;
    try {
      const defaultEnv = await context.services.personalEnvironments.getDefaultEnvironment(projectId, auth.user.id);
      if (defaultEnv) {
        defaultEnvironmentId = defaultEnv.id;
        logger.info `Using default environment ${defaultEnv.id} for new agent`;
      }
    } catch (error) {
      logger.warn `Failed to get default environment: ${error}`;
    }

    const agentId = await context.services.agents.createAgent({
      userId: auth.user.id,
      projectId,
      baseBranch: body.baseBranch || null,
      name: undefined, // name (auto-generated)
      environmentId: defaultEnvironmentId,
      machineType: body.machineType,
      customMachineId: body.customMachineId
    });

    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      throw new Error('Failed to create agent');
    }

    logger.info `Created agent with ID ${agentId} for user ${auth.user.id} - project: ${projectId}`;

    const enrichedAgent = await enrichWithCreator(agent, context.services);

    return addCorsHeaders(Response.json({
      success: true,
      agent: enrichedAgent
    }), context.origin);
  } catch (error) {
    logger.error `Create agent failed: ${error}`;
    if (error instanceof Error) {
      logger.error `Error name: ${error.name}`;
      logger.error `Error message: ${error.message}`;
      logger.error `Error stack: ${error.stack}`;
    }

    const response: AgentAPI.CreateResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };

    const status = error instanceof Error && error.message.includes('limit reached') ? 400 : 500;
    return addCorsHeaders(Response.json(response, { status }), context.origin);
  }
}

export async function handleGetAgents(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get('project');
    const includeProjects = url.searchParams.get('includeProjects') === 'true';

    if (projectId) {
      const isMember = await context.services.projects.isProjectMember(projectId, auth.user.id);
      if (!isMember) {
        return addCorsHeaders(Response.json({
          success: false,
          error: 'Access denied to project'
        }, { status: 403 }), context.origin);
      }

      // Include trashed agents so frontend can display trash section
      const agents = await context.services.agents.getProjectAgents(projectId, auth.user.id, true);
      const enrichedAgents = await Promise.all(agents.map(a => enrichWithCreator(a, context.services)));
      // Cap at 300, most recently prompted first (stable ordering)
      enrichedAgents.sort((a: any, b: any) => new Date(b.lastPromptAt ?? b.createdAt ?? 0).getTime() - new Date(a.lastPromptAt ?? a.createdAt ?? 0).getTime());
      const capped = enrichedAgents.slice(0, 300);

      return addCorsHeaders(Response.json({ success: true, agents: capped }), context.origin);
    } else {
      // Include trashed agents so frontend can display trash section
      const agents = includeProjects
        ? await context.services.agents.getUserAgentsWithProjects(auth.user.id, true)
        : await context.services.agents.getUserAgents(auth.user.id, true);

      const enrichedAgents = await Promise.all(agents.map(a => enrichWithCreator(a, context.services)));
      // Cap at 300, most recently prompted first (stable ordering)
      enrichedAgents.sort((a: any, b: any) => new Date(b.lastPromptAt ?? b.createdAt ?? 0).getTime() - new Date(a.lastPromptAt ?? a.createdAt ?? 0).getTime());
      const capped = enrichedAgents.slice(0, 300);

      return addCorsHeaders(Response.json({ success: true, agents: capped }), context.origin);
    }
  } catch (error) {
    logger.error `Get agents failed: ${error}`;
    return createAuthErrorResponse(error as Error, context.origin);
  }
}

// Get single agent
export async function handleGetAgent(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {

    // Check read access
    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    const enrichedAgent = await enrichWithCreator(agent, context.services);

    return addCorsHeaders(Response.json({
      success: true,
      status: enrichedAgent
    }), context.origin);
  } catch (error) {
    logger.error `Get agent failed: ${error}`;
    return createAuthErrorResponse(error as Error, context.origin);
  }
}

export async function handleSendPrompt(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check write access first
    const hasWrite = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
    if (!hasWrite) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Write access required'
      }, { status: 403 }), context.origin);
    }

    // Get agent to check state
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    const body = await req.json() as AgentAPI.SendPromptRequest;
    const { prompt, mentions, model } = body;

    if (!prompt) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Prompt is required'
      }, { status: 400 }), context.origin);
    }

    // Atomically check and increment usage limits (prevents race conditions)
    const limitCheck = await context.services.usageLimits.checkAndIncrementUsage(auth.user.id, 'prompt');
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
        error: 'Prompt sending limit reached',
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

    let mentionsString = null;

    if (mentions && mentions.length > 0) {
      logger.info `Processing ${mentions.length} mentions for prompt`;
      mentionsString = await context.services.mentions.mentionsToString(
          mentions,
          auth.user.id,
      );
    }

    const promptData: Prompt = {
      message: prompt,
      additionalPlainTextData: mentionsString,
      model: model || 'sonnet' // Default to sonnet if not specified
    };

    // Check if agent is RUNNING but has no human prompt being processed
    // (i.e., it's responding to automation output). In that case, interrupt first.
    if (agent.state === AgentState.RUNNING) {
      const runningPrompts = await context.services.agents.getRunningPrompts(agentId);
      if (runningPrompts.length === 0) {
        // Agent is running but not processing a human prompt - it's responding to automation
        // Interrupt so the new prompt can be processed immediately
        logger.info`Agent ${agentId} is running but has no active human prompt - interrupting for new prompt`;
        await context.services.agents.interruptAgent(agentId, auth.user.id);
      }
    }

    await context.services.agents.queuePrompt(
        agentId,
        promptData,
        auth.user.id
    );

    // If agent is ARCHIVED, the archival check interval (every 500ms in agent.service.ts)
    // will detect the queued prompt and auto-resume the agent.
    if (agent.state === AgentState.ARCHIVED) {
      logger.info`Agent ${agentId} is ARCHIVED - prompt queued, archival check will auto-resume shortly`;
    }

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Prompt queued successfully'
    }), context.origin);
  } catch (error) {
    logger.error `Send prompt failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Start agent handler - unified flow step 2
export async function handleStartAgent(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest,
  agentId: string
): Promise<Response> {
  try {
    const body = await req.json() as {
      baseBranch?: string;
      setupType?: string;
      remotePath?: string;
      cloneUrl?: string;
      branch?: string;
      // Patch-based upload parameters
      commits?: Array<{ title: string; patch: string }>;
      gitHistoryLastPushedCommitSha?: string;
      uncommittedPatch?: string;
    };

    logger.info `Start agent ${agentId}`;

    const ownsAgent = await context.services.agents.userOwnsAgent(agentId, auth.user.id);
    if (!ownsAgent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 403 }), context.origin);
    }

    // Ensure OAuth token is fresh (refreshes if needed and updates config)
    await context.services.claudeOAuth.getValidAccessToken(auth.user.id);

    // Get the active credentials from config
    const { environment, config } = await context.services.users.getActiveCredentials(auth.user.id);

    await context.services.agents.startAgent(agentId, {
      baseBranch: body.baseBranch,
      setupType: body.setupType,
      remotePath: body.remotePath,
      cloneUrl: body.cloneUrl,
      branch: body.branch,
      // Patch-based parameters
      commits: body.commits,
      gitHistoryLastPushedCommitSha: body.gitHistoryLastPushedCommitSha,
      uncommittedPatch: body.uncommittedPatch,
      credentialsEnvironment: environment,
      agentProviderConfig: config
    });

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Agent started successfully'
    }), context.origin);
  } catch (error) {
    logger.error `Start agent failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get upload progress (for resume)
export async function handleGetUploadProgress(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const ownsAgent = await context.services.agents.userOwnsAgent(agentId, auth.user.id);
    if (!ownsAgent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 403 }), context.origin);
    }

    const progress = await context.services.agentUploads.getProgress(agentId);

    return addCorsHeaders(Response.json({
      success: true,
      progress: progress ? {
        chunksReceived: progress.chunksReceived,
        totalChunks: progress.totalChunks
      } : null
    }), context.origin);
  } catch (error) {
    logger.error `Get upload progress failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Upload project chunk
export async function handleUploadProjectChunk(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info `Upload project chunk for agent ${agentId}`;

    const ownsAgent = await context.services.agents.userOwnsAgent(agentId, auth.user.id);
    if (!ownsAgent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 403 }), context.origin);
    }

    const body = await req.json() as {
      chunkIndex: number;
      totalChunks: number;
      chunk: string;
    };

    logger.info `Received chunk ${body.chunkIndex + 1}/${body.totalChunks} (${body.chunk.length} bytes)`;

    // Get agent to find machine ID
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent || !agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent machine not found'
      }, { status: 404 }), context.origin);
    }

    // Init progress tracking on first chunk
    if (body.chunkIndex === 0) {
      await context.services.agentUploads.initUpload(agentId, body.totalChunks);
    }

    // Forward chunk immediately to agents-server (pipeline parallelism)
    const response = await context.services.agents.sendToAgentServer(
      agent.machineId,
      '/upload-project-chunk',
      {
        chunkIndex: body.chunkIndex,
        totalChunks: body.totalChunks,
        chunk: body.chunk
      }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      logger.error `Failed to upload chunk to agents-server: ${result.error || 'Unknown error'}`;
      return addCorsHeaders(Response.json({
        success: false,
        error: result.error || 'Failed to upload chunk'
      }, { status: 500 }), context.origin);
    }

    // Track progress in DB (for resume capability)
    const chunksReceived = await context.services.agentUploads.recordChunkReceived(agentId);

    logger.info `Chunk ${body.chunkIndex + 1}/${body.totalChunks} uploaded successfully (${chunksReceived}/${body.totalChunks} received)`;

    return addCorsHeaders(Response.json({
      success: true,
      chunksReceived,
      totalChunks: body.totalChunks
    }), context.origin);
  } catch (error) {
    logger.error `Upload chunk failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Finalize project upload
export async function handleUploadProjectFinalize(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    logger.info `Finalize project upload for agent ${agentId}`;

    const ownsAgent = await context.services.agents.userOwnsAgent(agentId, auth.user.id);
    if (!ownsAgent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 403 }), context.origin);
    }

    // Get agent to find machine ID
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent || !agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent machine not found'
      }, { status: 404 }), context.origin);
    }

    // Tell agents-server to finalize (reconstruct from filesystem chunks)
    const response = await context.services.agents.sendToAgentServer(
      agent.machineId,
      '/upload-project-finalize',
      {}
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      logger.error `Failed to finalize upload on agents-server: ${result.error || 'Unknown error'}`;
      // Don't cleanup progress on error - allow retry
      return addCorsHeaders(Response.json({
        success: false,
        error: result.error || 'Failed to finalize upload'
      }, { status: 500 }), context.origin);
    }

    // Success - cleanup progress tracking
    await context.services.agentUploads.deleteProgress(agentId);
    logger.info `Project upload finalized and progress cleaned up for agent ${agentId}`;

    return addCorsHeaders(Response.json({
      success: true
    }), context.origin);
  } catch (error) {
    logger.error `Finalize upload failed: ${error}`;

    // Cleanup progress on error
    await context.services.agentUploads.deleteProgress(agentId).catch(() => {});

    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}


// Trash agent (soft delete)
export async function handleTrashAgent(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {

    await context.services.agents.trashAgent(agentId, auth.user.id);

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Agent moved to trash successfully'
    }), context.origin);
  } catch (error) {
    logger.error `Trash agent failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Restore agent from trash
export async function handleUntrashAgent(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {

    await context.services.agents.untrashAgent(agentId, auth.user.id);

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Agent restored from trash successfully'
    }), context.origin);
  } catch (error) {
    logger.error `Restore agent from trash failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Revert agent to checkpoint
export async function handleRevertAgent(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check write access
    const hasWrite = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
    if (!hasWrite) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Write access required'
      }, { status: 403 }), context.origin);
    }

    const body = await req.json() as AgentAPI.RevertRequest;

    const { commitSha } = body;
    if (!commitSha) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Commit SHA is required'
      }, { status: 400 }), context.origin);
    }

    await context.services.agents.revertToCheckpoint(agentId, commitSha);

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Agent reverted to checkpoint successfully'
    }), context.origin);
  } catch (error) {
    logger.error `Revert agent failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Interrupt agent
export async function handleInterruptAgent(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check write access
    const hasWrite = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
    if (!hasWrite) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Write access required'
      }, { status: 403 }), context.origin);
    }

    await context.services.agents.interruptAgent(agentId, auth.user.id);

    return addCorsHeaders(Response.json({
      success: true
    }), context.origin);
  } catch (error) {
    logger.error `Interrupt agent failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Reset agent
export async function handleResetAgent(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Get agent first for validation
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Check write access
    const hasWrite = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
    if (!hasWrite) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Write access required'
      }, { status: 403 }), context.origin);
    }

    // Auto-resume ARCHIVED agents (owner only)
    let currentAgent = agent;
    if (agent.state === AgentState.ARCHIVED) {
      try {
        const result = await context.services.agentMovements.ensureAgentReadyOrResume(agentId, auth.user.id);
        currentAgent = result.agent;
      } catch (error) {
        return addCorsHeaders(Response.json({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to resume agent'
        }, { status: 400 }), context.origin);
      }
    }

    // Validate agent state - only allow reset on operational agents
    const validStates = [AgentState.READY, AgentState.IDLE, AgentState.RUNNING];
    if (!validStates.includes(currentAgent.state as AgentState)) {
      const stateMessages: Record<string, string> = {
        [AgentState.PROVISIONING]: 'Agent is still being created',
        [AgentState.PROVISIONED]: 'Agent is still being prepared',
        [AgentState.CLONING]: 'Agent is still cloning code',
        [AgentState.ERROR]: 'Agent is in an error state'
      };

      return addCorsHeaders(Response.json({
        success: false,
        error: stateMessages[currentAgent.state as AgentState] || 'Agent is not in a valid state for reset'
      }, { status: 400 }), context.origin);
    }

    await context.services.agents.resetAgent(agentId, auth.user.id);

    return addCorsHeaders(Response.json({
      success: true
    }), context.origin);
  } catch (error) {
    logger.error `Reset agent failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get agent events - exact port from old backend
export async function handleGetEvents(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check read access
    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '300', 10), 300);
    const beforeParam = url.searchParams.get('before');
    const before = beforeParam ? parseInt(beforeParam, 10) : undefined;

    // Version check only for latest page (no cursor). Historical pages are immutable.
    if (!before) {
      const clientVersion = parseInt(url.searchParams.get('v') ?? '0', 10);
      const currentVersion = await context.services.agents.getEventsVersion(agentId);
      if (currentVersion !== null && clientVersion === currentVersion) {
        return addCorsHeaders(Response.json({
          success: true,
          unchanged: true,
          eventsVersion: currentVersion
        } satisfies AgentAPI.EventsResponse), context.origin);
      }
    }

    // Paginated query
    const { events, hasMore, oldestTimestamp } = await context.services.agents.getAgentChatEventsPaginated(agentId, { limit, before });
    const eventsVersion = await context.services.agents.getEventsVersion(agentId);

    const response: AgentAPI.EventsResponse = {
      success: true,
      events,
      eventsVersion: eventsVersion ?? 0,
      hasMore,
      oldestTimestamp: oldestTimestamp ?? undefined
    };

    return addCorsHeaders(Response.json(response), context.origin);
  } catch (error) {
    logger.error `Get agent events failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get agent machine info
export async function handleGetMachineInfo(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check read access
    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Access denied'
      }, { status: 403 }), context.origin);
    }

    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    if (!agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent has no machine'
      }, { status: 404 }), context.origin);
    }

    // Return machine info
    const machineInfo = {
      machineId: agent.machineId,
      agentId: agent.id,
      state: agent.isRunning ? 'running' : 'stopped',
      createdAt: agent.createdAt
    };

    return addCorsHeaders(Response.json(machineInfo), context.origin);
  } catch (error) {
    logger.error `Get machine info failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get agent accesses for user
export async function handleGetAgentAccesses(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Get all accesses for this user
    const accesses = await context.services.userAgentAccesses.getUserAccesses(auth.user.id);

    // Get agent details for each access
    const accessesWithDetails = await Promise.all(
      accesses.map(async (access) => {
        const agent = await context.services.agents.getAgent(access.agentId);
        return {
          agentId: access.agentId,
          access: access.access,
          ownerId: agent?.userId || null,
          // Get owner username if needed
          ownerUsername: agent?.userId ? (await context.services.users.getUserWithProfile(agent.userId))?.githubProfile?.name || null : null
        };
      })
    );

    return addCorsHeaders(Response.json({
      success: true,
      accesses: accessesWithDetails
    }), context.origin);
  } catch (error) {
    logger.error `Get agent accesses failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Get all users who have access to a specific agent
export async function handleGetAgentSharedWith(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check if user has read access to the agent
    const hasAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Get all users who have access to this agent
    const accesses = await context.services.userAgentAccesses.getAgentAccesses(agentId);

    // Enrich with user profile information
    const enrichedAccesses = await Promise.all(
      accesses.map(async (access) => {
        const user = await context.services.users.getUserWithProfile(access.userId);
        return {
          userId: access.userId,
          access: access.access,
          profile: user?.githubProfile ? {
            name: user.githubProfile.name,
            image: user.githubProfile.image || null
          } : {
            name: 'Anonymous User',
            image: null
          }
        };
      })
    );

    return addCorsHeaders(Response.json({
      success: true,
      accesses: enrichedAccesses
    }), context.origin);
  } catch (error) {
    logger.error `Get agent shared with failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Extend agent lifetime
export async function handleExtendAgentLifetime(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check if user owns the agent
    const ownsAgent = await context.services.agents.userOwnsAgent(agentId, auth.user.id);
    if (!ownsAgent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 403 }), context.origin);
    }

    // Get agent first
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Parse request body to get hours (optional, defaults to 1 unit)
    const lifetimeUnitMinutes = parseInt(process.env.AGENT_LIFETIME_UNIT_MINUTES || '20');
    let unitsToAdd = 1; // Default to 1 unit for backwards compatibility

    try {
      const body = await req.json();
      if (body.hours && typeof body.hours === 'number' && body.hours > 0) {
        // Convert hours to units (round up)
        const minutesRequested = body.hours * 60;
        unitsToAdd = Math.ceil(minutesRequested / lifetimeUnitMinutes);
      }
    } catch {
      // If no body or parsing fails, use default of 1 unit
    }

    // Check monthly limit only - extending doesn't count toward rate limits
    // We only increment monthly usage ONCE regardless of how many units are added
    // This prevents rate limit issues while still tracking overall monthly usage
    const limitCheck = await context.services.usageLimits.checkMonthlyAgentLimit(auth.user.id);

    if (!limitCheck.allowed) {
      // User doesn't exist in database
      if (limitCheck.userNotFound) {
        return addCorsHeaders(Response.json({
          success: false,
          error: 'User not found'
        }, { status: 404 }), context.origin);
      }

      // Monthly limit exceeded
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent creation limit reached',
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

    // Increment monthly usage by 1 (not by unitsToAdd - we only charge once per extension action)
    await context.services.usageLimits.incrementMonthlyAgentUsage(auth.user.id);

    // Increment lifetimeUnits by the calculated amount
    const newLifetimeUnits = (agent.lifetimeUnits || 1) + unitsToAdd;
    await context.services.agents.updateAgentFields(agentId, {
      lifetimeUnits: newLifetimeUnits
    });

    const totalMinutes = newLifetimeUnits * lifetimeUnitMinutes;
    const totalHours = totalMinutes / 60;
    logger.info `Extended agent ${agentId} lifetime by ${unitsToAdd} units to ${newLifetimeUnits} total units (${totalHours.toFixed(1)} hours)`;

    return addCorsHeaders(Response.json({
      success: true,
      lifetimeUnits: newLifetimeUnits,
      totalMinutes,
      totalHours
    }), context.origin);
  } catch (error) {
    logger.error `Extend agent lifetime failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Force reboot agent (owner only)
export async function handleForceRebootAgent(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check if user owns the agent
    const ownsAgent = await context.services.agents.userOwnsAgent(agentId, auth.user.id);
    if (!ownsAgent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 403 }), context.origin);
    }

    // Get agent to verify state
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Archive the agent first (skip if already archived - just resume it)
    if (agent.state !== AgentState.ARCHIVED) {
      const archiveResult = await context.services.agents.archiveAgent(agentId);
      if (!archiveResult.success) {
        return addCorsHeaders(Response.json({
          success: false,
          error: archiveResult.error || 'Failed to archive agent'
        }, { status: 500 }), context.origin);
      }
      logger.info `Archived agent ${agentId} for force reboot`;
    } else {
      logger.info `Agent ${agentId} already archived, proceeding to reboot/resume`;
    }

    // Now call forkOrResume which will handle the resume since it's now archived
    const result = await context.services.agentMovements.forkOrResume({
      sourceAgentId: agentId,
      newOwnerId: auth.user.id,
      newAgentName: undefined
    });

    logger.info `Force rebooted agent ${agentId} for user ${auth.user.id}`;

    return addCorsHeaders(Response.json({
      success: true,
      targetAgentId: result.targetAgentId,
      agent: result.agent,
      message: 'Agent reboot initiated. A fresh machine is being provisioned.'
    }), context.origin);
  } catch (error) {
    const err = error as any;
    const errorMessage = err?.message || err?.error || (typeof error === 'string' ? error : JSON.stringify(error));
    const errorStack = err?.stack || 'No stack trace';
    logger.error`Force reboot agent failed: ${errorMessage}`;
    logger.error`Force reboot stack trace: ${errorStack}`;

    // Handle specific error cases from agentMovements service
    if (err.code === 'MACHINE_POOL_EXHAUSTED') {
      return addCorsHeaders(Response.json({
        success: false,
        error: err.message,
        code: 'MACHINE_POOL_EXHAUSTED',
        details: err.details
      }, { status: 503 }), context.origin);
    }

    if (err.code === 'LIMIT_EXCEEDED') {
      return addCorsHeaders(Response.json({
        success: false,
        error: err.message,
        code: 'LIMIT_EXCEEDED',
        limitInfo: err.limitInfo
      }, { status: 429 }), context.origin);
    }

    return addCorsHeaders(Response.json({
      success: false,
      error: err.message || 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Generate share link for agent (owner only)
export async function handleGenerateShareLink(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check if user owns the agent
    const ownsAgent = await context.services.agents.userOwnsAgent(agentId, auth.user.id);
    if (!ownsAgent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Only the agent owner can generate share links'
      }, { status: 403 }), context.origin);
    }

    // Get agent to verify it exists and get project ID
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Generate agent access JWT (30 day expiration)
    const shareToken = await context.services.auth.createAgentAccessToken(agentId, 'read');

    // Construct share URL - use backend server URL as base
    // The backend serves both API and frontend in production/staging
    let baseUrl = process.env.SERVER_URL;
    if (!baseUrl) {
      // Fallback to localhost:3000 for development
      baseUrl = 'http://localhost:3000';
    }
    const shareUrl = `${baseUrl}/app/access-agent?token=${encodeURIComponent(shareToken)}&projectId=${agent.projectId}&agentId=${agentId}`;

    logger.info `Generated share link for agent ${agentId} by user ${auth.user.id}`;

    return addCorsHeaders(Response.json({
      success: true,
      shareUrl,
      token: shareToken
    }), context.origin);
  } catch (error) {
    logger.error `Generate share link failed - error: ${error instanceof Error ? error.message : JSON.stringify(error)}, stack: ${error instanceof Error ? error.stack : 'no stack'}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Grant agent access using share token
export async function handleGrantAgentAccess(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const body = await req.json() as { token: string };

    if (!body.token) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Token is required'
      }, { status: 400 }), context.origin);
    }

    // Validate and decode the agent access JWT
    const decoded = await context.services.auth.validateAgentAccessToken(body.token);

    if (!decoded) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Invalid or expired share token'
      }, { status: 401 }), context.origin);
    }

    const { agentId, access } = decoded;

    // Verify agent exists
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Check if user already has access
    const existingAccess = await context.services.userAgentAccesses.getAccess(auth.user.id, agentId);
    if (existingAccess) {
      // User already has access, return success with agent/project info
      return addCorsHeaders(Response.json({
        success: true,
        message: 'Access already granted',
        projectId: agent.projectId,
        agentId: agent.id
      }), context.origin);
    }

    // Grant access
    await context.services.userAgentAccesses.grantAccess({
      userId: auth.user.id,
      agentId,
      access
    });

    // Grant VISITOR project access only if user doesn't already have project access
    // (allows GET /api/projects to return this project)
    const members = await context.services.projects.getProjectMembers(agent.projectId);
    const existingMember = members.find(m => m.userId === auth.user.id);

    if (!existingMember) {
      // User has no project access yet - grant VISITOR role
      // This will be upgraded to READ/WRITE/ADMIN by check-and-link if user has GitHub access
      await context.services.projects.upsertProjectMember({
        projectId: agent.projectId,
        userId: auth.user.id,
        role: ProjectRole.VISITOR
      });
      logger.info `Granted ${access} access to user ${auth.user.id} for agent ${agentId} and VISITOR role for project ${agent.projectId}`;
    } else {
      logger.info `Granted ${access} access to user ${auth.user.id} for agent ${agentId} (already has ${existingMember.role} role for project)`;
    }

    return addCorsHeaders(Response.json({
      success: true,
      projectId: agent.projectId,
      agentId: agent.id
    }), context.origin);
  } catch (error) {
    logger.error `Grant agent access failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Cancel a queued prompt
export async function handleCancelPrompt(
  req: Request,
  context: RequestContext,
  agentId: string,
  promptId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check write access
    const hasWrite = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
    if (!hasWrite) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Write access required'
      }, { status: 403 }), context.origin);
    }

    // Get the prompt
    const prompt = await context.services.agents.getPromptById(promptId);
    if (!prompt) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Prompt not found'
      }, { status: 404 }), context.origin);
    }

    // Verify the prompt belongs to this agent
    if (prompt.agentId !== agentId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Prompt does not belong to this agent'
      }, { status: 400 }), context.origin);
    }

    // Only queued prompts can be cancelled
    if (prompt.status !== 'queued') {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Cannot cancel prompt: status is "${prompt.status}" (must be "queued")`
      }, { status: 400 }), context.origin);
    }

    // Delete the prompt
    await context.services.agents.deletePrompt(promptId);

    return addCorsHeaders(Response.json({
      success: true,
      message: 'Prompt cancelled successfully'
    }), context.origin);
  } catch (error) {
    logger.error `Cancel prompt failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

// Skip queue - interrupt the agent and prioritize a queued prompt
export async function handleSkipQueue(
  req: Request,
  context: RequestContext,
  agentId: string,
  promptId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check write access
    const hasWrite = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
    if (!hasWrite) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Write access required'
      }, { status: 403 }), context.origin);
    }

    // Get agent
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Get the prompt
    const prompt = await context.services.agents.getPromptById(promptId);
    if (!prompt) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Prompt not found'
      }, { status: 404 }), context.origin);
    }

    // Verify the prompt belongs to this agent
    if (prompt.agentId !== agentId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Prompt does not belong to this agent'
      }, { status: 400 }), context.origin);
    }

    // Only queued prompts can be skipped to front
    if (prompt.status !== 'queued') {
      return addCorsHeaders(Response.json({
        success: false,
        error: `Cannot skip queue: prompt status is "${prompt.status}" (must be "queued")`
      }, { status: 400 }), context.origin);
    }

    // Interrupt the agent if it's running
    if (agent.state === AgentState.RUNNING) {
      await context.services.agents.interruptAgent(agentId, auth.user.id);
      logger.info `Agent ${agentId} interrupted for skip queue`;
    }

    // Since we only allow skip queue on the first queued prompt,
    // just interrupting is enough - it will be processed next
    return addCorsHeaders(Response.json({
      success: true,
      message: 'Prompt will be processed next'
    }), context.origin);
  } catch (error) {
    logger.error `Skip queue failed: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}