// SSH key route handlers - manage SSH keys for agents

import { addCorsHeaders } from '../../middleware/auth';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { getLogger } from '../../utils/logger';
import type { RequestContext } from './handlers';

const logger = getLogger(['api', 'agents', 'ssh']);


export async function handleGetMachineIP(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check READ access
    const hasReadAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasReadAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Get agent
    const agent = await context.services.agents.getAgent(agentId);
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Check if agent machine is running
    if (!agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent machine is not running'
      }, { status: 400 }), context.origin);
    }

    // Return machine IP
    if (!agent.machineIpv4) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Machine IP not available'
      }, { status: 404 }), context.origin);
    }

    logger.info`Returning machine IP for agent ${agentId}: ${agent.machineIpv4}`;

    return addCorsHeaders(Response.json({
      success: true,
      machineIp: agent.machineIpv4
    }), context.origin);

  } catch (error) {
    logger.error`Error fetching machine IP for agent ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 }), context.origin);
  }
}

export async function handleSetSSHKey(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Check WRITE access (only write users can set SSH keys for port forwarding)
    const hasReadAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    const hasWriteAccess = await context.services.userAgentAccesses.hasWriteAccess(auth.user.id, agentId);
    if (!hasReadAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Read access at least required to set SSH keys'
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

    // Check if agent machine is running
    if (!agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent machine is not running'
      }, { status: 400 }), context.origin);
    }

    // Parse and validate request body
    const body = await req.json();
    if (!body.key || typeof body.key !== 'string') {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Missing or invalid key field'
      }, { status: 400 }), context.origin);
    }

    // Basic SSH key validation
    const sshKey = body.key.trim();
    if (!sshKey.startsWith('ssh-') && !sshKey.startsWith('ecdsa-') && !sshKey.startsWith('ssh-dss')) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Invalid SSH key format'
      }, { status: 400 }), context.origin);
    }

    logger.info`Setting SSH key for agent ${agentId} for user ${auth.user.id}`;

    // Forward to agents-server (write access only, so always use 'ariana' user)
    const response = await context.services.agents.sendToAgentServer(
      agent.machineId,
      '/sshkey',
      { key: sshKey, accessLevel: hasWriteAccess ? 'write' : 'read' }
    );

    const data = await response.json();

    if (data.success) {
      logger.info`Set SSH key for agent ${agentId} (user: ${data.user || 'unknown'})`;

      // Add machine IP and SSH user to response
      if (agent.machineIpv4) {
        data.machineIp = agent.machineIpv4;
      }
      // Add SSH username to response so frontend knows which user to connect as
      data.sshUser = 'ariana';
    } else {
      logger.error`Failed to set SSH key for agent ${agentId}: ${data.error}`;
    }

    return addCorsHeaders(Response.json(data, {
      status: response.status
    }), context.origin);

  } catch (error) {
    logger.error`SSH key upload error for agent ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 }), context.origin);
  }
}

export async function handleStartDesktop(
  req: Request,
  context: RequestContext,
  agentId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  const t0 = Date.now();
  const T = () => `[Desktop-BE T+${Date.now() - t0}ms]`;

  try {
    logger.info`${T()} handleStartDesktop() called for agent ${agentId}`;

    // Check READ access (any user with access can view desktop)
    const hasReadAccess = await context.services.userAgentAccesses.hasReadAccess(auth.user.id, agentId);
    if (!hasReadAccess) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found or access denied'
      }, { status: 404 }), context.origin);
    }

    // Get agent
    const dbStart = Date.now();
    const agent = await context.services.agents.getAgent(agentId);
    logger.info`${T()} Agent fetched from DB (took ${Date.now() - dbStart}ms)`;
    if (!agent) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent not found'
      }, { status: 404 }), context.origin);
    }

    // Check if agent machine is running
    if (!agent.machineId) {
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Agent machine is not running'
      }, { status: 400 }), context.origin);
    }

    logger.info`${T()} Agent has cached creds: token=${agent.streamingToken ? 'yes' : 'null'}, hostId=${agent.streamingHostId || 'null'}, appId=${agent.streamingAppId || 'null'}, desktopUrl=${agent.desktopUrl || 'null'}`;

    // Call agent-server /desktop to ensure streaming services are running
    // and validate/refresh credentials (services may have crashed during idle)
    let token = agent.streamingToken;
    let hostId = agent.streamingHostId;
    let appId = agent.streamingAppId;

    try {
      const asStart = Date.now();
      logger.info`${T()} Calling agent-server /desktop on machine ${agent.machineId}...`;
      const agentServerResponse = await context.services.agents.sendToAgentServer(
        agent.machineId,
        '/desktop',
        {},
        30000 // 30s timeout — pairing can be slow if re-pair needed
      );
      const agentServerData = await agentServerResponse.json();
      logger.info`${T()} Agent-server /desktop responded (took ${Date.now() - asStart}ms, success=${agentServerData.success})`;

      if (agentServerData.success) {
        // Use refreshed credentials from agent-server (services confirmed running)
        token = agentServerData.token || token;
        hostId = agentServerData.hostId != null ? String(agentServerData.hostId) : hostId;
        appId = agentServerData.appId != null ? String(agentServerData.appId) : appId;

        // Update DB if credentials changed (e.g. after re-pairing)
        if (token !== agent.streamingToken || hostId !== agent.streamingHostId || appId !== agent.streamingAppId) {
          const dbUpdateStart = Date.now();
          await context.services.agents.updateAgentFields(agentId, {
            streamingToken: token,
            streamingHostId: hostId,
            streamingAppId: appId,
          });
          logger.info`${T()} DB updated with new credentials (took ${Date.now() - dbUpdateStart}ms)`;
        }
      } else {
        logger.warn`${T()} Agent-server /desktop returned error: ${agentServerData.error} — falling back to DB credentials`;
      }
    } catch (err) {
      logger.warn`${T()} Agent-server /desktop call failed (using DB credentials as fallback): ${err}`;
    }

    if (!token || !hostId) {
      logger.warn`${T()} Missing credentials - token: ${!!token}, hostId: ${hostId || 'null'}`;
      return addCorsHeaders(Response.json({
        success: false,
        error: 'Desktop streaming credentials not available for this agent'
      }, { status: 400 }), context.origin);
    }

    const responseData = {
      success: true,
      token,
      hostId: parseInt(hostId, 10),
      appId: appId ? parseInt(appId, 10) : 881448767,
      desktopUrl: agent.desktopUrl || null,
      machineIp: agent.machineIpv4 || null
    };
    logger.info`${T()} Response sent to frontend (total: ${Date.now() - t0}ms)`;

    return addCorsHeaders(Response.json(responseData), context.origin);

  } catch (error) {
    logger.error`Desktop streaming error for agent ${agentId}: ${error}`;
    return addCorsHeaders(Response.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 }), context.origin);
  }
}