// Ralph mode handlers - autonomous agent mode that works until task complete

import type { ServiceContainer } from '../../services';
import { addCorsHeaders } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getLogger } from '../../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const logger = getLogger(['api', 'agents', 'ralph-mode']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

interface StartRalphModeRequest {
  taskDescription: string;
}

const RALPH_NOTES_DIR = path.join(os.homedir(), '.ariana-ralph-notes');
const TASK_LOCK_FILE = path.join(RALPH_NOTES_DIR, '.task-lock');
const README_FILE = path.join(RALPH_NOTES_DIR, 'README.md');

/**
 * Start ralph mode for an agent
 * Agent will work autonomously until task is complete or it gets stuck
 */
export async function handleStartRalphMode(
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

    // Get agent to verify it exists
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Parse request body
    const body = await req.json() as StartRalphModeRequest;
    const taskDescription = body.taskDescription?.trim();

    if (!taskDescription) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Task description is required'
      }, { status: 400 }), context.origin);
    }

    // Create ~/.ariana-ralph-notes/ directory and files on the agent's machine
    // This is done via agents-server, not locally on backend
    try {
      await context.services.agents.executeRalphModeSetup(agentId, taskDescription);
    } catch (error) {
      logger.error`Failed to setup ralph mode directory on agent ${agentId}: ${error}`;
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Failed to initialize ralph mode directory on agent machine'
      }, { status: 500 }), context.origin);
    }

    // Check if agent is not idle - interrupt if needed
    const idleStates = ['idle', 'ready'];
    if (!idleStates.includes(agent.state.toLowerCase())) {
      logger.info`Agent ${agentId} is not idle (state: ${agent.state}), interrupting before starting ralph mode`;
      try {
        await context.services.agents.interruptAgent(agentId, auth.user.id);
      } catch (error) {
        logger.warn`Failed to interrupt agent ${agentId}: ${error}`;
        // Continue anyway - the agent may become idle soon
      }
    }

    // Update agent fields
    await context.services.agents.updateAgentFields(agentId, {
      inRalphMode: true,
      ralphModeTaskDescription: taskDescription,
      ralphModeLastPromptAt: null
    });

    logger.info`Agent ${agentId} entered ralph mode with task: ${taskDescription.substring(0, 100)}...`;

    // Queue the initial ralph mode prompt
    await context.services.agents.queueRalphModeInitialPrompt(agentId);

    return addCorsHeaders(Response.json({
      success: true
    }), context.origin);

  } catch (error) {
    logger.error`Failed to start ralph mode for ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}

/**
 * Stop ralph mode for an agent
 */
export async function handleStopRalphMode(
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

    // Get agent to verify it exists
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Update agent to clear ralph mode
    await context.services.agents.updateAgentFields(agentId, {
      inRalphMode: false,
      ralphModeTaskDescription: null,
      ralphModeLastPromptAt: null
    });

    logger.info`Agent ${agentId} exited ralph mode`;

    return addCorsHeaders(Response.json({
      success: true
    }), context.origin);

  } catch (error) {
    logger.error`Failed to stop ralph mode for ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 }), context.origin);
  }
}
