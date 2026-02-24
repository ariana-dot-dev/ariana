import { getLogger } from '../utils/logger';
import { RepositoryContainer } from '../data/repositories';
import { GitHubService } from './github.service';
import type { Agent, ConversationMessage, User, AgentProviderConfig } from '../../shared/types';
import { AgentState, getActiveEnvironment } from '../../shared/types';
import { randomBytes } from 'crypto';
import type {
    ClaudeStateResponse,
} from '../../shared/types';
import { machineSDK, type MachineInfo } from '../../agents-server/src/machineSDK';
import type { CommitInfo } from '../../shared/types/agent/commit.types';
import type { UserService } from './user.service';
import { constructCommitUrl } from '../utils/gitUrlParser';
import type { MachinePoolService } from './machinePool.service';
import type { ParkingMetrics } from './machinePool.service';
import type { PersonalEnvironmentService } from './personalEnvironment.service';
import type { ClaudeOAuthService } from './claude-oauth.service';
import type { AuthService } from './auth.service';
import type { Prisma } from '../../generated/prisma';
import { generateInternalAgentToken } from '../middleware/internalAgentAuth';
import { emitAgentEventsChanged } from '../websocket/emit-helpers';
import { calculatePatchStats } from '../utils/patchStats';

const logger = getLogger(['agent']);

/** Timing data returned by pollAgent for benchmark logging */
export interface PollTiming {
    conv: number;
    git: number;
    pr: number;
    auto: number;
    ctx: number;
    store: number;
    msgCount: number;      // total messages from agent-server
    msgProcessed: number;  // messages actually checked (delta)
}


// Autonomous mode prompts - used when agent finishes a task and should continue working
const SLOP_MODE_PROMPT = "You are in autonomous mode. Keep going with this task or other tasks as you see fit. This message is automatic and the human in the loop is away, hence you have to use your own judgement to decide if now you finish what you were doing, improve on it, or jump to something new. Do not do useless things always think before deciding on new things to do. Favor concrete additions or improvements over documentation. Don't necessarily do easy things or small things. Don't use emojis. Don't do something that isn't trully useful. Do what really inspires you and a user would love to see.";

export const RALPH_MODE_PROMPT = `you are in autonomous mode, the human in the loop is away and it's for you to figure things out
regarding your current task:
- ensure it's documented in README.md and other interconnected .md files under ~/.ariana-ralph-notes/, with the README acting mostly as a good starting point, and other files diving into specifics
1. ensure the README.md clearly explains or links to files explaining:
 - what is the task about
 - how to iterate on the task
 - what are the validation criterias (and which one got validated already)
 - what's the last few units of work done
 - (all the above in a concise and noise/bs-free way)
2. we might be starting or continuing that task so figure out where we are in that process
3. go towards finishing the task by solving one problem and solving it well
4. document as you do things for the next agent to be able to dive gradually into what you did, what you learned, not repeat the same mistakes
5. if the task is finished and would like to notify the human or you're dead stuck and need a human to intervene, delete the .task-lock file`;

export class ClaudeAgentService {
    private repositories: RepositoryContainer;
    private githubService: GitHubService;
    private userService: UserService;
    private machinePoolService: MachinePoolService;
    private personalEnvironmentService: PersonalEnvironmentService;
    private claudeOAuthService: ClaudeOAuthService;
    private authService: AuthService;
    private stateTimers = new Map<string, NodeJS.Timeout>();
    private machineFailureCount = new Map<string, number>();
    private readonly MACHINE_FAILURE_THRESHOLD = 5; // After 5 consecutive failures (~15 seconds), transition to ERROR
    // Track last emitted context threshold per agent (for 10% boundary warnings)
    private contextThresholds = new Map<string, number>();
    // Throttle git history polling to once per 10s per agent
    private lastGitHistoryPoll = new Map<string, number>();
    private readonly GIT_HISTORY_INTERVAL_MS = 10_000;
    // Throttle GitHub token refresh to once per 5 min per agent (tokens expire after ~8 hours)
    private lastGithubTokenRefresh = new Map<string, number>();
    private readonly GITHUB_TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
    // Cap poll HTTP calls to prevent slow network from blocking the poll loop
    private readonly POLL_HTTP_TIMEOUT_MS = 1_500;
    // Timeouts for state-logic HTTP calls (non-poll)
    private readonly STATE_HTTP_TIMEOUT_MS = 5_000;
    private readonly COMMIT_HTTP_TIMEOUT_MS = 30_000;
    private readonly PUSH_HTTP_TIMEOUT_MS = 30_000;
    private readonly PROMPT_HTTP_TIMEOUT_MS = 10_000;
    private readonly AUTOMATION_HTTP_TIMEOUT_MS = 10_000;
    // Delta-based message processing: track last known finalized message count per agent
    // to skip re-checking hundreds of already-stored messages every cycle
    private lastProcessedMsgCount = new Map<string, number>();
    // Track agents stuck in RUNNING with 0 messages (ghost agents)
    // Maps agentId -> timestamp when unproductive running was first observed
    private unproductiveRunningStart = new Map<string, number>();
    private readonly UNPRODUCTIVE_RUNNING_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

    constructor(
        repositories: RepositoryContainer,
        githubService: GitHubService,
        userService: UserService,
        machinePoolService: MachinePoolService,
        personalEnvironmentService: PersonalEnvironmentService,
        claudeOAuthService: ClaudeOAuthService,
        authService: AuthService
    ) {
        this.repositories = repositories;
        this.githubService = githubService;
        this.userService = userService;
        this.machinePoolService = machinePoolService;
        this.personalEnvironmentService = personalEnvironmentService;
        this.claudeOAuthService = claudeOAuthService;
        this.authService = authService;
    }

    /**
     * Check if agent is in autonomous mode (slop/ralph) and return the next prompt if so.
     * Returns null if not in autonomous mode or autonomous mode has expired.
     * This is used to send the next prompt directly without transitioning to IDLE.
     */
    private async getAutonomousModePrompt(agent: Agent): Promise<{ message: string; model: 'opus' | 'sonnet' | 'haiku' } | null> {
        const now = new Date();

        // Get the last prompt model for consistency
        const lastPrompts = await this.repositories.agentPrompts.findMany(
            { agentId: agent.id, status: 'finished' },
            { orderBy: { createdAt: 'desc' }, limit: 1 }
        );
        const lastPromptModel = (lastPrompts?.[0]?.model as 'opus' | 'sonnet' | 'haiku') || 'sonnet';

        // Check slop mode first
        if (agent.inSlopModeUntil && agent.inSlopModeUntil.getTime() > now.getTime()) {
            let message = SLOP_MODE_PROMPT;
            if (agent.slopModeCustomPrompt) {
                message += "\n\n" + agent.slopModeCustomPrompt;
            }
            logger.info`Agent ${agent.id} - Slop mode active, will send autonomous prompt directly`;
            return { message, model: lastPromptModel };
        }

        // Check ralph mode
        if (agent.inRalphMode) {
            // Reset memory first (ralph mode clears context each iteration)
            if (agent.machineId) {
                try {
                    const resetResponse = await this.sendToAgentServer(agent.machineId, '/reset', {});
                    const resetData = await resetResponse.json();
                    if (!resetData.success) {
                        logger.warn`Agent ${agent.id} - Failed to clear memory for ralph mode: ${resetData.error}`;
                    }
                } catch (error) {
                    logger.warn`Agent ${agent.id} - Failed to reset for ralph mode: ${error}`;
                }
            }
            logger.info`Agent ${agent.id} - Ralph mode active, will send autonomous prompt directly`;
            return { message: RALPH_MODE_PROMPT, model: lastPromptModel };
        }

        return null;
    }

    async getParkingMetrics(): Promise<ParkingMetrics> {
        return await this.machinePoolService.getParkingMetrics();
    }

    async startupProcedure(): Promise<void> {
        // Delegate to machine pool service first
        await this.machinePoolService.startupProcedure();

        // Restart polling loops for PROVISIONING agents
        // These agents had their async loops killed when the server restarted
        await this.restartProvisioningAgents();

        // Restart PROVISIONED agents that have baseBranch set (branch-based creation)
        // These agents were provisioned but the frontend never called /start
        await this.restartProvisionedBranchAgents();
    }

    private async restartProvisioningAgents(): Promise<void> {
        try {
            logger.info`Checking for PROVISIONING agents to restart...`;

            const agents = await this.repositories.agents.getAllAgents();
            let restartedCount = 0;

            for (const agent of agents) {
                if (agent.state === 'provisioning') {
                    // Restart the polling loop for this agent
                    // provisionMachineAsync will handle getting or creating the reservation
                    // Pass the agent's stored machineType and machineId to preserve custom machine preferences
                    const machineType = agent.machineType as ('hetzner' | 'custom') | null;
                    const machineId = agent.machineId;
                    logger.info`Agent ${agent.id} - Restarting provisioning polling loop (machineType: ${machineType || 'default'})`;
                    this.provisionMachineAsync(agent, machineType || undefined, machineId).catch(async (error) => {
                        logger.error`Agent ${agent.id} - Machine provisioning failed on restart: ${error}`;
                        await this.repositories.agents.updateState(agent.id, AgentState.ERROR);
                    });
                    restartedCount++;
                }
            }

            if (restartedCount > 0) {
                logger.info`Restarted provisioning for ${restartedCount} PROVISIONING agent(s)`;
            } else {
                logger.info`No PROVISIONING agents found to restart`;
            }
        } catch (error) {
            logger.error`Failed to restart PROVISIONING agents: ${error}`;
            // Don't throw - this shouldn't block startup
        }
    }

    /**
     * Restart PROVISIONED agents that have baseBranch set (branch-based creation).
     * These agents were provisioned but the frontend never called /start to begin cloning.
     * This can happen if the server restarted or the frontend disconnected during provisioning.
     */
    private async restartProvisionedBranchAgents(): Promise<void> {
        try {
            logger.info`Checking for PROVISIONED branch-based agents to restart...`;

            const agents = await this.repositories.agents.getAllAgents();
            let restartedCount = 0;

            for (const agent of agents) {
                // Only handle agents in PROVISIONED state with baseBranch set
                if (agent.state === 'provisioned' && agent.baseBranch) {
                    logger.info`Agent ${agent.id} - Found stuck PROVISIONED agent with baseBranch=${agent.baseBranch}, auto-starting...`;

                    try {
                        // Get user credentials to start the agent
                        const { environment, config } = await this.userService.getActiveCredentials(agent.userId);

                        // Call startAgent with the stored baseBranch
                        // This will transition the agent to CLONING and begin the git clone
                        await this.startAgent(agent.id, {
                            baseBranch: agent.baseBranch,
                            credentialsEnvironment: environment,
                            agentProviderConfig: config
                        });

                        restartedCount++;
                        logger.info`Agent ${agent.id} - Successfully restarted branch-based agent`;
                    } catch (error) {
                        logger.error`Agent ${agent.id} - Failed to restart branch-based agent: ${error}`;
                        // Mark as error so user knows something went wrong
                        await this.repositories.agents.updateState(agent.id, AgentState.ERROR);
                    }
                }
            }

            if (restartedCount > 0) {
                logger.info`Restarted ${restartedCount} PROVISIONED branch-based agent(s)`;
            } else {
                logger.info`No PROVISIONED branch-based agents found to restart`;
            }
        } catch (error) {
            logger.error`Failed to restart PROVISIONED branch-based agents: ${error}`;
            // Don't throw - this shouldn't block startup
        }
    }

    async createAgent(
        user: User,
        projectId: string,
        baseBranch?: string | null,
        name?: string,
        environmentId?: string | null,
        machineType?: 'hetzner' | 'custom',
        customMachineId?: string | null
    ): Promise<string> {
        logger.info`Creating new agent - userId: ${user.id}, projectId: ${projectId}, baseBranch: ${baseBranch || 'null'}, name: ${name || 'auto-generated'}, machineType: ${machineType || 'hetzner'}, customMachineId: ${customMachineId || 'null'}`;

        // Create agent in database with PROVISIONING state
        // lifetimeUnits defaults to 1, provisionedAt will be set when PROVISIONED state is reached
        const agent = await this.repositories.agents.createAgentWithReturn({
            projectId,
            userId: user.id,
            state: AgentState.PROVISIONING,
            ...(name && { name })  // Only include name if provided
        });

        // Set baseBranch, environmentId, and machine preferences if provided
        // Store machine preferences immediately so they survive server restarts
        const updates: any = {};
        if (baseBranch) {
            updates.baseBranch = baseBranch;
        }
        if (environmentId) {
            updates.environmentId = environmentId;
        }
        if (machineType) {
            updates.machineType = machineType;
        }
        if (machineType === 'custom' && customMachineId) {
            updates.machineId = customMachineId;
        }
        if (Object.keys(updates).length > 0) {
            await this.repositories.agents.updateAgentFields(agent.id, updates);
        }

        // Grant write access to the creator
        await this.repositories.userAgentAccesses.createAccess({
            userId: user.id,
            agentId: agent.id,
            access: 'write'
        });

        logger.debug`Agent ${agent.id} - Created in database - starting machine provisioning`;

        // Start async machine provisioning (don't await)
        // Pass machine type and custom machine ID if provided
        this.provisionMachineAsync(agent, machineType, customMachineId).catch(async (error) => {
            logger.error`Agent ${agent.id} - Machine provisioning failed: ${error}`;
            await this.repositories.agents.updateState(agent.id, AgentState.ERROR);
        });

        return agent.id;
    }

    async resumeArchivedAgent(agentId: string): Promise<void> {
        logger.info`Resuming archived agent ${agentId}`;

        // Get the agent
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) {
            throw new Error('Agent not found');
        }

        // Verify it's archived
        if (agent.state !== AgentState.ARCHIVED) {
            throw new Error(`Agent ${agentId} is not archived (current state: ${agent.state})`);
        }

        // Clean up stale desktop streaming credentials (old machine is gone)
        // New credentials will be set when the new machine is assigned
        try {
            await this.repositories.machineReservationQueue.deleteReservation(agentId);
            logger.info`Agent ${agentId} - Cleaned up old reservations`;
        } catch (error) {
            logger.warn`Agent ${agentId} - Failed to clean up old reservations: ${error}`;
            // Don't throw - continue with resume even if cleanup fails
        }

        // Save the original machine preferences before clearing them
        // So we can restore the same type of machine (custom or hetzner)
        const originalMachineType = agent.machineType as ('hetzner' | 'custom') | null;
        const originalMachineId = agent.machineId;

        // Reset agent to PROVISIONING state and clear machine-related fields
        await this.repositories.agents.updateAgentFields(agentId, {
            state: AgentState.PROVISIONING,
            isRunning: false,
            isReady: false,
            machineId: null,
            machineIpv4: null,
            machineUrl: null,
            machineSharedKey: null,
            machineType: null,
            provisionedAt: null,
            desktopUrl: null,
            streamingToken: null,
            streamingHostId: null,
            streamingAppId: null,
        });

        // Get the updated agent object
        const updatedAgent = await this.repositories.agents.getAgentById(agentId);
        if (!updatedAgent) {
            throw new Error('Failed to get updated agent');
        }

        // Kill zombie running automation events from the old machine
        await this.repositories.automationEvents.killRunningEventsForAgent(agentId);

        logger.debug`Agent ${agentId} - Reset to PROVISIONING - starting machine provisioning with original type: ${originalMachineType}`;

        // Start async machine provisioning and handle errors properly
        // Pass the original machine preferences to restore the same type
        try {
            await this.provisionMachineAsync(updatedAgent, originalMachineType || undefined, originalMachineId);
            logger.info`Agent ${agentId} - Machine provisioning completed successfully`;
        } catch (error) {
            logger.error`Agent ${agentId} - Machine provisioning failed: ${error}`;
            await this.repositories.agents.updateState(agentId, AgentState.ERROR);
            throw error; // Re-throw to let caller know provisioning failed
        }
    }

    async resumeErrorAgent(agentId: string): Promise<void> {
        logger.info`Resuming error agent ${agentId}`;

        // Get the agent
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) {
            throw new Error('Agent not found');
        }

        // Verify it's in error state
        if (agent.state !== AgentState.ERROR) {
            throw new Error(`Agent ${agentId} is not in error state (current state: ${agent.state})`);
        }

        // Clean up any old reservations from previous provisioning attempts
        try {
            await this.repositories.machineReservationQueue.deleteReservation(agentId);
            logger.info`Agent ${agentId} - Cleaned up old reservations`;
        } catch (error) {
            logger.warn`Agent ${agentId} - Failed to clean up old reservations: ${error}`;
        }

        // Save the original machine preferences before clearing them
        const originalMachineType = agent.machineType as ('hetzner' | 'custom') | null;
        const originalMachineId = agent.machineId;

        // Reset agent to PROVISIONING state and clear machine-related fields
        await this.repositories.agents.updateAgentFields(agentId, {
            state: AgentState.PROVISIONING,
            isRunning: false,
            isReady: false,
            machineId: null,
            machineIpv4: null,
            machineUrl: null,
            machineSharedKey: null,
            machineType: null,
            provisionedAt: null,
            errorMessage: null,
            desktopUrl: null,
            streamingToken: null,
            streamingHostId: null,
            streamingAppId: null,
        });

        // Get the updated agent object
        const updatedAgent = await this.repositories.agents.getAgentById(agentId);
        if (!updatedAgent) {
            throw new Error('Failed to get updated agent');
        }

        // Kill zombie running automation events from the old machine
        await this.repositories.automationEvents.killRunningEventsForAgent(agentId);

        logger.debug`Agent ${agentId} - Reset to PROVISIONING - starting machine provisioning with original type: ${originalMachineType}`;

        // Start async machine provisioning and handle errors properly
        try {
            await this.provisionMachineAsync(updatedAgent, originalMachineType || undefined, originalMachineId);
            logger.info`Agent ${agentId} - Machine provisioning completed successfully`;
        } catch (error) {
            logger.error`Agent ${agentId} - Machine provisioning failed: ${error}`;
            await this.repositories.agents.updateState(agentId, AgentState.ERROR);
            throw error;
        }
    }

    private async provisionMachineAsync(
        agent: Agent,
        machineType?: 'hetzner' | 'custom',
        customMachineId?: string | null
    ): Promise<void> {
        try {
            // If no explicit parameters provided, check agent record for stored preferences
            // This handles resume and server restart scenarios
            const effectiveMachineType = machineType || agent.machineType as ('hetzner' | 'custom') | null;
            const effectiveCustomMachineId = customMachineId !== undefined ? customMachineId : agent.machineId;

            // Handle custom machine provisioning differently
            if (effectiveMachineType === 'custom' && effectiveCustomMachineId != null) {
                logger.info`Agent ${agent.id} - Using custom machine type (explicit: ${machineType !== undefined}, from agent: ${agent.machineType})`;
                await this.provisionCustomMachine(agent, effectiveCustomMachineId);
                return;
            }

            // Default: Hetzner machine provisioning via queue
            // Step 1: Get or create reservation in queue
            let reservation = await this.repositories.machineReservationQueue.getReservationByAgentId(agent.id);

            if (reservation) {
                logger.info`Agent ${agent.id} - Found existing reservation ${reservation.id} (status: ${reservation.status})`;

                // If reservation is in a terminal state (fulfilled/cancelled), delete it and create a new one
                // This can happen when resuming an agent that was previously provisioned
                if (reservation.status === 'fulfilled' || reservation.status === 'cancelled') {
                    logger.info`Agent ${agent.id} - Reservation is in terminal state ${reservation.status}, deleting and creating new one`;
                    await this.repositories.machineReservationQueue.deleteReservation(agent.id);

                    const reservationId = await this.repositories.machineReservationQueue.createReservation(agent.id);
                    reservation = await this.repositories.machineReservationQueue.getReservation(reservationId);
                    if (!reservation) {
                        throw new Error('Failed to create reservation');
                    }
                    logger.info`Agent ${agent.id} - Created new machine reservation ${reservation.id}`;
                }
            } else {
                const reservationId = await this.repositories.machineReservationQueue.createReservation(agent.id);
                reservation = await this.repositories.machineReservationQueue.getReservation(reservationId);
                if (!reservation) {
                    throw new Error('Failed to create reservation');
                }
                logger.info`Agent ${agent.id} - Created new machine reservation ${reservation.id}`;
            }

            const reservationId = reservation.id;

            // Step 2: Poll for assignment
            let assignedMachine: { machineId: string; ipv4: string; url: string | null; desktopUrl: string | null; sharedKey: string; streamingToken: string | null; streamingHostId: string | null; streamingAppId: string | null } | null = null;

            while (!assignedMachine) {
                const reservation = await this.repositories.machineReservationQueue.getReservation(reservationId);

                if (!reservation) {
                    throw new Error('Reservation was deleted');
                }

                if (reservation.status === 'assigned' && reservation.assignedMachineId && reservation.assignedIpv4 && reservation.assignedSharedKey) {
                    // Machine has been assigned!
                    assignedMachine = {
                        machineId: reservation.assignedMachineId,
                        ipv4: reservation.assignedIpv4,
                        url: reservation.assignedUrl,
                        desktopUrl: reservation.assignedDesktopUrl,
                        sharedKey: reservation.assignedSharedKey,
                        streamingToken: reservation.assignedStreamingToken,
                        streamingHostId: reservation.assignedStreamingHostId,
                        streamingAppId: reservation.assignedStreamingAppId
                    };
                    break;
                }

                await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
            }

            logger.info`Agent ${agent.id} - Got machine ${assignedMachine.machineId} with IP ${assignedMachine.ipv4} URL: ${assignedMachine.url || 'none'}`;
            logger.info`[DESKTOP_URL_TRACE] From reservation: desktopUrl=${assignedMachine.desktopUrl || 'null'}, streamingToken=${assignedMachine.streamingToken ? 'yes' : 'null'}, hostId=${assignedMachine.streamingHostId || 'null'}, appId=${assignedMachine.streamingAppId || 'null'}`;

            // Generate service preview token (for iframe service previews)
            const servicePreviewToken = randomBytes(32).toString('hex');

            // Step 3: Update agent with machine info
            await this.repositories.agents.updateAgentFields(agent.id, {
                machineId: assignedMachine.machineId,
                machineIpv4: assignedMachine.ipv4,
                machineUrl: assignedMachine.url,
                desktopUrl: assignedMachine.desktopUrl,
                streamingToken: assignedMachine.streamingToken,
                streamingHostId: assignedMachine.streamingHostId,
                streamingAppId: assignedMachine.streamingAppId,
                servicePreviewToken: servicePreviewToken,
                machineSharedKey: assignedMachine.sharedKey,
                machineType: 'hetzner'
            });
            logger.info`[DESKTOP_URL_TRACE] Stored on agent ${agent.id}`;

            // Step 4: Health check the machine (use URL if available, otherwise IP)
            await this.waitForMachineReady(assignedMachine.url || assignedMachine.ipv4);

            // Step 4.5: Set SERVICE_PREVIEW_TOKEN environment variable on agents-server
            try {
                await this.sendToAgentServer(assignedMachine.machineId, '/update-environment', {
                    environment: {
                        SERVICE_PREVIEW_TOKEN: servicePreviewToken
                    }
                });
                logger.info`Agent ${agent.id} - Service preview token set on agents-server`;
            } catch (error) {
                logger.error`Agent ${agent.id} - Failed to set service preview token: ${error}`;
                // Non-fatal - service previews won't work but agent can still function
            }

            // Step 5: Transition to PROVISIONED and start lifetime countdown
            await this.repositories.agents.updateState(agent.id, AgentState.PROVISIONED);
            await this.repositories.agents.updateAgentFields(agent.id, {
                provisionedAt: new Date()
            });

            // Step 6: Mark reservation as fulfilled
            await this.repositories.machineReservationQueue.markFulfilled(reservationId);

            logger.info`Agent ${agent.id} - Machine provisioned successfully`;

        } catch (error) {
            logger.error`Agent ${agent.id} - Machine provisioning failed: ${error}`;
            // Reservation stays as-is - queue processor will retry if 'queued',
            // or cleanup will happen on agent resume/trash
            throw error;
        }
    }

    /**
     * Provision a custom machine for an agent
     * Custom machines are user-owned and don't use the queue system
     */
    private async provisionCustomMachine(agent: Agent, customMachineId: string): Promise<void> {
        logger.info`Agent ${agent.id} - Starting custom machine provisioning with machineId: ${customMachineId}`;

        try {
            let machine;

            // User specified a specific custom machine
            machine = await this.repositories.prisma.customMachine.findUnique({
                where: { id: customMachineId },
            });

            if (!machine) {
                throw new Error(`Custom machine ${customMachineId} not found`);
            }

            if (machine.userId !== agent.userId) {
                throw new Error(`Custom machine ${customMachineId} does not belong to user ${agent.userId}`);
            }

            if (machine.status === 'in_use' && machine.currentAgentId !== agent.id) {
                throw new Error(`Custom machine ${customMachineId} is already in use by another agent`);
            }

            logger.info`Agent ${agent.id} - Using custom machine ${machine.id} (${machine.name}) at ${machine.ipv4}`;

            // Generate service preview token (for iframe service previews)
            const servicePreviewToken = randomBytes(32).toString('hex');

            // Transaction 1: Atomically link machine and agent
            await this.repositories.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                // Step 1: Assign machine to agent
                await tx.customMachine.update({
                    where: { id: machine.id },
                    data: {
                        currentAgentId: agent.id,
                        status: 'in_use',
                    },
                });

                // Step 2: Update agent with machine info (using tx if possible, otherwise direct)
                // Note: repositories.agents.updateAgentFields doesn't support tx parameter yet
                // So we'll do direct update via tx.agent.update
                await tx.agent.update({
                    where: { id: agent.id },
                    data: {
                        machineId: machine.id,
                        machineIpv4: machine.ipv4,
                        machineSharedKey: machine.sharedKey,
                        machineType: 'custom',
                        servicePreviewToken: servicePreviewToken,
                    },
                });
            });

            // Step 3: Health check the machine (outside transaction - long-running operation)
            logger.info`Agent ${agent.id} - Checking custom machine health...`;
            await this.waitForMachineReady(machine.ipv4);

            // Step 3.5: Set SERVICE_PREVIEW_TOKEN environment variable on agents-server
            try {
                await this.sendToAgentServer(machine.id, '/update-environment', {
                    environment: {
                        SERVICE_PREVIEW_TOKEN: servicePreviewToken
                    }
                });
                logger.info`Agent ${agent.id} - Service preview token set on custom machine`;
            } catch (error) {
                logger.error`Agent ${agent.id} - Failed to set service preview token on custom machine: ${error}`;
                // Non-fatal - service previews won't work but agent can still function
            }

            // Transaction 2: Mark as provisioned
            await this.repositories.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                // Step 4: Transition to PROVISIONED
                await tx.agent.update({
                    where: { id: agent.id },
                    data: {
                        state: AgentState.PROVISIONED,
                        provisionedAt: new Date(),
                    },
                });
            });

            logger.info`Agent ${agent.id} - Custom machine provisioned successfully`;

        } catch (error) {
            logger.error`Agent ${agent.id} - Custom machine provisioning failed: ${error}`;

            // Clean up: Release the machine and clear agent fields atomically
            try {
                const refreshedAgent = await this.repositories.agents.getAgentById(agent.id);
                if (refreshedAgent?.machineId) {
                    await this.repositories.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
                        // Release the custom machine
                        await tx.customMachine.update({
                            where: { id: refreshedAgent.machineId! },
                            data: {
                                currentAgentId: null,
                                status: 'online',
                            },
                        });

                        // Clear agent's machine info
                        await tx.agent.update({
                            where: { id: agent.id },
                            data: {
                                machineId: null,
                                machineIpv4: null,
                                machineUrl: null,
                                machineSharedKey: null,
                                machineType: null,
                            },
                        });
                    });
                    logger.info`Agent ${agent.id} - Cleaned up machine assignment after provisioning failure`;
                }
            } catch (cleanupError) {
                logger.warn`Agent ${agent.id} - Failed to clean up custom machine: ${cleanupError}`;
            }

            throw error;
        }
    }

    /**
     * Wait for machine to become ready via health check.
     * @param target - Either a URL (https://...) or an IPv4 address
     */
    private async waitForMachineReady(target: string): Promise<void> {
        // Cert-gateway URL is already warmed during machine parking (machinePool.service.ts),
        // so this should pass on the first attempt. Use fewer retries with shorter delays
        // as a safety net — if the route is still broken after 5 attempts, fail fast.
        const maxAttempts = 5;
        const delay = 1000;

        logger.info`Machine ${target} - Starting health check (max ${maxAttempts} attempts)`;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const healthResponse = await this.healthCheckMachine(target);
                if (healthResponse.ok) {
                    logger.info`Machine ${target} - Health check passed on attempt ${attempt}`;
                    return;
                } else {
                    logger.warn`Machine ${target} - Health check attempt ${attempt}/${maxAttempts} returned not ok: status=${healthResponse.status}`;
                }
            } catch (error) {
                logger.warn`Machine ${target} - Health check attempt ${attempt}/${maxAttempts} failed: ${error}`;
            }

            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw new Error(`Machine ${target} failed to become ready after ${maxAttempts} attempts`);
    }

    async startAgent(
        agentId: string,
        params: {
            repository?: string;
            baseBranch?: string;
            setupType?: string;
            remotePath?: string;
            cloneUrl?: string;
            branch?: string;
            dontSendInitialMessage?: boolean;
            credentialsEnvironment: Record<string, string>;
            agentProviderConfig: AgentProviderConfig;
            // Patch-based upload params (like fork from patches)
            gitHistoryLastPushedCommitSha?: string | null;
            commits?: Array<{ title: string; patch: string; timestamp?: number }>;
            uncommittedPatch?: string | null;
        }): Promise<void> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }

        if (agent.state !== AgentState.PROVISIONED) {
            throw new Error(`Agent ${agentId} ${agent.name} not PROVISIONED (currently ${agent.state})`);
        }

        if (!agent.machineId) {
            throw new Error(`Agent ${agentId} ${agent.name} has no machineId`);
        }

        logger.debug`Agent ${agentId} ${agent.name} - Starting agent setup`;

        try {
            await this.repositories.agents.updateState(agentId, AgentState.CLONING);

            const user = await this.userService.getUserById(agent.userId);
            if (!user) {
                throw new Error('User not found');
            }

            let githubProfile = null;
            if (user.githubProfileId) {
                githubProfile = await this.repositories.githubProfiles.findById(user.githubProfileId);
            }

            const gitUserName = githubProfile?.name || user.id;
            const gitUserEmail = githubProfile?.email || `${user.id}@github.local`;

            // StartConfig matches agents-server/src/handlers/start.ts StartConfig interface
            interface StartConfig {
                setup?: {
                    type: string;
                    repository?: string;
                    baseBranch?: string;
                    token?: string;
                    targetBranch?: string;
                    cloneUrl?: string;
                    branch?: string;
                    zipPath?: string;
                    githubToken?: string | null;
                };
                gitUserName: string;
                gitUserEmail: string;
                claudeDir: Record<string, unknown>;
                environment?: Record<string, string>;
                automations?: Array<{
                    id: string;
                    name: string;
                    trigger: { type: string; fileGlob?: string; commandRegex?: string; automationId?: string };
                    scriptLanguage: string;
                    scriptContent: string;
                    blocking: boolean;
                    feedOutput: boolean;
                }>;
                dontSendInitialMessage: boolean;
                arianaToken?: string;
                agentId?: string;
                projectId?: string;
                projectName?: string;
            }

            const setupConfig: StartConfig = {
                gitUserName,
                gitUserEmail,
                claudeDir: {},
                dontSendInitialMessage: params.dontSendInitialMessage || false,
                environment: params.credentialsEnvironment,
            };
            const authMethod = params.agentProviderConfig.claudeCode.activeAuthMethod;
            const apiProvider = params.agentProviderConfig.claudeCode.apiKey.activeProvider;
            logger.info`Agent ${agentId} ${agent.name} - Using ${authMethod === 'subscription' ? 'OAuth subscription' : `${apiProvider} API key`} for authentication`;

            // Patch-based upload (for fork or non-fork with commits/uncommitted changes)
            if (params.setupType === 'patch-based' && params.commits !== undefined) {
                logger.info`Agent ${agentId} ${agent.name} - Using patch-based upload`;

                // Get repository and GitHub token
                const project = await this.repositories.projects.findById(agent.projectId);
                if (!project?.repositoryId) {
                    throw new Error('No repository found for patch-based upload - cannot clone');
                }

                const repository = await this.repositories.repositories.findById(project.repositoryId);
                if (!repository) {
                    throw new Error('Repository not found');
                }

                const userTokens = await this.githubService.getUserTokens(agent.userId);
                if (!userTokens) {
                    throw new Error('No GitHub token found for user');
                }

                // Build clone URL
                const cloneUrl = `https://github.com/${repository.fullName}.git`;

                // Call restore-git-history on agents-server (can take time for large repos)
                const restoreData = await this.sendToAgentServerOrThrow(
                    agent.machineId,
                    '/restore-git-history',
                    {
                        gitHistoryLastPushedCommitSha: params.gitHistoryLastPushedCommitSha,
                        commits: params.commits,
                        uncommittedPatch: params.uncommittedPatch,
                        cloneUrl,
                        githubToken: userTokens.accessToken,
                        gitUserName,
                        gitUserEmail
                    },
                    360000  // 6 minute timeout for git operations
                );

                if (!restoreData.success) {
                    throw new Error(`Failed to restore git history: ${restoreData.error}`);
                }

                logger.info`Agent ${agentId} ${agent.name} - Git history restored`;

                // Store gitHistoryLastPushedCommitSha in agent
                if (params.gitHistoryLastPushedCommitSha) {
                    await this.repositories.agents.updateAgentFields(agentId, {
                        gitHistoryLastPushedCommitSha: params.gitHistoryLastPushedCommitSha
                    });
                }

                // Git setup is already done by restore-git-history, just finish initialization
                setupConfig.setup = {
                    type: 'existing',
                    targetBranch: agent.branchName || 'main'
                };
            } else if (params.baseBranch) {
                // OAuth authenticated clone from GitHub
                const project = await this.repositories.projects.findById(agent.projectId);
                if (!project?.repositoryId) {
                    throw new Error('Agent project has no linked repository');
                }

                const repository = await this.repositories.repositories.findById(project.repositoryId);
                if (!repository) {
                    throw new Error('Repository not found');
                }

                const userTokens = await this.githubService.getUserTokens(agent.userId);
                if (!userTokens) {
                    throw new Error('No GitHub token found for user');
                }

                setupConfig.setup = {
                    type: 'git-clone',
                    repository: repository.fullName,
                    baseBranch: params.baseBranch,
                    token: userTokens.accessToken,
                    targetBranch: agent.branchName
                };
            } else if (params.cloneUrl && params.branch) {
                // Public clone from URL (no authentication)
                logger.info`Agent ${agentId} ${agent.name} - Setting up public clone from URL: ${params.cloneUrl} (branch: ${params.branch})`;

                // Store cloneUrl in project so we can construct commit URLs later
                await this.repositories.projects.updateProjectCloneUrl(agent.projectId, params.cloneUrl);

                setupConfig.setup = {
                    type: 'git-clone-public',
                    cloneUrl: params.cloneUrl,
                    branch: params.branch,
                    targetBranch: agent.branchName
                };

                logger.info`Agent ${agentId} ${agent.name} - Public clone config: ${JSON.stringify(setupConfig.setup)}`;
            } else if (params.setupType === 'zip-uploaded' && params.remotePath) {
                // Local zip upload
                const userTokens = await this.githubService.getUserTokens(agent.userId);
                logger.info`Agent ${agentId} ${agent.name} - GitHub token for user: ${userTokens?.accessToken ? 'PRESENT' : 'NULL'}`;

                setupConfig.setup = {
                    type: 'zip-local',
                    zipPath: params.remotePath,
                    githubToken: userTokens?.accessToken || null,
                    targetBranch: agent.branchName
                };

                logger.info`Agent ${agentId} ${agent.name} - zip-local setup config: ${JSON.stringify({...setupConfig.setup, githubToken: setupConfig.setup.githubToken ? 'PRESENT' : 'NULL'})}`;

                // Try to get repository info from project for git push
                const project = await this.repositories.projects.findById(agent.projectId);
                if (project?.repositoryId) {
                    const repository = await this.repositories.repositories.findById(project.repositoryId);
                    if (repository) {
                        setupConfig.setup.repository = repository.fullName;
                        logger.info`Agent ${agentId} ${agent.name} - Added repository info for git operations: ${repository.fullName}`;
                    }
                }
            } else {
                throw new Error('Invalid start parameters: need baseBranch OR cloneUrl+branch OR setupType+remotePath');
            }

            // Add environment variables from PersonalEnvironment
            const envVariables = await this.personalEnvironmentService.getEnvironmentVariablesForAgent(agentId);
            if (Object.keys(envVariables).length > 0) {
                logger.info`Agent ${agentId} ${agent.name} - Adding ${Object.keys(envVariables).length} environment variables from PersonalEnvironment`;
                setupConfig.environment = {
                    ...setupConfig.environment,
                    ...envVariables  // Merge with existing env (like CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_API_KEY)
                };
            }

            // Add automations from PersonalEnvironment
            const automations = await this.repositories.automations.findByProjectAndUser(agent.projectId, agent.userId);
            if (agent.environmentId) {
                const envAutomations = await this.repositories.automations.getAutomationsForEnvironment(agent.environmentId);
                if (envAutomations.length > 0) {
                    logger.info`Agent ${agentId} ${agent.name} - Adding ${envAutomations.length} automation(s) from environment`;
                    setupConfig.automations = envAutomations.map(a => ({
                        id: a.id,
                        name: a.parsedData.name,
                        trigger: a.parsedData.trigger,
                        scriptLanguage: a.parsedData.scriptLanguage,
                        scriptContent: a.parsedData.scriptContent,
                        blocking: a.parsedData.blocking,
                        feedOutput: a.parsedData.feedOutput
                    }));
                }
            }

            // Generate Ariana token for CLI (15 min TTL)
            const arianaToken = generateInternalAgentToken(agent.userId, agentId);
            setupConfig.arianaToken = arianaToken;
            logger.info`Agent ${agentId} ${agent.name} - Ariana token generated for CLI`;

            // Pass agent identity for MCP queries
            setupConfig.agentId = agentId;
            setupConfig.projectId = agent.projectId;
            const projectForName = await this.repositories.projects.findById(agent.projectId);
            setupConfig.projectName = projectForName?.name;

            const startResponse = await this.sendToAgentServer(agent.machineId, '/start', setupConfig);
            const startData = await startResponse.json();

            // Check if /start failed
            if (!startResponse.ok || startData.error) {
                let errorMessage: string;
                if (typeof startData.error === 'string') {
                    errorMessage = startData.error;
                } else if (startData.error && typeof startData.error === 'object') {
                    errorMessage = startData.error.message || JSON.stringify(startData.error);
                } else {
                    errorMessage = `Agent initialization failed (status ${startResponse.status})`;
                }
                throw new Error(errorMessage);
            }

            // Store git info returned from agents-server
            const updateFields: Partial<Agent> = {
                isRunning: true,
                isReady: true,
                errorMessage: null // Clear any previous error
            };

            // Handle 3-state gitInfoStatus: 'has_commits' | 'empty_repo' | 'error'
            if (startData.gitInfoStatus === 'has_commits') {
                if (startData.startCommitSha) {
                    updateFields.startCommitSha = startData.startCommitSha;
                    logger.info`Agent ${agentId} ${agent.name} - Set startCommitSha: ${startData.startCommitSha}`;
                }
                if (startData.gitHistoryLastPushedCommitSha) {
                    updateFields.gitHistoryLastPushedCommitSha = startData.gitHistoryLastPushedCommitSha;
                    logger.info`Agent ${agentId} ${agent.name} - Set gitHistoryLastPushedCommitSha: ${startData.gitHistoryLastPushedCommitSha}`;
                }
            } else if (startData.gitInfoStatus === 'empty_repo') {
                logger.info`Agent ${agentId} ${agent.name} - Repository is empty (no commits yet)`;
                // startCommitSha stays undefined for empty repos
            } else if (startData.gitInfoStatus === 'error') {
                logger.warn`Agent ${agentId} ${agent.name} - Git info capture failed: ${startData.gitInfoError}`;
                // Continue anyway - agent can still work
            }

            if (startData.baseBranch && !agent.baseBranch) {
                updateFields.baseBranch = startData.baseBranch;
                logger.info`Agent ${agentId} ${agent.name} - Set baseBranch: ${startData.baseBranch}`;
            }

            await this.repositories.agents.updateState(agentId, AgentState.READY);
            await this.repositories.agents.updateAgentFields(agentId, updateFields);

            logger.info`Agent ${agentId} ${agent.name} - Agent started successfully`;

            // Update secrets for this agent
            await this.updateSecretsForAgent(agentId);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error during agent initialization';
            logger.error`Agent ${agentId} ${agent.name} - Agent start failed: ${errorMessage}`;
            await this.repositories.agents.updateAgentFields(agentId, { errorMessage });
            await this.repositories.agents.updateState(agentId, AgentState.ERROR);
            throw error;
        }
    }

    async updateSecretsForAgent(agentId: string): Promise<void> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent || !agent.isRunning || !agent.machineId) {
            logger.warn`Agent ${agentId} - Cannot update secrets (agent not running or no machineId)`;
            return;
        }

        try {
            // Get secret files from environment
            const secretFiles = await this.personalEnvironmentService.getSecretFilesForAgent(agentId);

            // Get SSH key pair from environment
            const sshKeyPair = await this.personalEnvironmentService.getSshKeyPairForAgent(agentId);

            await this.sendToAgentServer(
                agent.machineId,
                '/update-secrets',
                { secretFiles }
            );

            // Deploy SSH identity keys if present
            if (sshKeyPair) {
                await this.sendToAgentServer(
                    agent.machineId,
                    '/deploy-ssh-identity',
                    sshKeyPair
                );
                logger.info`Agent ${agentId} ${agent.name} - SSH identity keys deployed (${sshKeyPair.keyName})`;
            }

            logger.info`Agent ${agentId} ${agent.name} - Secrets updated successfully (${secretFiles.length} files)`;
        } catch (error) {
            logger.error`Agent ${agentId} - Failed to update secrets: ${error}`;
            throw error;
        }
    }

    async updateEnvironmentForAgent(agentId: string): Promise<void> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent || !agent.isRunning || !agent.machineId) {
            logger.warn`Agent ${agentId} - Cannot update environment (agent not running or no machineId)`;
            return;
        }

        try {
            // Get environment variables from environment
            const envVariables = await this.personalEnvironmentService.getEnvironmentVariablesForAgent(agentId);

            // Get secret files from environment
            const secretFiles = await this.personalEnvironmentService.getSecretFilesForAgent(agentId);

            // Get SSH key pair from environment
            const sshKeyPair = await this.personalEnvironmentService.getSshKeyPairForAgent(agentId);

            // Update environment variables
            await this.sendToAgentServer(
                agent.machineId,
                '/update-environment',
                { environment: envVariables }
            );

            // Update secret files
            await this.sendToAgentServer(
                agent.machineId,
                '/update-secrets',
                { secretFiles }
            );

            // Deploy SSH identity keys if present
            if (sshKeyPair) {
                await this.sendToAgentServer(
                    agent.machineId,
                    '/deploy-ssh-identity',
                    sshKeyPair
                );
                logger.info`Agent ${agentId} ${agent.name} - SSH identity keys deployed (${sshKeyPair.keyName})`;
            }

            logger.info`Agent ${agentId} ${agent.name} - Environment updated successfully (${Object.keys(envVariables).length} variables, ${secretFiles.length} secret files)`;
        } catch (error) {
            logger.error`Agent ${agentId} - Failed to update environment: ${error}`;
            throw error;
        }
    }

    async pollAgent(agent: Agent): Promise<PollTiming | null> {
        const agentId = agent.id;
        if (!agent) {
            logger.warn`pollAgent called with null agent`;
            return null;
        }
        if (!agent?.machineId) {
            logger.warn`Agent ${agentId} ${agent.name} - Skipping poll: no machineId`;
            return null;
        }

        // Only poll if agent is in a state where it makes sense (READY, IDLE, or RUNNING)
        const currentState = agent.state as AgentState;
        const pollableStates = [AgentState.READY, AgentState.IDLE, AgentState.RUNNING];
        if (!pollableStates.includes(currentState)) {
            logger.debug`Agent ${agentId} ${agent.name} - Skipping poll: agent in ${currentState} state`;
            return null;
        }

        const timing: PollTiming = { conv: 0, git: 0, pr: 0, auto: 0, ctx: 0, store: 0, msgCount: 0, msgProcessed: 0 };

        // Git history: throttled to once per 10s, fire-and-forget (doesn't block poll)
        const lastGit = this.lastGitHistoryPoll.get(agentId) || 0;
        if (Date.now() - lastGit >= this.GIT_HISTORY_INTERVAL_MS) {
            this.lastGitHistoryPoll.set(agentId, Date.now());
            const gitStart = Date.now();
            this.pollAndSyncGitHistory(agent)
                .then(() => { timing.git = Date.now() - gitStart; })
                .catch(err => logger.warn`Agent ${agentId} ${agent.name} - git history sync failed: ${err}`);
        } else {
            timing.git = -1; // skipped
        }

        try {
            // Wrap each sub-call to capture individual timing even though they run in parallel
            const timed = <T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> => {
                const s = Date.now();
                return fn().then(result => ({ result, ms: Date.now() - s }));
            };

            const [messagesResult, prResult, autoResult, ctxResult, _actionsResult] = await Promise.allSettled([
                timed(() => this.getConversationMessages(agent)),
                timed(() => this.syncPRStateFromGitHub(agent)),
                timed(() => this.pollAndSyncAutomationEvents(agent)),
                timed(() => this.pollAndSyncContextEvents(agent)),
                timed(() => this.pollAndSyncAutomationActions(agent))
            ]);

            if (messagesResult.status === 'fulfilled') timing.conv = messagesResult.value.ms;
            if (prResult.status === 'fulfilled') timing.pr = prResult.value.ms;
            if (autoResult.status === 'fulfilled') timing.auto = autoResult.value.ms;
            if (ctxResult.status === 'fulfilled') timing.ctx = ctxResult.value.ms;

            // Store messages after parallel polls complete (depends on messages result)
            if (messagesResult.status === 'fulfilled' && messagesResult.value.result) {
                const messages = messagesResult.value.result;
                timing.msgCount = messages.length;
                const storeStart = Date.now();
                timing.msgProcessed = await this.storePolledMessages(agent, messages);
                timing.store = Date.now() - storeStart;
            }
        } catch (error) {
            logger.warn`Agent ${agentId} ${agent.name} - Failed to poll conversation data: ${error}`;
        }

        return timing;
    }

    /**
     * Run the state machine logic for an agent.
     * Called independently from pollAgent on its own per-agent schedule.
     * @param sharedMsgCount - last known message count from the data chain (for ghost agent detection)
     */
    async handleStateLogic(agent: Agent, sharedMsgCount: number): Promise<{ claudeState: number; stateLogic: number } | null> {
        const agentId = agent.id;
        if (!agent) return null;

        // Skip trashed agents
        if (agent.isTrashed) {
            logger.debug`Agent ${agentId} ${agent.name} - Skipping state transitions: agent is trashed`;
            return null;
        }

        const result = { claudeState: 0, stateLogic: 0 };
        const currentState = agent.state as AgentState;

        switch (currentState) {
            case AgentState.READY: {
                const csStart = Date.now();
                const claudeState = await this.getClaudeState(agent);
                result.claudeState = Date.now() - csStart;

                const logicStart = Date.now();

                // If machine is unreachable, track failure and potentially transition to ERROR
                if (!claudeState) {
                    const isDead = await this.trackMachineFailure(agent);
                    if (isDead) {
                        // Already transitioned to ERROR in trackMachineFailure
                        break;
                    }
                    // Not yet confirmed dead, waiting for Claude initialization
                    logger.debug`Agent ${agentId} ${agent.name} - READY state check - waiting for Claude initialization`;
                    break;
                }

                const { isReady, hasBlockingAutomation, contextUsage } = claudeState;

                // Check context thresholds and create warning events if needed
                if (contextUsage) {
                    await this.checkContextThreshold(agent, contextUsage);
                }

                if (isReady && !hasBlockingAutomation) {
                    // Double-check state from DB to prevent race conditions
                    const freshAgent = await this.repositories.agents.getAgentById(agentId);
                    if (freshAgent?.state !== AgentState.READY) {
                        logger.debug`Agent ${agentId} ${agent.name} - Skipping on_agent_ready: state already changed to ${freshAgent?.state}`;
                        break;
                    }

                    logger.debug`Agent ${agentId} ${agent.name} - Agent is fully ready`;

                    // Trigger on_agent_ready automations (fire-and-forget, blocking tracked on agents-server)
                    await this.triggerAutomations(agent, 'on_agent_ready');

                    await this.repositories.agents.updateState(agentId, AgentState.IDLE);
                }

                result.stateLogic = Date.now() - logicStart;
                break;
            }

            case AgentState.IDLE: {
                const csStart = Date.now();
                const claudeState = await this.getClaudeState(agent);
                result.claudeState = Date.now() - csStart;

                const logicStart = Date.now();

                // If machine is unreachable, track failure and potentially transition to ERROR
                if (!claudeState) {
                    const isDead = await this.trackMachineFailure(agent);
                    if (isDead) {
                        // Already transitioned to ERROR in trackMachineFailure
                        break;
                    }
                    // Not yet confirmed dead, skip this polling cycle
                    break;
                }

                const { isReady, hasBlockingAutomation, blockingAutomationIds, contextUsage } = claudeState;

                // Keep GitHub token fresh while agent is idle (fire-and-forget)
                this.refreshGithubTokenIfNeeded(agent).catch(() => {});

                // Check context thresholds and create warning events if needed
                if (contextUsage) {
                    await this.checkContextThreshold(agent, contextUsage);
                }

                // If Claude is processing something (feedOutput, etc.), transition to RUNNING
                if (!isReady) {
                    logger.debug`Agent ${agentId} ${agent.name} - Claude is processing, transitioning to RUNNING`;
                    await this.repositories.agents.updateState(agentId, AgentState.RUNNING);
                    break;
                }

                // Check if agent is blocked by any running automation (polled from agents-server)
                if (hasBlockingAutomation) {
                    logger.debug`Agent ${agentId} ${agent.name} - Blocked by ${blockingAutomationIds.length} automation(s), skipping prompt processing`;
                    break;
                }

                const agentPrompts = await this.repositories.agentPrompts.getQueuedPrompts(agentId);

                if (agentPrompts.length > 0) {
                    logger.info`Agent ${agentId} ${agent.name} - Found queued prompts: ${agentPrompts.map(p => `${p.id}:${p.status}`).join(', ')}`;
                }

                if (agentPrompts.length > 0 && isReady) {
                    const nextPrompt = agentPrompts[0];
                    logger.info`Agent ${agentId} ${agent.name} - Sending queued prompt: ${nextPrompt.prompt.substring(0, 50)}...`;

                    // Refresh credentials before sending prompt
                    try {
                        // Ensure OAuth token is fresh (updates config if refreshed)
                        await this.claudeOAuthService.getValidAccessToken(agent.userId);

                        // Get active credentials from unified config
                        const { environment, config } = await this.userService.getActiveCredentials(agent.userId);
                        const authMethod = config.claudeCode.activeAuthMethod;
                        const apiProvider = config.claudeCode.apiKey.activeProvider;

                        if (Object.keys(environment).length > 0) {
                            await this.sendToAgentServer(
                                agent.machineId!,
                                '/update-credentials',
                                { environment, agentProviderConfig: config },
                                this.STATE_HTTP_TIMEOUT_MS
                            );
                            logger.info`Agent ${agentId} ${agent.name} - Updated credentials (${authMethod === 'subscription' ? 'OAuth' : apiProvider}) before prompt`;
                        }

                        // Also refresh GitHub token if available
                        const githubTokens = await this.githubService.getUserTokens(agent.userId);
                        if (githubTokens?.accessToken) {
                            await this.sendToAgentServer(
                                agent.machineId!,
                                '/update-github-token',
                                { githubToken: githubTokens.accessToken },
                                this.STATE_HTTP_TIMEOUT_MS
                            );
                            logger.info`Agent ${agentId} ${agent.name} - Updated GitHub token before prompt`;
                        }

                        // Refresh Ariana token for CLI (15 min TTL)
                        const arianaToken = generateInternalAgentToken(agent.userId, agentId);
                        await this.sendToAgentServer(
                            agent.machineId!,
                            '/update-ariana-token',
                            { token: arianaToken },
                            this.STATE_HTTP_TIMEOUT_MS
                        );
                        logger.info`Agent ${agentId} ${agent.name} - Refreshed Ariana token`;
                    } catch (error) {
                        logger.error`Agent ${agentId} ${agent.name} - Failed to refresh credentials before prompt: ${error}`;
                        // Continue anyway - agent might still have valid credentials
                    }

                    // Mark prompt as running FIRST to prevent race condition where next poll cycle picks it up again
                    await this.repositories.agentPrompts.updatePromptStatusToRunning(nextPrompt.id);

                    // Read model from database
                    const model = nextPrompt.model as 'opus' | 'sonnet' | 'haiku' | undefined;

                    await this.startNewTask(agentId, nextPrompt.id, nextPrompt.prompt);
                    await this.repositories.agents.updateState(agentId, AgentState.RUNNING);

                    // Send prompt to agent server (returns immediately — agent-server processes in background)
                    const promptResponse = await this.sendToAgentServer(agent.machineId!, '/prompt', {
                        prompt: nextPrompt.prompt,
                        model: model || 'sonnet' // Default to sonnet if not specified
                    }, this.PROMPT_HTTP_TIMEOUT_MS);

                    // Check if prompt was actually accepted by the agent server
                    if (!promptResponse.ok) {
                        const errorData = await promptResponse.json().catch(() => ({ error: 'Unknown error' }));
                        logger.error`Agent ${agentId} ${agent.name} - Failed to send prompt to agent server: ${errorData.error}`;
                        // Revert state changes since prompt wasn't accepted
                        await this.repositories.agents.updateState(agentId, AgentState.IDLE);
                        await this.repositories.agentPrompts.updatePromptStatusToFailed(nextPrompt.id);
                        break; // Don't process further, let next poll cycle retry
                    }

                    logger.info`Agent ${agentId} ${agent.name} - Transitioned to RUNNING state`;

                    // Generate task summary and rename branch asynchronously (don't block prompt processing)
                    this.generateTaskSummaryAsync(agentId, agent.machineId!, nextPrompt.prompt).catch(err => {
                        logger.warn`Agent ${agentId} ${agent.name} - Failed to generate task summary: ${err}`;
                    });
                    this.renameBranchFromPromptAsync(agentId, agent.machineId!, nextPrompt.prompt).catch(err => {
                        logger.warn`Agent ${agentId} ${agent.name} - Failed to rename branch: ${err}`;
                    });
                }

                result.stateLogic = Date.now() - logicStart;
                break;
            }

            case AgentState.RUNNING: {
                const csStart = Date.now();
                const claudeState = await this.getClaudeState(agent);
                result.claudeState = Date.now() - csStart;

                const logicStart = Date.now();

                // If machine is unreachable, track failure and potentially transition to ERROR
                if (!claudeState) {
                    const isDead = await this.trackMachineFailure(agent);
                    if (isDead) {
                        // Already transitioned to ERROR and failed prompts in trackMachineFailure
                        break;
                    }
                    // Not yet confirmed dead, skip this polling cycle but stay in RUNNING
                    break;
                }

                const { isReady, hasBlockingAutomation, contextUsage } = claudeState;

                // Keep GitHub token fresh while agent is working (fire-and-forget)
                this.refreshGithubTokenIfNeeded(agent).catch(() => {});

                // Check context thresholds and create warning events if needed
                if (contextUsage) {
                    await this.checkContextThreshold(agent, contextUsage);
                }

                if (isReady && !hasBlockingAutomation) {
                    this.unproductiveRunningStart.delete(agentId);
                    const currentTaskId = agent.currentTaskId!;
                    await this.createCheckpointForTask(agentId, currentTaskId);

                    // Re-check blocking state after checkpoint (may have triggered on_before/after_commit automations)
                    const stateAfterCheckpoint = await this.getClaudeState(agent);
                    if (stateAfterCheckpoint?.hasBlockingAutomation) {
                        logger.debug`Agent ${agentId} - Blocked by automation after checkpoint, staying in RUNNING`;
                        break;
                    }

                    await this.repositories.agentPrompts.finishRunningPromptsForAgent(agentId);

                    // Check if autonomous mode (slop/ralph) should send next prompt directly
                    // This avoids the "Ready" flash in UI - agent never goes IDLE
                    const autonomousPrompt = await this.getAutonomousModePrompt(agent);

                    if (autonomousPrompt) {
                        // Autonomous mode active - send next prompt directly, stay in RUNNING
                        logger.info`Agent ${agentId} ${agent.name} - Autonomous mode: sending next prompt directly`;

                        // Create the prompt record in DB
                        const promptRecord = await this.repositories.agentPrompts.create({
                            id: crypto.randomUUID(),
                            agentId,
                            prompt: autonomousPrompt.message,
                            model: autonomousPrompt.model,
                            status: 'running'
                        });

                        // Start new task and send directly to agent
                        await this.startNewTask(agentId, promptRecord.id, autonomousPrompt.message);
                        try {
                            await this.sendToAgentServer(agent.machineId!, '/prompt', {
                                prompt: autonomousPrompt.message,
                                model: autonomousPrompt.model
                            }, this.PROMPT_HTTP_TIMEOUT_MS);
                            logger.info`Agent ${agentId} ${agent.name} - Autonomous prompt sent, staying in RUNNING`;
                        } catch (error) {
                            logger.error`Agent ${agentId} ${agent.name} - Failed to send autonomous prompt: ${error}`;
                            // On failure, transition to IDLE so user can retry
                            await this.repositories.agents.updateState(agentId, AgentState.IDLE);
                        }
                    } else {
                        // No autonomous mode - normal transition to IDLE
                        await this.repositories.agents.updateState(agentId, AgentState.IDLE);
                        logger.info`Agent ${agentId} ${agent.name} - Transitioned to IDLE`;
                    }
                } else if (isReady && hasBlockingAutomation) {
                    logger.debug`Agent ${agentId} - Blocked by automation(s), staying in RUNNING state`;
                    this.unproductiveRunningStart.delete(agentId);
                } else {
                    // !isReady: Claude reports busy. Check for ghost/stuck agents that will never produce output.
                    // Ghost agents are RUNNING with 0 conversation messages — e.g. project dir never set, agent-server 404s.
                    const totalMessages = sharedMsgCount;
                    if (totalMessages === 0) {
                        if (!this.unproductiveRunningStart.has(agentId)) {
                            this.unproductiveRunningStart.set(agentId, Date.now());
                        }
                        const stuckSince = this.unproductiveRunningStart.get(agentId)!;
                        const stuckMs = Date.now() - stuckSince;
                        if (stuckMs >= this.UNPRODUCTIVE_RUNNING_TIMEOUT_MS) {
                            logger.warn`Agent ${agentId} ${agent.name} - Stuck in RUNNING for ${Math.round(stuckMs / 1000)}s with 0 messages, transitioning to ERROR`;
                            const failedCount = await this.repositories.agentPrompts.failActivePromptsForAgent(agentId);
                            if (failedCount > 0) {
                                logger.warn`Agent ${agentId} ${agent.name} - Failed ${failedCount} active prompt(s) due to stuck agent`;
                            }
                            await this.repositories.agents.updateState(agentId, AgentState.ERROR);
                            this.cleanupAgentResources(agentId);
                        }
                    } else {
                        this.unproductiveRunningStart.delete(agentId);
                    }
                }

                result.stateLogic = Date.now() - logicStart;
                break;
            }
        }

        return result;
    }

    private async startNewTask(agentId: string, promptId: string, prompt: string): Promise<void> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) return;

        const previousTaskId = agent.currentTaskId;

        if (previousTaskId) {
            await this.createCheckpointForTask(agentId, previousTaskId);
        }
        // Note: No need for initial checkpoint - git-history polling handles all commits automatically

        await this.repositories.agents.updateAgentFields(agentId, {
            currentTaskId: promptId
        });

        logger.info`Agent ${agentId} ${agent.name} - Started new task ${promptId} for prompt: "${prompt.substring(0, 50)}..."`;
    }

    // Removed createInitialCheckpoint - git-history polling handles all commits automatically

    private async storePolledMessages(agent: Agent, messages: ConversationMessage[]): Promise<number> {
        const agentId = agent.id;
        const currentTaskId = agent.currentTaskId; // NULL for initial messages, prompt.id for task messages

        // Delta-based processing: separate streaming from finalized messages,
        // only process new finalized messages + re-check the last one for tool updates.
        // This turns 983 sequential DB queries into 0-2 for idle agents.
        const streamingMessages = messages.filter(m => m.isStreaming);
        const finalizedMessages = messages.filter(m => !m.isStreaming);
        const lastCount = this.lastProcessedMsgCount.get(agentId) ?? 0;
        const currentCount = finalizedMessages.length;

        let startIndex: number;
        if (currentCount <= 0) {
            startIndex = 0;
        } else if (currentCount < lastCount) {
            // Count decreased (agent/session restart), reset and process all
            startIndex = 0;
        } else if (currentCount === lastCount) {
            // No new messages — only re-check the last one for tool result updates
            startIndex = Math.max(0, currentCount - 1);
        } else {
            // New messages arrived — process from lastCount-1 to also re-check
            // the previous last message for tool result updates
            startIndex = Math.max(0, lastCount - 1);
        }

        const messagesToProcess = [
            ...finalizedMessages.slice(startIndex),
            ...streamingMessages
        ];

        // Track which DB message IDs were added vs modified for WS deltas
        const addedMessageIds: string[] = [];
        const modifiedMessageIds: string[] = [];

        for (const message of messagesToProcess) {
            try {
                // Skip messages with no content AND no tools
                if (!message.content && (!message.tools || message.tools.length === 0)) {
                    continue;
                }

                const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
                const sourceUuid = message.id; // Stable UUID from agent-server

                // Handle streaming messages: create/update a single streaming DB row
                if (message.isStreaming) {
                    const existingStreaming = await this.repositories.agentMessages.findStreamingMessage(agentId);
                    if (existingStreaming) {
                        if (existingStreaming.content !== content) {
                            await this.repositories.agentMessages.updateStreamingMessage(existingStreaming.id, agentId, content, true);
                            modifiedMessageIds.push(existingStreaming.id);
                        }
                    } else {
                        const newId = await this.repositories.agentMessages.storePolledMessage(agentId, {
                            role: message.role,
                            content,
                            model: message.model,
                            timestamp: new Date(message.timestamp),
                            taskId: currentTaskId,
                            isStreaming: true,
                            sourceUuid
                        });
                        addedMessageIds.push(newId);
                    }
                    continue;
                }

                // Finalized message: check if it already exists by sourceUuid
                const existing = sourceUuid
                    ? await this.repositories.agentMessages.findBySourceUuid(agentId, sourceUuid)
                    : null;

                if (existing) {
                    // Already stored — just update tools if they changed
                    if (JSON.stringify(existing.tools) != JSON.stringify(message.tools)) {
                        await this.repositories.agentMessages.updatePolledMessage({
                            id: existing.id,
                            tools: message.tools,
                        });
                        modifiedMessageIds.push(existing.id);
                    }
                    continue;
                }

                // Check if this finalizes a streaming row
                if (message.role === 'assistant') {
                    const existingStreaming = await this.repositories.agentMessages.findStreamingMessage(agentId);
                    if (existingStreaming) {
                        // Finalize: update content, clear streaming flag, set sourceUuid to final message's ID
                        await this.repositories.agentMessages.updateStreamingMessage(existingStreaming.id, agentId, content, false, sourceUuid);
                        if (message.tools && message.tools.length > 0) {
                            await this.repositories.agentMessages.updatePolledMessage({
                                id: existingStreaming.id,
                                tools: message.tools,
                            });
                            await this.handleToolUseAutomations(agent, message.tools);
                        }
                        modifiedMessageIds.push(existingStreaming.id);
                        continue;
                    }
                }

                // New message — insert
                logger.debug`Agent ${agentId} ${agent.name} - Storing new message: role=${message.role}, timestamp=${message.timestamp}, taskId=${currentTaskId}`;

                const newId = await this.repositories.agentMessages.storePolledMessage(agentId, {
                    role: message.role,
                    content,
                    model: message.model,
                    timestamp: new Date(message.timestamp),
                    tools: message.tools,
                    taskId: currentTaskId,
                    sourceUuid
                });
                addedMessageIds.push(newId);

                // Detect tool uses and trigger automations (only for new messages)
                if (message.role === 'assistant' && message.tools && message.tools.length > 0) {
                    await this.handleToolUseAutomations(agent, message.tools);
                }
            } catch (error) {
                logger.error`Agent ${agentId} ${agent.name} - Failed to store polled message`;
                console.error('[STORE-MESSAGE-ERROR] Full error:', error);
                console.error('[STORE-MESSAGE-ERROR] Message that failed:', JSON.stringify(message, null, 2));
            }
        }

        // Update the count after successful processing
        this.lastProcessedMsgCount.set(agentId, currentCount);

        // Notify WS subscribers with specific IDs of what changed
        if (addedMessageIds.length > 0 || modifiedMessageIds.length > 0) {
            emitAgentEventsChanged(agentId, {
                addedMessageIds: addedMessageIds.length > 0 ? addedMessageIds : undefined,
                modifiedMessageIds: modifiedMessageIds.length > 0 ? modifiedMessageIds : undefined,
            });
        }

        return messagesToProcess.length;
    }

    private async pollAndSyncAutomationEvents(agent: Agent): Promise<void> {
        const agentId = agent.id;
        if (!agent.machineId) {
            logger.debug`Agent ${agentId} ${agent.name} - Skipping automation events poll: no machineId`;
            return;
        }

        try {
            // Call poll-automation-events endpoint on agents-server
            const eventsResponse = await this.sendToAgentServer(
                agent.machineId,
                '/poll-automation-events',
                { agentId },
                this.POLL_HTTP_TIMEOUT_MS,
            );

            const eventsData = await eventsResponse.json();

            if (!eventsData.success) {
                logger.warn`Agent ${agentId} ${agent.name} - poll-automation-events failed: ${eventsData.error}`;
                return;
            }

            const { events, runningOutputs } = eventsData;

            // Sync status events BEFORE output updates so outputs target the correct (newest) event
            if (events && events.length > 0) {
                logger.info`Agent ${agentId} ${agent.name} - Polled ${events.length} automation event(s)`;

                for (const event of events) {
                    try {
                        const runningEvents = await this.repositories.automationEvents.getRunningEventsForAgent(agentId);
                        const existingEvent = runningEvents.find(e => e.automationId === event.automationId);

                        if (event.status === 'running') {
                            // Kill existing running event for this automation (re-run or machine move)
                            if (existingEvent) {
                                await this.repositories.automationEvents.updateEvent(existingEvent.id, {
                                    status: 'killed',
                                    finishedAt: new Date()
                                });
                                logger.info`Agent ${agentId} - Killed previous running event for: ${event.automationName}`;
                            }

                            await this.repositories.automationEvents.createEvent({
                                agentId,
                                automationId: event.automationId,
                                taskId: event.taskId || null,
                                trigger: event.trigger,
                                output: event.output,
                                isStartTruncated: event.isStartTruncated,
                                status: event.status,
                                startedAt: new Date()
                            });
                            logger.info`Agent ${agentId} - Created automation event: ${event.automationName} (running)`;
                        } else if (existingEvent) {
                            // Update existing running event with final status
                            await this.repositories.automationEvents.updateEvent(existingEvent.id, {
                                output: event.output,
                                isStartTruncated: event.isStartTruncated,
                                status: event.status,
                                exitCode: event.exitCode,
                                finishedAt: new Date()
                            });
                            logger.info`Agent ${agentId} - Updated automation event: ${event.automationName} (${event.status})`;

                            await this.triggerAutomations(agent, 'on_automation_finishes', {
                                automationId: event.automationId
                            });
                        } else {
                            // Fast execution: finished/failed before we saw "running"
                            await this.repositories.automationEvents.createEvent({
                                agentId,
                                automationId: event.automationId,
                                taskId: event.taskId || null,
                                trigger: event.trigger,
                                output: event.output,
                                isStartTruncated: event.isStartTruncated,
                                status: event.status,
                                startedAt: new Date(),
                                finishedAt: new Date(),
                                exitCode: event.exitCode
                            });
                            logger.info`Agent ${agentId} - Created automation event (fast): ${event.automationName} (${event.status})`;

                            await this.triggerAutomations(agent, 'on_automation_finishes', {
                                automationId: event.automationId
                            });
                        }
                    } catch (error) {
                        logger.error`Agent ${agentId} - Failed to sync automation event: ${error}`;
                    }
                }
            }

            // Update running automation outputs (done after status events)
            if (runningOutputs) {
                for (const [automationId, outputData] of Object.entries(runningOutputs as Record<string, { output: string; isStartTruncated: boolean }>)) {
                    try {
                        const runningEvents = await this.repositories.automationEvents.getRunningEventsForAgent(agentId);
                        const runningEvent = runningEvents.find(e => e.automationId === automationId);
                        if (runningEvent) {
                            await this.repositories.automationEvents.updateEvent(runningEvent.id, {
                                output: outputData.output,
                                isStartTruncated: outputData.isStartTruncated
                            });
                        }
                    } catch (error) {
                        logger.warn`Agent ${agentId} - Failed to update running automation output: ${error}`;
                    }
                }
            }
        } catch (error) {
            logger.warn`Agent ${agentId} ${agent.name} - Failed to poll automation events: ${error}`;
        }
    }

    private async pollAndSyncAutomationActions(agent: Agent): Promise<void> {
        const agentId = agent.id;
        if (!agent.machineId) {
            return;
        }

        try {
            const actionsResponse = await this.sendToAgentServer(
                agent.machineId,
                '/poll-automation-actions',
                {},
                this.POLL_HTTP_TIMEOUT_MS,
            );

            const actionsData = await actionsResponse.json();

            if (!actionsData.success) {
                logger.warn`Agent ${agentId} ${agent.name} - poll-automation-actions failed: ${actionsData.error}`;
                return;
            }

            const { actions } = actionsData;

            if (!actions || actions.length === 0) {
                return;
            }

            logger.info`Agent ${agentId} ${agent.name} - Polled ${actions.length} automation action(s)`;

            for (const action of actions) {
                try {
                    if (action.type === 'stop_agent') {
                        logger.info`Agent ${agentId} ${agent.name} - Automation action: stop_agent from "${action.automationName}"`;
                        try {
                            // Interrupt the agent: sends ESC signal, finishes running prompts, transitions to IDLE
                            await this.interruptAgent(agentId);
                        } catch (error) {
                            // Agent might not be running - that's fine
                            logger.debug`Agent ${agentId} ${agent.name} - stop_agent action: agent not running or already idle: ${error}`;
                        }
                    } else if (action.type === 'queue_prompt' && action.payload?.promptText) {
                        logger.info`Agent ${agentId} ${agent.name} - Automation action: queue_prompt from "${action.automationName}": ${action.payload.promptText.substring(0, 80)}...`;
                        // Queue the prompt in the database - the polling system will pick it up
                        await this.repositories.agentPrompts.queuePrompt(agentId, action.payload.promptText);
                    } else {
                        logger.warn`Agent ${agentId} ${agent.name} - Unknown automation action type: ${action.type}`;
                    }
                } catch (error) {
                    logger.error`Agent ${agentId} ${agent.name} - Failed to process automation action ${action.type}: ${error}`;
                }
            }
        } catch (error) {
            logger.warn`Agent ${agentId} ${agent.name} - Failed to poll automation actions: ${error}`;
        }
    }

    private async pollAndSyncContextEvents(agent: Agent): Promise<void> {
        const agentId = agent.id;
        if (!agent.machineId) {
            return;
        }

        try {
            const eventsResponse = await this.sendToAgentServer(
                agent.machineId,
                '/poll-context-events',
                { agentId },
                this.POLL_HTTP_TIMEOUT_MS,
            );

            const eventsData = await eventsResponse.json();

            if (!eventsData.success) {
                logger.warn`Agent ${agentId} ${agent.name} - poll-context-events failed: ${eventsData.error}`;
                return;
            }

            const { events } = eventsData;

            if (!events || events.length === 0) {
                return;
            }

            logger.info`Agent ${agentId} ${agent.name} - Polled ${events.length} context event(s)`;

            for (const event of events) {
                try {
                    if (event.type === 'compaction_complete') {
                        await this.repositories.agentContextEvents.createCompactionComplete({
                            agentId,
                            taskId: agent.currentTaskId ?? null,
                            summary: event.data.summary,
                            tokensBefore: event.data.tokensBefore,
                            tokensAfter: event.data.tokensAfter,   // may be null
                            tokensSaved: event.data.tokensSaved    // may be null
                        });
                        logger.info`Agent ${agentId} - Created compaction complete event (tokensBefore: ${event.data.tokensBefore})`;

                        // Reset context threshold tracking after compaction
                        this.contextThresholds.delete(agentId);
                    }
                } catch (error) {
                    logger.error`Agent ${agentId} - Failed to sync context event: ${error}`;
                }
            }
        } catch (error) {
            logger.warn`Agent ${agentId} ${agent.name} - Failed to poll context events: ${error}`;
        }
    }

    /**
     * Periodically refresh the GitHub token on the agent machine.
     * Throttled to once per GITHUB_TOKEN_REFRESH_INTERVAL_MS. Fire-and-forget safe.
     */
    private async refreshGithubTokenIfNeeded(agent: Agent): Promise<void> {
        const agentId = agent.id;
        if (!agent.machineId) return;

        const lastRefresh = this.lastGithubTokenRefresh.get(agentId) || 0;
        if (Date.now() - lastRefresh < this.GITHUB_TOKEN_REFRESH_INTERVAL_MS) return;

        this.lastGithubTokenRefresh.set(agentId, Date.now());

        try {
            const githubTokens = await this.githubService.getUserTokens(agent.userId);
            if (githubTokens?.accessToken) {
                await this.sendToAgentServer(
                    agent.machineId,
                    '/update-github-token',
                    { githubToken: githubTokens.accessToken },
                    this.STATE_HTTP_TIMEOUT_MS
                );
                logger.debug`Agent ${agentId} ${agent.name} - Periodic GitHub token refresh`;
            }
        } catch (error) {
            logger.warn`Agent ${agentId} ${agent.name} - Failed periodic GitHub token refresh: ${error}`;
        }
    }

    private async pollAndSyncGitHistory(agent: Agent): Promise<void> {
        const agentId = agent.id;
        if (!agent.machineId) {
            logger.debug`Agent ${agentId} ${agent.name} - Skipping git history poll: no machineId`;
            return;
        }

        try {
            // Call git-history endpoint on agents-server
            const historyResponse = await this.sendToAgentServer(
                agent.machineId,
                '/git-history',
                {
                    agentId,
                    gitHistoryLastPushedCommitSha: agent.gitHistoryLastPushedCommitSha,
                    agentCreatedAt: agent.createdAt?.getTime(),
                    startCommitSha: agent.startCommitSha || null
                }
            );

            const historyData = await historyResponse.json();
            if (!historyData.success) {
                logger.warn`Agent ${agentId} ${agent.name} - git-history failed: ${historyData.error}`;
                return;
            }

            const { commits, uncommittedChanges, totalDiff, currentBranchName } = historyData;

            // Update agent's branchName if it has changed
            if (currentBranchName && currentBranchName !== agent.branchName) {
                await this.repositories.agents.updateAgentFields(agentId, {
                    branchName: currentBranchName
                });
                logger.info`Agent ${agentId} ${agent.name} - Updated branch name to: ${currentBranchName}`;
            }

            // Get existing commits in DB
            const existingCommits = await this.repositories.agentCommits.getAgentCommits(agentId);
            const existingCommitsBySha = new Map(existingCommits.map(c => [c.commitSha, c]));

            // Track which commits we've seen from git history
            const seenShas = new Set<string>();

            // Get project to construct commit URLs
            const project = await this.repositories.projects.findById(agent.projectId);

            // Upsert each commit from git history
            for (const gitCommit of commits) {
                seenShas.add(gitCommit.sha);

                // Construct commit URL if pushed
                let commitUrl: string | null = null;
                if (gitCommit.isPushed) {
                    if (project?.repositoryId) {
                        const repoFullName = await this.repositories.repositories.getRepositoryFullName(project.repositoryId);
                        if (repoFullName) {
                            commitUrl = `https://github.com/${repoFullName}/commit/${gitCommit.sha}`;
                        }
                    } else if (project?.cloneUrl) {
                        commitUrl = constructCommitUrl(project.cloneUrl, gitCommit.sha);
                    }
                }

                const stats = calculatePatchStats(gitCommit.patch || '');

                await this.repositories.agentCommits.upsertCommit({
                    agentId,
                    projectId: agent.projectId,
                    commitSha: gitCommit.sha,
                    commitMessage: gitCommit.title,
                    commitUrl,
                    branchName: gitCommit.branchName,
                    title: gitCommit.title,
                    commitPatch: gitCommit.patch,
                    taskId: null, // Will be assigned below
                    filesChanged: stats.filesChanged,
                    additions: stats.additions,
                    deletions: stats.deletions,
                    timestamp: gitCommit.timestamp,
                    pushed: gitCommit.isPushed,
                    pushedAt: gitCommit.isPushed ? new Date(gitCommit.timestamp) : null
                });
            }

            // Build a map of seen commit timestamps for amended-duplicate detection.
            // git commit --amend changes the SHA but preserves the author timestamp,
            // so two DB records with the same timestamp but different SHAs indicate
            // a pre-amend ghost that should be cleaned up.
            const seenTimestamps = new Map<number, string>(); // timestamp → sha
            for (const gitCommit of commits) {
                seenTimestamps.set(gitCommit.timestamp, gitCommit.sha);
            }

            // Mark commits that disappeared from git history as deleted.
            // IMPORTANT: When gitHistoryLastPushedCommitSha is set, the agent-server
            // only returns commits AFTER that SHA (git rev-list {sha}..HEAD). Commits
            // at or before that SHA are intentionally omitted — they still exist in git,
            // they're just not re-fetched. We must NOT mark those as deleted.
            // Only mark a commit as deleted if it was unpushed (should still appear in
            // the rev-list range) or if we did a full fetch (no gitHistoryLastPushedCommitSha).
            const didPartialFetch = !!agent.gitHistoryLastPushedCommitSha;
            for (const existingCommit of existingCommits) {
                if (seenShas.has(existingCommit.commitSha) || existingCommit.isDeleted) continue;

                // Detect amended duplicates: same author timestamp as a seen commit
                // but different SHA means this is a stale pre-amend record.
                const commitTs = existingCommit.createdAt?.getTime();
                if (commitTs && seenTimestamps.has(commitTs) && seenTimestamps.get(commitTs) !== existingCommit.commitSha) {
                    await this.repositories.agentCommits.update(existingCommit.id, {
                        isDeleted: true,
                        deletedAt: new Date()
                    });
                    continue;
                }

                // With a partial fetch, only consider unpushed commits as candidates
                // for deletion. Pushed commits before the cutoff simply weren't re-fetched.
                if (didPartialFetch && existingCommit.pushed) continue;

                await this.repositories.agentCommits.update(existingCommit.id, {
                    isDeleted: true,
                    deletedAt: new Date()
                });
            }

            // Auto-assign taskIds based on prompt chronology
            await this.assignTaskIdsToCommits(agentId);

            // Update agent's lastCommitSha to the latest non-deleted commit
            // This ensures manual commits show up correctly in the UI
            // commits array is sorted oldest-first (reversed from git rev-list), so last element is latest
            const latestCommit = commits[commits.length - 1];
            if (latestCommit && latestCommit.sha !== agent.lastCommitSha) {
                let commitUrl: string | null = null;
                if (latestCommit.isPushed) {
                    if (project?.repositoryId) {
                        const repoFullName = await this.repositories.repositories.getRepositoryFullName(project.repositoryId);
                        if (repoFullName) {
                            commitUrl = `https://github.com/${repoFullName}/commit/${latestCommit.sha}`;
                        }
                    } else if (project?.cloneUrl) {
                        commitUrl = constructCommitUrl(project.cloneUrl, latestCommit.sha);
                    }
                }

                await this.repositories.agents.updateAgentFields(agentId, {
                    lastCommitSha: latestCommit.sha,
                    lastCommitUrl: commitUrl,
                    lastCommitAt: new Date(latestCommit.timestamp),
                    lastCommitPushed: latestCommit.isPushed,
                    lastCommitName: latestCommit.title
                });
            }

            // Update AgentAttachments with totalDiff, pendingDiff, and claudeDirectoryZip
            // Prepare attachment data
            const attachmentData: {
                totalDiff: string;
                pendingDiff: string;
                claudeDirectoryZip?: string;
            } = {
                totalDiff,
                pendingDiff: uncommittedChanges?.patch || ''
            };

            // Poll and update .claude directory
            try {
                const claudeResponse = await this.sendToAgentServer(
                    agent.machineId,
                    '/get-claude-dir',
                    {}
                );

                const claudeData = await claudeResponse.json();
                if (claudeData.success && claudeData.claudeDirectoryZip) {
                    attachmentData.claudeDirectoryZip = claudeData.claudeDirectoryZip;
                }
            } catch (error) {
                logger.warn`Agent ${agentId} ${agent.name} - Failed to fetch claude directory: ${error}`;
                // Non-fatal
            }

            // Single upsert with all data to avoid overwriting
            await this.repositories.agentAttachments.upsertAttachments(agentId, attachmentData);

            // Update agent.gitHistoryLastPushedCommitSha
            const pushedCommits = commits.filter((c: typeof commits[number]) => c.isPushed);
            if (pushedCommits.length > 0) {
                const lastPushed = pushedCommits[pushedCommits.length - 1];
                if (lastPushed.sha !== agent.gitHistoryLastPushedCommitSha) {
                    await this.repositories.agents.updateAgentFields(agentId, {
                        gitHistoryLastPushedCommitSha: lastPushed.sha
                    });
                }
            }

            // Diffs are now polled via HTTP, no pubsub notification needed

        } catch (error) {
            logger.debug`Agent ${agentId} ${agent.name} - Failed to poll and sync git history: ${error}`;
            // Don't throw - not critical for agent operation
        }
    }

    private async assignTaskIdsToCommits(agentId: string): Promise<void> {
        // Get all commits and prompts
        const commits = await this.repositories.agentCommits.getAgentCommits(agentId);
        const prompts = await this.repositories.agentPrompts.getAllPrompts(agentId);

        // Sort commits by timestamp
        const sortedCommits = commits
            .filter(c => !c.isDeleted && c.createdAt)
            .sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));

        // Sort prompts by creation time
        const sortedPrompts = prompts.sort((a, b) =>
            (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0)
        );

        // For each commit, find the prompt P where:
        // commit.createdAt >= P.createdAt && (no P+1 or commit.createdAt < P+1.createdAt)
        for (const commit of sortedCommits) {
            const commitTime = commit.createdAt?.getTime() || 0;

            let assignedPrompt: typeof prompts[0] | null = null;
            for (let i = 0; i < sortedPrompts.length; i++) {
                const prompt = sortedPrompts[i];
                const promptTime = prompt.createdAt?.getTime() || 0;
                const nextPrompt = sortedPrompts[i + 1];
                const nextPromptTime = nextPrompt?.createdAt?.getTime() || Infinity;

                if (commitTime >= promptTime && commitTime < nextPromptTime) {
                    assignedPrompt = prompt;
                    break;
                }
            }

            // Update commit if taskId changed
            if (assignedPrompt && commit.taskId !== assignedPrompt.id) {
                await this.repositories.agentCommits.update(commit.id, {
                    taskId: assignedPrompt.id
                });
            }
        }
    }

    // Removed old executeInitState - replaced by unified flow

    private async createCheckpointForTask(agentId: string, taskId: string): Promise<void> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) {
            logger.error`Agent ${agentId} - Could not find agent in database for checkpoint`;
            return;
        }
        if (!agent.machineId) {
            logger.error`Agent ${agentId} - Agent has no machine ID for checkpoint`;
            return;
        }

        // If a push was pending (blocked by on_before_push_pr automations), resume push directly
        if (agent.pendingPushPrTriggered) {
            await this.autoPushIfOpenPR(agentId, agent.machineId);
            return;
        }

        try {
            // Get the prompt content for commit message
            const prompt = await this.repositories.agentPrompts.getPromptById(taskId);
            if (!prompt) {
                logger.error`Agent ${agentId} - Could not find prompt ${taskId} for checkpoint`;
                return;
            }

            // Check for changes
            const statusResponse = await this.sendToAgentServer(
                agent.machineId,
                '/git-status',
                { agentId },
                this.STATE_HTTP_TIMEOUT_MS
            );
            const statusData = await statusResponse.json();

            if (!statusData.hasChanges) {
                // logger.debug`Agent ${agentId} task ${taskId} - No changes to checkpoint`;
                return;
            }

            // Trigger on_before_commit automations if not already triggered
            // Blocking state is tracked on agents-server and checked by caller via hasBlockingAutomation
            if (!agent.pendingCommitTriggered) {
                logger.info`Agent ${agentId} - Triggering on_before_commit automations`;
                const blockingIds = await this.triggerAutomations(agent, 'on_before_commit');
                if (blockingIds.length > 0) {
                    // Blocking automations are now tracked on agents-server (startBlockingAutomation called before HTTP response)
                    // Caller will re-check hasBlockingAutomation after this function returns
                    await this.repositories.agents.updateAgentFields(agentId, {
                        pendingCommitTriggered: true
                    });
                    logger.info`Agent ${agentId} - Waiting for ${blockingIds.length} blocking on_before_commit automation(s)`;
                    return; // Don't commit yet, wait for automations to finish
                }
            }

            // Reset pending flag since we're proceeding with commit
            if (agent.pendingCommitTriggered) {
                await this.repositories.agents.updateAgentFields(agentId, {
                    pendingCommitTriggered: false
                });
            }

            // Commit with prompt content as message
            const commitMessage = `Task: ${prompt.prompt.substring(0, 72)}${prompt.prompt.length > 72 ? '...' : ''}`;

            // Get all prompts for this agent to pass to commit handler for name generation
            const allPrompts = await this.repositories.agentPrompts.getAllPrompts(agentId);
            const conversationMessages = allPrompts.map((p: { prompt: string; createdAt: Date | null }) => ({
                prompt: p.prompt,
                timestamp: p.createdAt?.getTime() || Date.now()
            }));

            const commitResponse = await this.sendToAgentServer(
                agent.machineId,
                '/git-commit-and-return',
                {
                    agentId,
                    message: commitMessage,
                    conversationMessages
                },
                this.COMMIT_HTTP_TIMEOUT_MS
            );

            const commitData = await commitResponse.json();
            if (!commitData.success) {
                logger.info`Agent ${agentId} task ${taskId} - No changes to commit`;
                return;
            }

            // Note: Don't create commit in DB - git-history polling will pick it up automatically
            logger.info`Agent ${agentId} - Committed changes for task ${taskId}, SHA: ${commitData.commit.sha}`;

            // Trigger on_after_commit automations (fire-and-forget, blocking tracked on agents-server)
            await this.triggerAutomations(agent, 'on_after_commit');

            // Auto-push if the agent has an open PR
            await this.autoPushIfOpenPR(agentId, agent.machineId);

        } catch (error) {
            logger.error`Agent ${agentId} - Failed to create checkpoint for task ${taskId}: ${error}`;
            throw error; // Fail loud
        }
    }

    /**
     * Auto-push to remote if the agent has an open PR.
     * Follows the same blocking automation pattern as auto-commit:
     * triggers on_before_push_pr (blocking), pushes, then on_after_push_pr (fire-and-forget).
     */
    private async autoPushIfOpenPR(agentId: string, machineId: string): Promise<void> {
        // Re-fetch agent to get latest PR state
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) return;

        if (agent.prState !== 'open' || !agent.prNumber) {
            // If push was pending but PR is no longer open, clear the flag
            if (agent.pendingPushPrTriggered) {
                await this.repositories.agents.updateAgentFields(agentId, {
                    pendingPushPrTriggered: false
                });
            }
            return;
        }

        try {
            // Trigger on_before_push_pr automations if not already triggered
            if (!agent.pendingPushPrTriggered) {
                logger.info`Agent ${agentId} - Triggering on_before_push_pr automations`;
                const blockingIds = await this.triggerAutomations(agent, 'on_before_push_pr');
                if (blockingIds.length > 0) {
                    await this.repositories.agents.updateAgentFields(agentId, {
                        pendingPushPrTriggered: true
                    });
                    logger.info`Agent ${agentId} - Waiting for ${blockingIds.length} blocking on_before_push_pr automation(s)`;
                    return; // Don't push yet, wait for automations to finish
                }
            }

            // Reset pending flag since we're proceeding with push
            if (agent.pendingPushPrTriggered) {
                await this.repositories.agents.updateAgentFields(agentId, {
                    pendingPushPrTriggered: false
                });
            }

            // Push
            logger.info`Agent ${agentId} - Auto-pushing (open PR #${agent.prNumber})`;
            const pushResponse = await this.sendToAgentServer(
                machineId,
                '/git-push',
                { agentId },
                this.PUSH_HTTP_TIMEOUT_MS
            );

            const pushData = await pushResponse.json();
            if (pushData.success) {
                logger.info`Agent ${agentId} - Auto-push succeeded for PR #${agent.prNumber}`;
            } else {
                logger.error`Agent ${agentId} - Auto-push failed: ${pushData.error || 'Unknown error'}`;
            }

            // Trigger on_after_push_pr automations (fire-and-forget)
            await this.triggerAutomations(agent, 'on_after_push_pr');

        } catch (error) {
            logger.error`Agent ${agentId} - Auto-push failed: ${error}`;
            // Don't throw - push failure shouldn't block the checkpoint flow
        }
    }

    async interruptAgent(agentId: string): Promise<void> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }
        if (!agent.isRunning) {
            throw new Error(`Agent ${agentId} not running`);
        }

        logger.debug`Agent ${agentId} - Interrupting agent`;

        // Try to send interrupt signal (ESC) to stop current execution
        let machineUnreachable = false;
        let claudeNotInitialized = false;

        const interruptResponse = await this.sendToAgentServer(agent.machineId!, '/interrupt');

        if (!interruptResponse.ok) {
            const errorData = await interruptResponse.json().catch(() => ({ error: 'Unknown error' }));
            const errorMessage = typeof errorData.error === 'string' ? errorData.error : JSON.stringify(errorData.error);

            // Check if this is a "Claude not initialized" error vs connection error
            if (errorMessage.includes('Claude service not initialized') || errorMessage.includes('not initialized')) {
                logger.warn`Agent ${agentId} - Cannot interrupt: Claude service not initialized on machine`;
                claudeNotInitialized = true;
            } else if (errorMessage.includes('Unable to connect') || errorMessage.includes('ConnectionRefused')) {
                logger.warn`Agent ${agentId} - Failed to send interrupt signal to machine (unreachable): ${errorMessage}`;
                machineUnreachable = true;
            } else {
                logger.warn`Agent ${agentId} - Failed to send interrupt signal: ${errorMessage}`;
                machineUnreachable = true;
            }
        }

        // If Claude service is not initialized, the agent is in a broken state
        // Don't clear prompts or change state - let the machine failure detection handle it
        if (claudeNotInitialized) {
            logger.warn`Agent ${agentId} - Agent machine has uninitialized Claude service, not clearing state`;
            throw new Error('Cannot interrupt: agent machine has uninitialized Claude service. The machine may need to be reprovisioned.');
        }

        // Finish any running prompts (mark them as interrupted/finished)
        await this.repositories.agentPrompts.finishRunningPromptsForAgent(agentId);

        // Clear pending flags since task is being interrupted
        // Blocking automations are tracked on agents-server and will clear when they finish
        await this.repositories.agents.updateAgentFields(agentId, {
            pendingCommitTriggered: false
        });

        // Set agent state to idle so it can accept new prompts immediately
        await this.repositories.agents.updateState(agentId, AgentState.IDLE);

        if (machineUnreachable) {
            logger.info`Agent ${agentId} - Interrupted (machine unreachable, state updated locally)`;
        } else {
            logger.info`Agent ${agentId} - Interrupted, cleared blocking state and finished running prompts`;
        }
    }


    async trashAgent(agentId: string): Promise<void> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }

        if (agent.isTrashed) {
            throw new Error(`Agent ${agentId} is already in trash`);
        }

        // Trash is a soft-delete: just set the flag. Don't change state, don't
        // clear machine info, don't delete machines. The poll loop already skips
        // trashed agents (handleStateLogic checks isTrashed).
        await this.repositories.agents.trashAgent(agentId);
        logger.debug`Agent ${agentId} ${agent.name} - Moved to trash`;
    }

    async untrashAgent(agentId: string): Promise<void> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent) {
            throw new Error(`Agent ${agentId} not found`);
        }

        if (!agent.isTrashed) {
            throw new Error(`Agent ${agentId} is not in trash`);
        }

        logger.debug`Agent ${agentId} - Starting untrash process`;

        try {
            await this.repositories.agents.untrashAgent(agentId);
            logger.debug`Agent ${agentId} ${agent.name} - Removed from trash successfully`;
        } catch (error) {
            logger.error`Agent ${agentId} ${agent.name} - Untrash failed: ${error}`;
            throw error;
        }
    }

    private cleanupAgentResources(agentId: string): void {
        // Clean up timers
        const stateTimer = this.stateTimers.get(agentId);
        if (stateTimer) {
            clearInterval(stateTimer);
            this.stateTimers.delete(agentId);
        }
        // Clean up all per-agent tracking maps to prevent unbounded growth
        this.machineFailureCount.delete(agentId);
        this.contextThresholds.delete(agentId);
        this.lastGitHistoryPoll.delete(agentId);
        this.lastProcessedMsgCount.delete(agentId);
        this.unproductiveRunningStart.delete(agentId);
        this.lastGithubTokenRefresh.delete(agentId);
    }

    /** Remove map entries for agents that are no longer running. Called periodically from poll loop. */
    sweepStaleAgentEntries(runningAgentIds: Set<string>): void {
        for (const map of [this.machineFailureCount, this.contextThresholds, this.lastGitHistoryPoll, this.lastProcessedMsgCount, this.unproductiveRunningStart, this.lastGithubTokenRefresh]) {
            for (const key of map.keys()) {
                if (!runningAgentIds.has(key)) {
                    map.delete(key);
                }
            }
        }
        // stateTimers need special cleanup (clearInterval)
        for (const [agentId, timer] of this.stateTimers.entries()) {
            if (!runningAgentIds.has(agentId)) {
                clearInterval(timer);
                this.stateTimers.delete(agentId);
            }
        }
    }

    async cleanupAllMachines(): Promise<void> {
        logger.debug`Cleaning up all existing machines...`;
        try {
            // First, mark all running agents as archived
            const agents = await this.repositories.agents.getAllAgents();
            for (const agent of agents) {
                if (agent.isRunning && agent.state !== AgentState.ARCHIVED) {
                    logger.debug`Agent ${agent.id} - Archiving agent due to system cleanup`;
                    await this.repositories.agents.updateState(agent.id, AgentState.ARCHIVED);
                    await this.repositories.agents.updateAgentFields(agent.id, {
                        isRunning: false,
                        isReady: false
                    });
                }
            }

            // Then cleanup the machine pool (this deletes all machines)
            await this.machinePoolService.cleanupAllMachines();

            // Clear all timers
            for (const timer of this.stateTimers.values()) {
                clearInterval(timer);
            }
            this.stateTimers.clear();

            logger.debug`Machine cleanup completed`;
        } catch (error) {
            logger.error`Failed to cleanup machines: ${error}`;
            throw error;
        }
    }

    // Expose SDK functionality for sync operations
    async sendToAgentServer(machineId: string, endpoint: string, body?: any, timeoutMs?: number): Promise<Response> {
        // Get agent info from database to get URL/ipv4 and sharedKey
        const dbStart = Date.now();
        const agent = await this.repositories.agents.getAgentByMachineId(machineId);
        const dbMs = Date.now() - dbStart;
        if (!agent || !agent.machineSharedKey || (!agent.machineUrl && !agent.machineIpv4)) {
            return new Response(JSON.stringify({ error: `Machine info not found for ${machineId}` }), { status: 500 });
        }

        // Use URL if available (HTTPS via cert-gateway), otherwise fall back to IP
        const target = agent.machineUrl || agent.machineIpv4!;
        const httpStart = Date.now();
        const result = await machineSDK.sendToMachine(target, agent.machineSharedKey, endpoint, body, timeoutMs);
        const httpMs = Date.now() - httpStart;

        // Log slow calls (>200ms total or >50ms DB)
        const totalMs = dbMs + httpMs;
        if (totalMs > 200 || dbMs > 50) {
            logger.debug`sendToAgentServer ${endpoint}: ${totalMs}ms (db:${dbMs}ms http:${httpMs}ms)`;
        }

        if (result.ok) {
            return new Response(JSON.stringify(result.data), { status: 200 });
        } else {
            return new Response(JSON.stringify({ error: result.data }), { status: 500 });
        }
    }

    /**
     * Helper method to send a request to agent server and ensure it succeeded.
     * Throws an error if the response status is not 200.
     */
    private async sendToAgentServerOrThrow(machineId: string, endpoint: string, body?: any, timeoutMs?: number): Promise<any> {
        const response = await this.sendToAgentServer(machineId, endpoint, body, timeoutMs);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Request to ${endpoint} failed: ${errorData.error || 'Unknown error'}`);
        }

        return response.json();
    }

    /**
     * Generate and rename branch based on the current prompt.
     * Only renames if this is the first prompt (branch still has auto-generated name).
     * Called asynchronously after prompt is sent to avoid blocking.
     */
    private async renameBranchFromPromptAsync(agentId: string, machineId: string, currentPrompt: string): Promise<void> {
        try {
            const agent = await this.repositories.agents.getAgentById(agentId);
            if (!agent) {
                logger.debug`Agent ${agentId} - Skipping branch rename: agent not found`;
                return;
            }

            // Check if branch name looks auto-generated (e.g., "ariana/name-xxxx" or "ariana/multi-word-name-xxxx")
            // If it already has a descriptive name, skip
            const autoGeneratedPattern = /^ariana\/[a-z-]+-[a-z0-9]{4}$/i;
            if (agent.branchName && !autoGeneratedPattern.test(agent.branchName)) {
                logger.debug`Agent ${agentId} ${agent.name} - Skipping branch rename: already has descriptive name "${agent.branchName}"`;
                return;
            }

            logger.info`Agent ${agentId} ${agent.name} - Renaming branch from prompt: ${currentPrompt.substring(0, 50)}...`;

            // Call the agents-server endpoint
            const response = await this.sendToAgentServer(
                machineId,
                '/rename-branch-from-prompt',
                {
                    agentId,
                    currentPrompt
                },
                30000 // 30 second timeout
            );

            const result = await response.json() as { success?: boolean; branchName?: string; error?: string };

            if (result.error) {
                logger.warn`Agent ${agentId} ${agent.name} - Branch rename error: ${result.error}`;
                return;
            }

            if (result.success && result.branchName) {
                await this.repositories.agents.updateAgentFields(agentId, { branchName: result.branchName });
                logger.info`Agent ${agentId} ${agent.name} - Branch renamed to: ${result.branchName}`;
            } else {
                logger.warn`Agent ${agentId} ${agent.name} - Branch rename returned empty result`;
            }
        } catch (error) {
            logger.warn`Agent ${agentId} - Failed to rename branch: ${error}`;
        }
    }

    /**
     * Generate task summary for an agent based on the current prompt.
     * Only generates if taskSummary is not already set (first prompt).
     * Called asynchronously after prompt is sent to avoid blocking.
     */
    private async generateTaskSummaryAsync(agentId: string, machineId: string, currentPrompt: string): Promise<void> {
        try {
            const agent = await this.repositories.agents.getAgentById(agentId);
            if (!agent) {
                logger.debug`Agent ${agentId} - Skipping task summary generation: agent not found`;
                return;
            }

            // Only generate task summary on first prompt - don't overwrite with follow-up prompts
            if (agent.taskSummary) {
                logger.debug`Agent ${agentId} ${agent.name} - Skipping task summary: already has "${agent.taskSummary}"`;
                return;
            }

            // Get recent prompts for context (optional, helps with multi-turn conversations)
            const recentPrompts = await this.repositories.agentPrompts.getAllPrompts(agentId);
            const recentPromptTexts = recentPrompts
                .slice(-5) // Last 5 prompts
                .map(p => p.prompt);

            logger.info`Agent ${agentId} ${agent.name} - Generating task summary for prompt: ${currentPrompt.substring(0, 50)}...`;

            // Call the agents-server endpoint
            const response = await this.sendToAgentServer(
                machineId,
                '/generate-task-summary',
                {
                    agentId,
                    currentPrompt,
                    recentPrompts: recentPromptTexts
                },
                30000 // 30 second timeout
            );

            const result = await response.json() as { success?: boolean; taskSummary?: string; error?: string };

            if (result.error) {
                logger.warn`Agent ${agentId} ${agent.name} - Task summary generation error: ${result.error}`;
                return;
            }

            if (result.success && result.taskSummary) {
                await this.repositories.agents.updateAgentFields(agentId, { taskSummary: result.taskSummary });
                logger.info`Agent ${agentId} ${agent.name} - Task summary set: ${result.taskSummary}`;
            } else {
                logger.warn`Agent ${agentId} ${agent.name} - Task summary generation returned empty result`;
            }
        } catch (error) {
            logger.warn`Agent ${agentId} - Failed to generate task summary: ${error}`;
        }
    }

    // Health check method - accepts URL or IP
    async healthCheckMachine(target: string): Promise<Response> {
        const result = await machineSDK.healthCheck(target);

        if (result.ok) {
            return new Response(JSON.stringify(result.data), { status: 200 });
        } else {
            return new Response(JSON.stringify({ error: result.data }), { status: 500 });
        }
    }

    // REMOVED: getNewMachine() - now using queue-based reservation system

    async deleteMachine(machineId: string) {
        await this.machinePoolService.deleteMachine(machineId);
    }

    async getMachineInfo(machineId: string): Promise<{ ipv4: string } | null> {
        return await this.machinePoolService.getMachineInfo(machineId);
    }

    private async getConversationMessages(agent: Agent): Promise<ConversationMessage[] | null> {
        if (!agent.machineId) {
            return null;
        }

        try {
            const messagesResponse = await this.sendToAgentServer(
                agent.machineId,
                '/conversations',
                undefined,
                this.POLL_HTTP_TIMEOUT_MS,
            );

            const messagesData: {
                messages: ConversationMessage[]
            } = JSON.parse(await messagesResponse.text());

            return messagesData.messages;
        } catch (error) {
            logger.debug`Agent ${agent.id} - Failed to get conversation messages: ${error}`;
            return [];
        }
    }

    private async getClaudeState(agent: Agent): Promise<ClaudeStateResponse | null> {
        if (!agent.machineId) {
            return null;
        }

        try {
            const response = await this.sendToAgentServer(
                agent.machineId,
                '/claude-state',
                undefined,
                this.POLL_HTTP_TIMEOUT_MS,
            );

            const stateData: ClaudeStateResponse = await response.json();
            // Reset failure counter on successful communication
            this.machineFailureCount.delete(agent.id);
            return stateData;
        } catch (error) {
            logger.debug`Agent ${agent.id} - Failed to get Claude state: ${error}`;
            return null;
        }
    }

    /**
     * Track machine communication failure and return true if threshold exceeded.
     * When threshold is exceeded, transitions agent to ERROR state and fails active prompts.
     */
    private async trackMachineFailure(agent: Agent): Promise<boolean> {
        const agentId = agent.id;
        const currentCount = (this.machineFailureCount.get(agentId) || 0) + 1;
        this.machineFailureCount.set(agentId, currentCount);

        logger.warn`Agent ${agentId} ${agent.name} - Machine unreachable (failure ${currentCount}/${this.MACHINE_FAILURE_THRESHOLD})`;

        if (currentCount >= this.MACHINE_FAILURE_THRESHOLD) {
            logger.error`Agent ${agentId} ${agent.name} - Machine confirmed dead after ${currentCount} consecutive failures, transitioning to ERROR`;

            // Fail all active prompts
            const failedCount = await this.repositories.agentPrompts.failActivePromptsForAgent(agentId);
            if (failedCount > 0) {
                logger.warn`Agent ${agentId} ${agent.name} - Failed ${failedCount} active prompt(s) due to machine death`;
            }

            // Transition to ERROR state
            await this.repositories.agents.updateState(agentId, AgentState.ERROR);

            // Clean up all per-agent tracking maps
            this.cleanupAgentResources(agentId);

            return true;
        }

        return false;
    }

    /**
     * Check if context usage crossed a 10% threshold and create warning event if needed.
     * Called every polling cycle when we have valid context usage data.
     */
    private async checkContextThreshold(agent: Agent, contextUsage: { usedPercent: number; remainingPercent: number; totalTokens: number }): Promise<void> {
        const agentId = agent.id;
        const { usedPercent, remainingPercent, totalTokens } = contextUsage;

        // Get last emitted threshold for this agent (default to 70% = start warning at 60%)
        // We only warn when remaining drops below 60%, so first warning is at 60% threshold
        const lastThreshold = this.contextThresholds.get(agentId) ?? 70;

        // Calculate current threshold (rounded down to nearest 10)
        const currentThreshold = Math.floor(remainingPercent / 10) * 10;

        // Emit warning if we crossed DOWN through a threshold
        if (currentThreshold < lastThreshold) {
            logger.info`Agent ${agentId} ${agent.name} - Context threshold crossed: ${remainingPercent}% remaining (was at ${lastThreshold}% threshold)`;

            // Create context warning event in database
            await this.repositories.agentContextEvents.createContextWarning({
                agentId,
                taskId: agent.currentTaskId ?? null,
                contextUsedPercent: usedPercent,
                contextRemainingPercent: remainingPercent,
                inputTokens: totalTokens, // We only have total, not broken down
                cacheTokens: 0, // Could be enhanced if SDK provides this breakdown
                contextWindow: 200000 // Default context window for Claude models
            });

            // Update last emitted threshold
            this.contextThresholds.set(agentId, currentThreshold);
        }
    }

    /**
     * Reset context threshold tracking for an agent (call after reset or compaction).
     */
    resetContextThreshold(agentId: string): void {
        this.contextThresholds.delete(agentId);
    }

    /**
     * Save Claude Code OAuth token for a user
     */
    async saveClaudeCodeOauthToken(userId: string, token: string): Promise<User | null> {
        try {
            // logger.info`Saving Claude Code OAuth token for user: ${userId}`;
            const user = await this.repositories.users.saveClaudeCodeOauthToken(userId, token);

            if (user) {
                // logger.info`Claude Code OAuth token saved successfully for user: ${userId}`;
            } else {
                logger.error`Failed to save Claude Code OAuth token for user: ${userId}`;
            }

            return user;
        } catch (error) {
            logger.error`Error saving Claude Code OAuth token for user ${userId}: ${error}`;
            return null;
        }
    }

    /**
     * Remove Claude Code OAuth token for a user
     */
    async removeClaudeCodeOauthToken(userId: string): Promise<User | null> {
        try {
            logger.info`Removing Claude Code OAuth token for user: ${userId}`;
            const user = await this.repositories.users.removeClaudeCodeOauthToken(userId);

            if (user) {
                logger.info`Claude Code OAuth token removed successfully for user: ${userId}`;
            } else {
                logger.error`Failed to remove Claude Code OAuth token for user: ${userId}`;
            }

            return user;
        } catch (error) {
            logger.error`Error removing Claude Code OAuth token for user ${userId}: ${error}`;
            return null;
        }
    }

    /**
     * Check if user has Claude Code OAuth token
     */
    async hasClaudeToken(userId: string): Promise<boolean> {
        try {
            const token = await this.repositories.users.getClaudeCodeOauthToken(userId);
            return token !== null && token !== undefined;
        } catch (error) {
            logger.error`Error checking Claude Code OAuth token for user ${userId}: ${error}`;
            return false;
        }
    }

    /**
     * Get automations for an agent that match a specific trigger type
     */
    private async getMatchingAutomations(
        agentId: string,
        triggerType: string,
        context?: { filePath?: string; command?: string; automationId?: string }
    ): Promise<Array<{ id: string; name: string; blocking: boolean; feedOutput: boolean; scriptLanguage: string; scriptContent: string; trigger: any }>> {
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent || !agent.environmentId) {
            return [];
        }

        const automations = await this.repositories.automations.getAutomationsForEnvironment(agent.environmentId);

        // Filter automations by trigger type
        const matching = automations.filter(a => {
            if (a.parsedData.trigger.type !== triggerType) {
                return false;
            }

            // Check context filters
            const trigger = a.parsedData.trigger;

            if (context?.filePath && trigger.fileGlob) {
                // Simple glob matching (convert glob to regex)
                const regexPattern = trigger.fileGlob
                    .replace(/\./g, '\\.')
                    .replace(/\*/g, '.*')
                    .replace(/\?/g, '.');
                const regex = new RegExp(`^${regexPattern}$`);
                if (!regex.test(context.filePath)) {
                    return false;
                }
            }

            if (context?.command && trigger.commandRegex) {
                try {
                    const regex = new RegExp(trigger.commandRegex);
                    if (!regex.test(context.command)) {
                        return false;
                    }
                } catch {
                    return false;
                }
            }

            if (context?.automationId && trigger.automationId) {
                if (trigger.automationId !== context.automationId) {
                    return false;
                }
            }

            // If no filter matches required, include it
            if (!trigger.fileGlob && !trigger.commandRegex && !trigger.automationId) {
                return true;
            }

            // If we got here, filters matched
            return true;
        });

        return matching.map(a => ({
            id: a.id,
            name: a.parsedData.name,
            blocking: a.parsedData.blocking,
            feedOutput: a.parsedData.feedOutput,
            scriptLanguage: a.parsedData.scriptLanguage,
            scriptContent: a.parsedData.scriptContent,
            trigger: a.parsedData.trigger
        }));
    }

    /**
     * Trigger automations for a specific event by calling /execute-automations on agents-server
     * Returns the IDs of blocking automations that were triggered
     */
    async triggerAutomations(
        agent: Agent,
        triggerType: string,
        context?: { filePath?: string; command?: string; automationId?: string }
    ): Promise<string[]> {
        if (!agent.machineId) {
            logger.warn`Agent ${agent.id} - Cannot trigger automations: no machineId`;
            return [];
        }

        let matchingAutomations = await this.getMatchingAutomations(agent.id, triggerType, context);

        if (matchingAutomations.length === 0) {
            logger.debug`Agent ${agent.id} ${agent.name} - No automations to trigger for ${triggerType}`;
            return [];
        }

        // For on_before_commit triggers, filter out automations that are already running
        // or have already run since the last commit
        if (triggerType === 'on_before_commit') {
            const automationsToSkip = new Set<string>();

            for (const automation of matchingAutomations) {
                // Check if automation is currently running
                const isRunning = await this.repositories.automationEvents.isAutomationRunning(agent.id, automation.id);
                if (isRunning) {
                    logger.info`Agent ${agent.id} - Skipping automation ${automation.name} (${automation.id}): already running`;
                    automationsToSkip.add(automation.id);
                    continue;
                }

                // Check if automation has run since the last commit (no new commit since then)
                const latestEvent = await this.repositories.automationEvents.getLatestCompletedEvent(agent.id, automation.id);
                if (latestEvent && latestEvent.finishedAt) {
                    // Get the latest commit time for this agent
                    const lastCommitAt = agent.lastCommitAt;

                    // If the automation finished after the last commit (or no commits yet), skip it
                    if (!lastCommitAt || latestEvent.finishedAt > lastCommitAt) {
                        logger.info`Agent ${agent.id} - Skipping automation ${automation.name} (${automation.id}): already ran since last commit`;
                        automationsToSkip.add(automation.id);
                    }
                }
            }

            // Filter out skipped automations
            if (automationsToSkip.size > 0) {
                matchingAutomations = matchingAutomations.filter(a => !automationsToSkip.has(a.id));
                if (matchingAutomations.length === 0) {
                    logger.debug`Agent ${agent.id} ${agent.name} - All on_before_commit automations skipped (already running or ran since last commit)`;
                    return [];
                }
            }
        }

        logger.info`Agent ${agent.id} ${agent.name} - Triggering ${matchingAutomations.length} automation(s) for ${triggerType}`;
        matchingAutomations.forEach(a => {
            logger.info`Agent ${agent.id} - Automation: ${a.name} (${a.id}) blocking=${a.blocking}`;
        });

        // Call /execute-automations on agents-server with full automation configs
        // so the agent-server always uses the latest version from the database
        try {
            const response = await this.sendToAgentServer(
                agent.machineId,
                '/execute-automations',
                {
                    automationIds: matchingAutomations.map(a => a.id),
                    automations: matchingAutomations.map(a => ({
                        id: a.id,
                        name: a.name,
                        trigger: a.trigger,
                        scriptLanguage: a.scriptLanguage,
                        scriptContent: a.scriptContent,
                        blocking: a.blocking,
                        feedOutput: a.feedOutput
                    })),
                    triggerType,
                    context
                },
                this.AUTOMATION_HTTP_TIMEOUT_MS
            );

            const result = await response.json();
            if (!result.success) {
                logger.error`Agent ${agent.id} - Failed to trigger automations: ${result.error}`;
                return [];
            }

            logger.info`Agent ${agent.id} - Successfully triggered ${result.executedCount} automation(s)`;

            // Only return IDs of blocking automations that were ACTUALLY executed by agents-server
            // This prevents blocking on automations that agents-server doesn't have loaded
            const executedIds = new Set<string>(result.automationIds || []);
            const blockingIds = matchingAutomations
                .filter(a => a.blocking && executedIds.has(a.id))
                .map(a => a.id);

            if (blockingIds.length !== matchingAutomations.filter(a => a.blocking).length) {
                const skippedCount = matchingAutomations.filter(a => a.blocking).length - blockingIds.length;
                logger.warn`Agent ${agent.id} - ${skippedCount} blocking automation(s) were not executed by agents-server (not loaded on machine)`;
            }

            return blockingIds;
        } catch (error) {
            logger.error`Agent ${agent.id} - Error triggering automations: ${error}`;
            return [];
        }
    }

    /**
     * Handle tool use automations (on_after_read_files, on_after_edit_files, on_after_run_command)
     */
    private async handleToolUseAutomations(
        agent: Agent,
        tools: Array<{ use: { name: string; input?: any }; result?: any }>
    ): Promise<void> {
        for (const tool of tools) {
            const toolName = tool.use.name;
            const toolInput = tool.use.input || {};

            let triggerType: string | null = null;
            let context: { filePath?: string; command?: string } = {};

            // Detect tool type and build context
            if (toolName === 'Read' && toolInput.file_path) {
                triggerType = 'on_after_read_files';
                context = { filePath: toolInput.file_path };
            } else if (toolName === 'Edit' && toolInput.file_path) {
                triggerType = 'on_after_edit_files';
                context = { filePath: toolInput.file_path };
            } else if (toolName === 'Write' && toolInput.file_path) {
                triggerType = 'on_after_edit_files';
                context = { filePath: toolInput.file_path };
            } else if (toolName === 'Bash' && toolInput.command) {
                triggerType = 'on_after_run_command';
                context = { command: toolInput.command };
            }

            if (triggerType) {
                logger.debug`Agent ${agent.id} - Tool ${toolName} detected, triggering ${triggerType}`;
                try {
                    await this.triggerAutomations(agent, triggerType, context);
                } catch (error) {
                    logger.error`Agent ${agent.id} - Failed to trigger ${triggerType} automation: ${error}`;
                }
            }
        }
    }

    /**
     * Sync PR state from GitHub for an agent
     * Called periodically to detect merged/closed PRs
     */
    async syncPRStateFromGitHub(agent: Agent): Promise<void> {
        const agentId = agent.id;

        // Throttle: only sync PR state every 30 seconds per agent
        const PR_SYNC_INTERVAL_MS = 30_000;
        if (agent.prLastSyncedAt) {
            const elapsed = Date.now() - new Date(agent.prLastSyncedAt).getTime();
            if (elapsed < PR_SYNC_INTERVAL_MS) {
                return;
            }
        }

        // Get project to find repository info
        const project = await this.repositories.projects.findById(agent.projectId);
        if (!project?.repositoryId) {
            return; // No repository linked
        }

        const repository = await this.repositories.repositories.findById(project.repositoryId);
        if (!repository) {
            return;
        }

        const repoFullName = repository.fullName;

        // If agent has a PR URL, check its current state
        if (agent.prUrl && agent.prNumber) {
            const prState = await this.githubService.getPullRequestState(
                agent.userId,
                repoFullName,
                agent.prNumber
            );

            if (prState) {
                // Check if the PR's head branch still matches the agent's current branch
                // If agent switched branches, we need to clear old PR data and look for new PR
                if (agent.branchName && prState.headBranch !== agent.branchName) {
                    logger.info`Agent ${agentId} - Branch changed from ${prState.headBranch} to ${agent.branchName}, clearing old PR #${agent.prNumber} and searching for new PR`;

                    // Clear old PR data first
                    await this.repositories.agents.updateAgentFields(agentId, {
                        prNumber: null,
                        prState: null,
                        prUrl: null,
                        prBaseBranch: null,
                        prLastSyncedAt: new Date()
                    });

                    // Now search for a PR on the new branch
                    const latestPR = await this.githubService.findLatestPRForBranch(
                        agent.userId,
                        repoFullName,
                        agent.branchName
                    );

                    if (latestPR) {
                        let prStateValue: string;
                        if (latestPR.merged) {
                            prStateValue = 'merged';
                        } else if (latestPR.state === 'closed') {
                            prStateValue = 'closed';
                        } else {
                            prStateValue = 'open';
                        }

                        logger.info`Agent ${agentId} - Found PR #${latestPR.number} for new branch ${agent.branchName}`;
                        await this.repositories.agents.updateAgentFields(agentId, {
                            prNumber: latestPR.number,
                            prState: prStateValue,
                            prUrl: latestPR.url,
                            prBaseBranch: latestPR.baseBranch,
                            prLastSyncedAt: new Date()
                        });
                    }
                    return;
                }

                // Determine prState string value
                let prStateValue: string;
                if (prState.merged) {
                    prStateValue = 'merged';
                } else if (prState.state === 'closed') {
                    prStateValue = 'closed';
                } else {
                    prStateValue = 'open';
                }

                // If tracked PR is closed/merged, check if a newer open PR exists on the same branch
                if ((prStateValue === 'closed' || prStateValue === 'merged') && agent.branchName) {
                    const newerPR = await this.githubService.findLatestPRForBranch(
                        agent.userId,
                        repoFullName,
                        agent.branchName
                    );

                    if (newerPR && newerPR.number !== agent.prNumber && newerPR.state === 'open') {
                        logger.info`Agent ${agentId} - Found newer open PR #${newerPR.number} replacing closed/merged PR #${agent.prNumber}`;
                        await this.repositories.agents.updateAgentFields(agentId, {
                            prNumber: newerPR.number,
                            prState: 'open',
                            prUrl: newerPR.url,
                            prBaseBranch: newerPR.baseBranch,
                            prLastSyncedAt: new Date()
                        });
                        return;
                    }
                }

                // Update if changed
                if (prStateValue !== agent.prState || prState.baseBranch !== agent.prBaseBranch) {
                    logger.info`Agent ${agentId} - PR state changed: ${agent.prState} -> ${prStateValue}`;
                    await this.repositories.agents.updateAgentFields(agentId, {
                        prState: prStateValue,
                        prBaseBranch: prState.baseBranch,
                        prLastSyncedAt: new Date()
                    });
                } else {
                    // Always update sync timestamp so throttle works even when nothing changed
                    await this.repositories.agents.updateAgentFields(agentId, {
                        prLastSyncedAt: new Date()
                    });
                }
            }
        } else if (agent.branchName) {
            // No PR tracked yet, check if there's one for this branch
            const latestPR = await this.githubService.findLatestPRForBranch(
                agent.userId,
                repoFullName,
                agent.branchName
            );

            if (latestPR) {
                let prStateValue: string;
                if (latestPR.merged) {
                    prStateValue = 'merged';
                } else if (latestPR.state === 'closed') {
                    prStateValue = 'closed';
                } else {
                    prStateValue = 'open';
                }

                logger.info`Agent ${agentId} - Found PR #${latestPR.number} for branch ${agent.branchName}`;
                await this.repositories.agents.updateAgentFields(agentId, {
                    prNumber: latestPR.number,
                    prState: prStateValue,
                    prUrl: latestPR.url,
                    prBaseBranch: latestPR.baseBranch,
                    prLastSyncedAt: new Date()
                });
            } else {
                // No PR found — still update sync timestamp so throttle works
                await this.repositories.agents.updateAgentFields(agentId, {
                    prLastSyncedAt: new Date()
                });
            }
        }
    }

}
