// Custom Machine route handlers

import type { ServiceContainer } from '@/services';
import { addCorsHeaders } from '@/middleware/auth';
import type { AuthenticatedRequest } from '@/middleware/auth';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['api', 'machines']);

export interface RequestContext {
  services: ServiceContainer;
  origin: string | null;
}

/**
 * POST /api/machines/generate-registration-token
 * Generate a registration token for a user to install agents-server on their machine
 */
export async function handleGenerateRegistrationToken(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const result = await context.services.customMachines.generateRegistrationToken(auth.user.id);

    return addCorsHeaders(
      Response.json({
        success: true,
        ...result,
      }),
      context.origin
    );
  } catch (error) {
    logger.error`Failed to generate registration token: ${error}`;
    return addCorsHeaders(
      Response.json(
        {
          success: false,
          error: 'Failed to generate registration token',
        },
        { status: 500 }
      ),
      context.origin
    );
  }
}

/**
 * POST /api/machines/register
 * Register a custom machine using a registration token
 * Called by the installation script after detecting machine specs
 */
export async function handleRegisterMachine(
  req: Request,
  context: RequestContext
): Promise<Response> {
  try {
    const body = await req.json();
    const { registrationToken, machineInfo } = body;

    if (!registrationToken || !machineInfo) {
      return addCorsHeaders(
        Response.json(
          {
            success: false,
            error: 'Missing required fields: registrationToken, machineInfo',
          },
          { status: 400 }
        ),
        context.origin
      );
    }

    // Validate machine info
    const { name, os, arch, cpuCount, memoryGB, publicIP, port } = machineInfo;
    if (!name || !os || !arch || typeof cpuCount !== 'number' || typeof memoryGB !== 'number') {
      return addCorsHeaders(
        Response.json(
          {
            success: false,
            error: 'Invalid machine info format',
          },
          { status: 400 }
        ),
        context.origin
      );
    }

    // Validate public IP
    if (!publicIP || publicIP === 'unknown') {
      return addCorsHeaders(
        Response.json(
          {
            success: false,
            error: 'Could not detect public IP address. Please ensure your machine is accessible from the internet.',
          },
          { status: 400 }
        ),
        context.origin
      );
    }

    const result = await context.services.customMachines.registerMachine(
      registrationToken,
      {
        name,
        os,
        arch,
        cpuCount,
        memoryGB,
        ipv4: publicIP,
        port: port || 8911, // Required - default to 8911 if not provided by client
      }
    );

    if (!result) {
      return addCorsHeaders(
        Response.json(
          {
            success: false,
            error: 'Invalid or expired registration token',
          },
          { status: 400 }
        ),
        context.origin
      );
    }

    logger.info`Machine registered: ${result.machineId} for token ${registrationToken}`;

    return addCorsHeaders(
      Response.json({
        success: true,
        ...result,
      }),
      context.origin
    );
  } catch (error) {
    logger.error`Failed to register machine: ${error}`;
    return addCorsHeaders(
      Response.json(
        {
          success: false,
          error: 'Failed to register machine',
        },
        { status: 500 }
      ),
      context.origin
    );
  }
}

/**
 * GET /api/machines
 * Get all custom machines for the authenticated user
 */
export async function handleGetMachines(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    const machines = await context.services.customMachines.getUserMachines(auth.user.id);

    return addCorsHeaders(
      Response.json({
        success: true,
        machines,
      }),
      context.origin
    );
  } catch (error) {
    logger.error`Failed to get machines: ${error}`;
    return addCorsHeaders(
      Response.json(
        {
          success: false,
          error: 'Failed to get machines',
        },
        { status: 500 }
      ),
      context.origin
    );
  }
}

/**
 * GET /api/machines/:id
 * Get a specific custom machine
 */
export async function handleGetMachine(
  req: Request,
  context: RequestContext,
  machineId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Verify ownership
    const isOwner = await context.services.customMachines.verifyOwnership(machineId, auth.user.id);
    if (!isOwner) {
      return addCorsHeaders(
        Response.json(
          {
            success: false,
            error: 'Access denied',
          },
          { status: 403 }
        ),
        context.origin
      );
    }

    const machine = await context.services.customMachines.getMachine(machineId);

    if (!machine) {
      return addCorsHeaders(
        Response.json(
          {
            success: false,
            error: 'Machine not found',
          },
          { status: 404 }
        ),
        context.origin
      );
    }

    return addCorsHeaders(
      Response.json({
        success: true,
        machine,
      }),
      context.origin
    );
  } catch (error) {
    logger.error`Failed to get machine: ${error}`;
    return addCorsHeaders(
      Response.json(
        {
          success: false,
          error: 'Failed to get machine',
        },
        { status: 500 }
      ),
      context.origin
    );
  }
}

/**
 * DELETE /api/machines/:id
 * Delete a custom machine
 */
export async function handleDeleteMachine(
  req: Request,
  context: RequestContext,
  machineId: string,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Verify ownership
    const isOwner = await context.services.customMachines.verifyOwnership(machineId, auth.user.id);
    if (!isOwner) {
      return addCorsHeaders(
        Response.json(
          {
            success: false,
            error: 'Access denied',
          },
          { status: 403 }
        ),
        context.origin
      );
    }

    // Check if machine is currently in use
    const machine = await context.services.customMachines.getMachine(machineId);
    if (machine?.currentAgentId) {
      return addCorsHeaders(
        Response.json(
          {
            success: false,
            error: 'Cannot delete machine while it is in use by an agent',
          },
          { status: 400 }
        ),
        context.origin
      );
    }

    await context.services.customMachines.deleteMachine(machineId);

    logger.info`Machine deleted: ${machineId}`;

    return addCorsHeaders(
      Response.json({
        success: true,
      }),
      context.origin
    );
  } catch (error) {
    logger.error`Failed to delete machine: ${error}`;
    return addCorsHeaders(
      Response.json(
        {
          success: false,
          error: 'Failed to delete machine',
        },
        { status: 500 }
      ),
      context.origin
    );
  }
}

/**
 * POST /api/machines/check-health
 * Check health of all user's custom machines
 * Called by frontend when machines UI is open
 */
export async function handleCheckMachinesHealth(
  req: Request,
  context: RequestContext,
  auth: AuthenticatedRequest
): Promise<Response> {
  try {
    // Get user's machines
    const machines = await context.services.customMachines.getUserMachines(auth.user.id);

    // Check health of each machine
    await Promise.allSettled(
      machines.map((machine) => context.services.customMachines.checkMachineHealth(machine.id))
    );

    // Return updated machines list
    const updatedMachines = await context.services.customMachines.getUserMachines(auth.user.id);

    return addCorsHeaders(
      Response.json({
        success: true,
        machines: updatedMachines,
      }),
      context.origin
    );
  } catch (error) {
    logger.error`Failed to check machines health: ${error}`;
    return addCorsHeaders(
      Response.json(
        {
          success: false,
          error: 'Failed to check machines health',
        },
        { status: 500 }
      ),
      context.origin
    );
  }
}
