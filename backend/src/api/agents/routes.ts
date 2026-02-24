import { ServiceContainer } from '../../services';
import { addCorsHeaders, requireAuthAsync, createAuthErrorResponse } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import {
  handleGetAgents,
  handleGetAgent,
  handleTrashAgent,
  handleUntrashAgent,
  handleRevertAgent,
  handleInterruptAgent,
  handleResetAgent,
  handleGetEvents,
  handleGetMachineInfo,
  handleSendPrompt,
  handleGetAgentAccesses,
  handleGetAgentSharedWith,
  handleExtendAgentLifetime,
  handleForceRebootAgent,
  handleGetUploadProgress,
  handleUploadProjectChunk,
  handleUploadProjectFinalize,
  handleGenerateShareLink,
  handleGrantAgentAccess,
  handleCancelPrompt,
  handleSkipQueue,
  type RequestContext
} from './handlers';
import {
  handleSetSSHKey,
  handleGetMachineIP,
  handleStartDesktop
} from './ssh-handlers';
import {
  handleStartSlopMode,
  handleStopSlopMode
} from './slop-mode-handlers';
import {
  handleStartRalphMode,
  handleStopRalphMode
} from './ralph-mode-handlers';
import {
  handleKeepAlive
} from './keep-alive-handlers';
import {
  handleGetPorts,
  handleSetPortVisibility
} from './port-handlers';
import {
  handleForkAgent
} from './fork-handlers';
import {
  handleGetDiffs
} from './diff-handlers';
import {
  handleGetAgentsSummary
} from './summary-handlers';
import {
  handleMakeAgentTemplate,
  handleRemoveAgentTemplate
} from './template-handlers';
import {
  handleSearchAgents
} from './search-handlers';
import {
  handleGetLuxSteps
} from './lux-handlers';
import { createResourceRateLimit } from '../../middleware/rateLimit';

// Route agent endpoints
export async function handleAgentRoutes(
  req: Request,
  url: URL,
  services: ServiceContainer,
  origin: string | null
): Promise<Response | null> {
  const context: RequestContext = { services, origin };

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return addCorsHeaders(new Response(null, { status: 200 }), origin);
  }

  // Auth check for all agent endpoints
  let auth: AuthenticatedRequest;
  try {
    auth = await requireAuthAsync(req, services);
  } catch (error) {
    return createAuthErrorResponse(error as Error, origin);
  }

  // Note: Agent creation is handled by /api/projects/{id}/agents endpoint

  // Check exact paths BEFORE parsing agent ID to avoid false matches
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    return await handleGetAgents(req, context, auth);
  }

  if (url.pathname === '/api/agents/accesses' && req.method === 'GET') {
    return await handleGetAgentAccesses(req, context, auth);
  }

  if (url.pathname === '/api/agents/grant-access' && req.method === 'POST') {
    return await handleGrantAgentAccess(req, context, auth);
  }

  if (url.pathname === '/api/agents/summary' && req.method === 'GET') {
    return await handleGetAgentsSummary(req, context, auth);
  }

  if (url.pathname === '/api/agents/search' && req.method === 'GET') {
    return await handleSearchAgents(req, context, auth);
  }

  if (url.pathname === '/api/agents/lifetime-unit' && req.method === 'GET') {
    const lifetimeUnitMinutes = parseInt(process.env.AGENT_LIFETIME_UNIT_MINUTES || '20');
    return addCorsHeaders(Response.json({
      success: true,
      lifetimeUnitMinutes
    }), origin);
  }

  if (url.pathname === '/api/agents/keep-alive' && req.method === 'POST') {
    return await handleKeepAlive(req, context, auth);
  }

  // Parse agent ID from path
  const agentIdMatch = url.pathname.match(/^\/api\/agents\/([^\/]+)/);
  const agentId = agentIdMatch ? agentIdMatch[1] : null;

  if (agentId) {
    if (url.pathname === `/api/agents/${agentId}` && req.method === 'GET') {
      return await handleGetAgent(req, context, agentId, auth);
    }
    
    if (url.pathname === `/api/agents/${agentId}` && req.method === 'DELETE') {
      return await handleTrashAgent(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/untrash` && req.method === 'POST') {
      return await handleUntrashAgent(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/prompt` && req.method === 'POST') {
      const promptRateLimit = createResourceRateLimit('prompt');
      return await promptRateLimit(req, context, () => handleSendPrompt(req, context, agentId, auth));
    }

    // Cancel a queued prompt: DELETE /api/agents/:agentId/prompts/:promptId
    const cancelPromptMatch = url.pathname.match(new RegExp(`^/api/agents/${agentId}/prompts/([^/]+)$`));
    if (cancelPromptMatch && req.method === 'DELETE') {
      const promptId = cancelPromptMatch[1];
      return await handleCancelPrompt(req, context, agentId, promptId, auth);
    }

    // Skip queue - interrupt and prioritize a queued prompt: POST /api/agents/:agentId/prompts/:promptId/skip-queue
    const skipQueueMatch = url.pathname.match(new RegExp(`^/api/agents/${agentId}/prompts/([^/]+)/skip-queue$`));
    if (skipQueueMatch && req.method === 'POST') {
      const promptId = skipQueueMatch[1];
      return await handleSkipQueue(req, context, agentId, promptId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/revert` && req.method === 'POST') {
      return await handleRevertAgent(req, context, agentId, auth);
    }
    
    if (url.pathname === `/api/agents/${agentId}/interrupt` && req.method === 'POST') {
      return await handleInterruptAgent(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/reset` && req.method === 'POST') {
      return await handleResetAgent(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/events` && req.method === 'GET') {
      return await handleGetEvents(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/slop-mode/start` && req.method === 'POST') {
      return await handleStartSlopMode(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/slop-mode/stop` && req.method === 'POST') {
      return await handleStopSlopMode(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/ralph-mode/start` && req.method === 'POST') {
      return await handleStartRalphMode(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/ralph-mode/stop` && req.method === 'POST') {
      return await handleStopRalphMode(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/sshkey` && req.method === 'POST') {
      return await handleSetSSHKey(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/machine-ip` && req.method === 'GET') {
      return await handleGetMachineIP(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/upload-progress` && req.method === 'GET') {
      return await handleGetUploadProgress(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/upload-project-chunk` && req.method === 'POST') {
      return await handleUploadProjectChunk(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/upload-project-finalize` && req.method === 'POST') {
      return await handleUploadProjectFinalize(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/ports` && req.method === 'GET') {
      return await handleGetPorts(req, context, agentId, auth);
    }

    // Handle port visibility endpoint: /api/agents/:id/ports/:port/visibility
    const portVisibilityMatch = url.pathname.match(/^\/api\/agents\/[^\/]+\/ports\/(\d+)\/visibility$/);
    if (portVisibilityMatch && req.method === 'POST') {
      const port = parseInt(portVisibilityMatch[1]);
      return await handleSetPortVisibility(req, context, agentId, port, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/machine` && req.method === 'GET') {
      return await handleGetMachineInfo(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/fork` && req.method === 'POST') {
      return await handleForkAgent(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/diffs` && req.method === 'GET') {
      return await handleGetDiffs(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/extend-lifetime` && req.method === 'POST') {
      return await handleExtendAgentLifetime(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/force-reboot` && req.method === 'POST') {
      return await handleForceRebootAgent(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/share-link` && req.method === 'POST') {
      return await handleGenerateShareLink(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/shared-with` && req.method === 'GET') {
      return await handleGetAgentSharedWith(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/start-desktop` && req.method === 'POST') {
      return await handleStartDesktop(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/make-template` && req.method === 'POST') {
      return await handleMakeAgentTemplate(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/remove-template` && req.method === 'POST') {
      return await handleRemoveAgentTemplate(req, context, agentId, auth);
    }

    if (url.pathname === `/api/agents/${agentId}/lux/steps` && req.method === 'GET') {
      return await handleGetLuxSteps(req, context, agentId, auth);
    }
  }

  return null;
}