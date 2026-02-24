import type { RepositoryContainer } from '@/data/repositories';
import type { ServiceContainer } from '@/services';
import type { Agent, AgentWithCreator } from '@shared/types';
import { AgentState } from '@shared/types';
import { generateForkName } from '@/utils/forkNaming';
import { enrichWithCreator } from '@/api/agents/handlers';
import { getLogger } from '@/utils/logger';

const logger = getLogger(['service', 'agentMovements']);

export interface ForkOrResumeParams {
  sourceAgentId: string;
  newOwnerId: string;
  newAgentName?: string;
  /** When true, always creates a new agent even if owner is forking their own archived agent */
  forceNewAgent?: boolean;
}

export interface UsageLimitError extends Error {
  code: 'LIMIT_EXCEEDED';
  limitInfo: {
    limitType: string;
    resourceType: string;
    current: number;
    max: number;
    isMonthlyLimit: boolean;
  };
}

export interface ForkOrResumeResult {
  targetAgentId: string;
  agent: AgentWithCreator;
  message: string;
}

export class AgentMovementsService {
  constructor(
    private repositoryContainer: RepositoryContainer,
    private services: ServiceContainer
  ) {}

  /**
   * Check and increment usage limits for agent creation.
   * Call this BEFORE forkOrResume when usage limits should be enforced.
   * Throws UsageLimitError if limit is exceeded.
   */
  async checkAgentUsageLimits(userId: string): Promise<void> {
    const limitCheck = await this.services.usageLimits.checkAndIncrementUsage(userId, 'agent');
    if (!limitCheck.allowed) {
      if (limitCheck.userNotFound) {
        throw new Error('User not found');
      }
      const error = new Error('Agent creation limit reached') as UsageLimitError;
      error.code = 'LIMIT_EXCEEDED';
      error.limitInfo = {
        limitType: limitCheck.limitType!,
        resourceType: limitCheck.resourceType!,
        current: limitCheck.current!,
        max: limitCheck.max!,
        isMonthlyLimit: limitCheck.isMonthlyLimit || false
      };
      throw error;
    }
  }

  /**
   * Ensures an agent is in a ready state (READY, IDLE, or RUNNING).
   * If the agent is ARCHIVED and the user is the owner, auto-resumes it.
   * This is the same resume flow that the "Resume" button uses.
   *
   * @param agentId - The agent to check/resume
   * @param userId - The user making the request (must be owner for auto-resume)
   * @returns The agent in a ready state
   * @throws Error if agent can't be made ready (non-owner, failed resume, timeout, etc.)
   */
  async ensureAgentReadyOrResume(agentId: string, userId: string): Promise<{
    agent: Agent;
    wasResumed: boolean;
  }> {
    const agent = await this.services.agents.getAgent(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    // If agent is already in a ready state, return immediately
    if ([AgentState.READY, AgentState.IDLE, AgentState.RUNNING].includes(agent.state as AgentState)) {
      return { agent, wasResumed: false };
    }

    // If agent is ARCHIVED and user is owner - auto-resume using the same flow as Resume button
    if (agent.state === AgentState.ARCHIVED && agent.userId === userId) {
      logger.info`Auto-resuming ARCHIVED agent ${agentId} for owner ${userId}`;

      // Call the SAME forkOrResume function that the Resume button uses
      await this.forkOrResume({
        sourceAgentId: agentId,
        newOwnerId: userId,
        newAgentName: undefined
      });

      // Wait for agent to reach READY or IDLE (with timeout)
      const timeout = 600000; // 10 minutes
      const startTime = Date.now();
      while (Date.now() - startTime < timeout) {
        const currentAgent = await this.services.agents.getAgent(agentId);
        if (!currentAgent) {
          throw new Error('Agent disappeared during resume');
        }

        if (currentAgent.state === AgentState.ERROR) {
          throw new Error('Agent failed to resume');
        }

        if (currentAgent.state === AgentState.READY || currentAgent.state === AgentState.IDLE) {
          logger.info`Agent ${agentId} successfully resumed to ${currentAgent.state} state`;
          return { agent: currentAgent, wasResumed: true };
        }

        await new Promise(r => setTimeout(r, 1000));
      }

      // Timeout - set to ERROR
      logger.error`Agent ${agentId} - Timeout waiting for resume, setting to ERROR`;
      await this.services.agents.updateAgent(agentId, { state: AgentState.ERROR });
      throw new Error('Timeout waiting for agent to resume');
    }

    // For non-owner trying to access ARCHIVED agent, or other non-ready states
    const stateMessages: Record<string, string> = {
      [AgentState.PROVISIONING]: 'Agent is still being created',
      [AgentState.PROVISIONED]: 'Agent is still being prepared',
      [AgentState.CLONING]: 'Agent is still cloning code',
      [AgentState.ARCHIVED]: 'Agent is archived and you are not the owner',
      [AgentState.ERROR]: 'Agent is in an error state'
    };

    throw new Error(stateMessages[agent.state as AgentState] || `Agent is in ${agent.state} state`);
  }

  /**
   * Fork an agent or resume an archived/error agent owned by the same user.
   * Extracted core logic from handleForkAgent handler.
   * Returns the target agent ID and enriched agent data, starts background setup.
   */
  async forkOrResume(params: ForkOrResumeParams): Promise<ForkOrResumeResult> {
    const { sourceAgentId, newOwnerId, newAgentName } = params;

    logger.info`Starting fork/resume: source=${sourceAgentId}, newOwner=${newOwnerId}`;

    // 1. Validate source agent
    const sourceAgent = await this.services.agents.getAgent(sourceAgentId);
    if (!sourceAgent) {
      throw new Error('Source agent not found');
    }

    // 2. Check access
    const hasAccess = await this.services.userAgentAccesses.getAccess(newOwnerId, sourceAgentId);
    if (!hasAccess) {
      throw new Error('New owner must have read access to source agent');
    }

    const isOwnerOperation = sourceAgent.userId === newOwnerId;

    // 2.5 Block forking from custom machines
    if (sourceAgent.machineType === 'custom') {
      throw new Error('Cannot fork agents running on custom machines');
    }

    // 2.6 Check snapshot exists (required for fork/resume)
    // Use machineId if available, otherwise fall back to lastMachineId (for archived agents)
    const snapshotMachineId = sourceAgent.machineId || sourceAgent.lastMachineId;
    if (!snapshotMachineId) {
      throw new Error('Cannot fork: source agent has no machine ID for snapshot lookup');
    }
    const hasSnapshot = await this.services.machineSnapshots.hasSnapshot(snapshotMachineId);
    if (!hasSnapshot) {
      throw new Error('Cannot fork: no snapshot available for this agent');
    }

    // Get the snapshot now so we have it for later
    const snapshot = await this.services.machineSnapshots.getLatestSnapshot(snapshotMachineId);
    if (!snapshot || !snapshot.r2Key) {
      throw new Error('Cannot fork: snapshot not found or incomplete');
    }

    // 3. Check machine pool capacity
    const activeMachineCount = await this.services.machinePool.getActiveMachineCount();
    const maxActiveMachines = parseInt(process.env.MAX_ACTIVE_MACHINES!);
    if (activeMachineCount >= maxActiveMachines) {
      const error = new Error('Server is currently at capacity. Please try again in a few minutes.');
      (error as any).code = 'MACHINE_POOL_EXHAUSTED';
      (error as any).details = { currentMachines: activeMachineCount, maxMachines: maxActiveMachines };
      throw error;
    }

    // 3.5 Guard against concurrent resume: if agent is already in a transitional state
    // (being provisioned/resumed by another call), don't fork - just bail out.
    // This prevents race conditions where two callers both call forkOrResume on the
    // same agent, and the second one sees PROVISIONING and incorrectly creates a fork.
    const transitionalStates = [AgentState.PROVISIONING, AgentState.PROVISIONED, AgentState.CLONING];
    if (!params.forceNewAgent && isOwnerOperation && transitionalStates.includes(sourceAgent.state as AgentState)) {
      logger.info`Agent ${sourceAgentId} is already in ${sourceAgent.state} state (resume likely in progress), skipping`;
      // Wait for it to finish provisioning and return the existing agent
      while (true) {
        const agent = await this.services.agents.getAgent(sourceAgentId);
        if (!agent) throw new Error('Agent disappeared during provisioning');
        if (agent.state === AgentState.ERROR) throw new Error('Agent failed during provisioning');
        if (![...transitionalStates, AgentState.ARCHIVED].includes(agent.state as AgentState)) {
          const enrichedAgent = await enrichWithCreator(agent, this.services);
          return { targetAgentId: sourceAgentId, agent: enrichedAgent, message: 'Agent resume already in progress' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 4. Check if this is owner resuming their own archived or error agent
    // Skip this if forceNewAgent is true (explicit fork should always create new agent)
    const isOwnerResuming = !params.forceNewAgent
      && (sourceAgent.state === AgentState.ARCHIVED || sourceAgent.state === AgentState.ERROR)
      && isOwnerOperation;

    let targetAgentId: string;

    if (isOwnerResuming) {
      // Resume archived/error agent - NOTE: caller should check usage limits before calling this
      logger.info`Owner resuming ${sourceAgent.state.toUpperCase()} agent ${sourceAgentId}`;

      targetAgentId = sourceAgentId;

      if (sourceAgent.state === AgentState.ARCHIVED) {
        await this.services.agents.resumeArchivedAgent(sourceAgentId);
      } else {
        // ERROR state - similar to resumeArchivedAgent but for error agents
        await this.services.agents.resumeErrorAgent(sourceAgentId);
      }

    } else {
      // Normal fork - create new agent
      // NOTE: caller should check usage limits before calling this

      // Create fork with proper name and environment
      const forkName = newAgentName || generateForkName(sourceAgent.name);
      // Inherit environment if:
      // 1. Same owner forking their own agent (isOwnerOperation), OR
      // 2. Forking a template agent (regardless of ownership - templates share their env)
      let environmentIdForFork: string | null = null;
      if (sourceAgent.environmentId && (isOwnerOperation || sourceAgent.isTemplate)) {
        environmentIdForFork = sourceAgent.environmentId;
      }

      targetAgentId = await this.services.agents.createAgent({
        projectId: sourceAgent.projectId,
        userId: newOwnerId,
        baseBranch: sourceAgent.baseBranch,
        name: forkName,
        environmentId: environmentIdForFork
      });
    }

    // 5. Wait for provisioning (no timeout - machines can take a long time)
    logger.info`Waiting for target agent ${targetAgentId} to reach PROVISIONED state`;
    while (true) {
      const agent = await this.services.agents.getAgent(targetAgentId);
      if (agent?.state === AgentState.PROVISIONED) break;
      if (agent?.state === AgentState.ERROR) throw new Error('Target agent failed to provision');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const provisionedAgent = await this.services.agents.getAgent(targetAgentId);
    if (!provisionedAgent?.machineId) throw new Error('Target agent has no machine ID');

    // 9. Enrich agent for response
    const enrichedAgent = await enrichWithCreator(provisionedAgent, this.services);

    // 10. Start background setup - inline the logic here
    (async () => {
      try {
        // Re-check machineId for TypeScript - we know it exists from check above
        if (!provisionedAgent.machineId) throw new Error('Target agent has no machine ID');
        // Copy database records if not resuming
        if (!isOwnerResuming) {
          logger.info`Copying database records from ${sourceAgentId} to ${targetAgentId}`;
          const promptCopyResult = await this.services.agents.copyPromptsFromAgent(sourceAgentId, targetAgentId);
          await Promise.all([
            this.services.agents.copyMessagesFromAgent(sourceAgentId, targetAgentId, promptCopyResult.idMapping),
            this.services.agents.copyResetsFromAgent(sourceAgentId, targetAgentId, promptCopyResult.idMapping)
          ]);

          await this.services.agents.updateAgentFields(targetAgentId, {
            branchName: provisionedAgent.branchName,
            gitHistoryLastPushedCommitSha: sourceAgent.gitHistoryLastPushedCommitSha,
            lastCommitSha: sourceAgent.lastCommitSha,
            lastCommitUrl: sourceAgent.lastCommitUrl,
            lastCommitAt: sourceAgent.lastCommitAt,
            lastCommitPushed: sourceAgent.lastCommitPushed,
            lastCommitName: sourceAgent.lastCommitName,
            lastPromptText: sourceAgent.lastPromptText,
            lastPromptAt: sourceAgent.lastPromptAt,
            lastToolName: sourceAgent.lastToolName,
            lastToolTarget: sourceAgent.lastToolTarget,
            lastToolAt: sourceAgent.lastToolAt,
            // Explicitly reset taskSummary so forked agent generates its own on first prompt
            taskSummary: null
          });
        }

        // Get git user info
        const targetUser = await this.services.users.getUserById(newOwnerId);
        if (!targetUser) throw new Error('Target user not found');

        let githubProfile = null;
        if (targetUser.githubProfileId) {
          githubProfile = await this.services.github.getUserGithubProfile(targetUser.id);
        }

        const gitUserName = githubProfile?.name || targetUser.id;
        const gitUserEmail = githubProfile?.email || `${targetUser.id}@github.local`;

        // Get active credentials from the unified config
        const { environment } = await this.services.users.getActiveCredentials(targetUser.id);

        // Restore snapshot to target machine
        logger.info`Restoring snapshot ${snapshot.id} to machine ${provisionedAgent.machineId}`;

        // Detect chunked vs legacy snapshot by r2Key format
        let restorePayload: { presignedDownloadUrls: string[] } | { presignedDownloadUrl: string };
        if (snapshot.r2Key!.endsWith('/')) {
          // Chunked snapshot: get download URLs for all chunks
          const presignedDownloadUrls = await this.services.machineSnapshots.getPresignedChunkDownloadUrls(snapshot.r2Key!);
          logger.info`Chunked snapshot: ${presignedDownloadUrls.length} chunks`;
          restorePayload = { presignedDownloadUrls };
        } else {
          // Legacy single-file snapshot
          const presignedDownloadUrl = await this.services.machineSnapshots.getPresignedDownloadUrl(snapshot.r2Key!);
          restorePayload = { presignedDownloadUrl };
        }

        const restoreResponse = await this.services.agents.sendToAgentServer(
          provisionedAgent.machineId,
          '/restore-snapshot',
          restorePayload,
          600000 // 10 min timeout for large snapshots
        );
        const restoreData = await restoreResponse.json();
        if (!restoreData.success) {
          const errorMsg = typeof restoreData.error === 'string'
            ? restoreData.error
            : JSON.stringify(restoreData.error || restoreData);
          throw new Error(`Failed to restore snapshot: ${errorMsg}`);
        }
        logger.info`Snapshot restored successfully to ${provisionedAgent.machineId}`;

        // Carry over the source snapshot as the new machine's first completed snapshot
        // so the agent is immediately forkable without waiting for the next snapshot cycle
        if (snapshot.machineId !== provisionedAgent.machineId) {
          await this.services.machineSnapshots.createCarriedOverSnapshot(
            provisionedAgent.machineId,
            snapshot.r2Key!,
            snapshot.sizeBytes
          );
          logger.info`Carried over snapshot from ${snapshot.machineId} to ${provisionedAgent.machineId}`;
        }

        // Wait for agent-server to be healthy after restore (restore restarts the service)
        const healthTarget = provisionedAgent.machineUrl || provisionedAgent.machineIpv4!;
        const maxHealthAttempts = 15;
        const healthDelay = 2000;
        logger.info`Waiting for agent-server to restart after restore on ${healthTarget}`;
        let healthPassed = false;
        for (let attempt = 1; attempt <= maxHealthAttempts; attempt++) {
          try {
            const healthResp = await this.services.agents.healthCheckMachine(healthTarget);
            if (healthResp.ok) {
              logger.info`Post-restore health check passed on attempt ${attempt}`;
              healthPassed = true;
              break;
            }
          } catch (e) {
            // expected while service is restarting
          }
          if (attempt < maxHealthAttempts) {
            await new Promise(r => setTimeout(r, healthDelay));
          }
        }
        if (!healthPassed) {
          throw new Error(`Agent server on ${healthTarget} failed to become healthy after snapshot restore (${maxHealthAttempts} attempts)`);
        }

        // Get the target agent to check for environment (may have been updated during fork)
        const targetAgent = await this.services.agents.getAgent(targetAgentId);
        if (!targetAgent) throw new Error('Target agent not found after restore');

        // Fetch automations from the agent's environment (if any) to pass to /start
        let automationsData: Array<{
          id: string;
          name: string;
          trigger: any;
          scriptLanguage: string;
          scriptContent: string;
          blocking: boolean;
          feedOutput: boolean;
        }> = [];
        if (targetAgent.environmentId) {
          const envAutomations = await this.repositoryContainer.automations.getAutomationsForEnvironment(targetAgent.environmentId);
          if (envAutomations.length > 0) {
            logger.info`Loading ${envAutomations.length} automation(s) for forked/resumed agent ${targetAgentId}`;
            automationsData = envAutomations.map(a => ({
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

        // Get GitHub token and repository for push operations
        // This is needed because globalState on agents-server doesn't persist across restores
        let githubToken: string | null = null;
        let githubRepository: string | null = null;
        try {
          const project = await this.services.projects.getProject(targetAgent.projectId);
          if (project?.repositoryId) {
            const repository = await this.services.repositories.getRepositoryById(project.repositoryId);
            if (repository?.fullName) {
              githubRepository = repository.fullName;
              const userTokens = await this.services.github.getUserTokens(newOwnerId);
              if (userTokens?.accessToken) {
                githubToken = userTokens.accessToken;
              }
            }
          }
        } catch (e) {
          logger.warn`Failed to get GitHub credentials for resumed agent ${targetAgentId}: ${e}`;
          // Continue without GitHub credentials - push will fail but agent will work
        }

        // Start agent with existing project (environment vars and automations passed here)
        // Retry up to 10 times with 3s delay. After snapshot restore, the agent-server
        // process may crash (e.g. due to restored state files) and systemd RestartSec=10
        // means we need to wait at least 10-15s for it to come back.
        let startData: any;
        let lastStartError: string | null = null;
        const maxStartAttempts = 10;
        const startRetryDelay = 3000;
        for (let attempt = 1; attempt <= maxStartAttempts; attempt++) {
          try {
            // Before each /start attempt, verify agent-server is healthy
            const startHealthTarget = provisionedAgent.machineUrl || provisionedAgent.machineIpv4!;
            const healthResp = await this.services.agents.healthCheckMachine(startHealthTarget);
            if (!healthResp.ok) {
              lastStartError = `Health check failed (status ${healthResp.status})`;
              throw new Error(lastStartError);
            }

            const startResponse = await this.services.agents.sendToAgentServer(
              provisionedAgent.machineId,
              '/start',
              {
                setup: {
                  type: 'existing',
                  targetBranch: provisionedAgent.branchName,
                  githubToken,
                  repository: githubRepository
                },
                gitUserName,
                gitUserEmail,
                credentials: {},
                environment,
                automations: automationsData,
                dontSendInitialMessage: true
              }
            );
            startData = await startResponse.json();
            if (startData.status === 'success') {
              break; // Success
            }
            lastStartError = typeof startData.error === 'string'
              ? startData.error
              : JSON.stringify(startData.error || startData);
          } catch (e: any) {
            lastStartError = e?.message || String(e);
          }
          if (attempt < maxStartAttempts) {
            logger.warn`Start agent attempt ${attempt}/${maxStartAttempts} failed: ${lastStartError}, retrying in ${startRetryDelay / 1000}s...`;
            await new Promise(r => setTimeout(r, startRetryDelay));
          }
        }
        if (!startData?.status || startData.status !== 'success') {
          throw new Error(`Failed to start agent after ${maxStartAttempts} attempts: ${lastStartError}`);
        }

        await this.services.agents.updateAgentFields(targetAgentId, {
          startCommitSha: sourceAgent.startCommitSha || null,
          gitHistoryLastPushedCommitSha: startData.gitHistoryLastPushedCommitSha || null
        });

        // Update to READY state and let the polling loop handle on_agent_ready
        // automations and the READY → IDLE transition. This is the same path that
        // fresh spawns use, and avoids a race condition where both this code and
        // the polling loop's READY handler could trigger on_agent_ready simultaneously.
        await this.services.agents.updateAgent(targetAgentId, {
          state: AgentState.READY,
          isRunning: true,
          isReady: true
        });

        // Update secrets
        await this.services.agents.updateSecretsForAgent(targetAgentId);

        logger.info`Agent fork/resume completed successfully: ${sourceAgentId} -> ${targetAgentId}`;
      } catch (error) {
        const err = error as any;
        const errorMessage = err?.message || String(error);
        logger.error`Background fork setup failed for ${targetAgentId}: ${errorMessage}`;
        console.error('[FORK-BACKGROUND-ERROR] Stack trace:', err?.stack || 'No stack trace');
        await this.services.agents.updateAgent(targetAgentId, {
          state: AgentState.ERROR,
          errorMessage: `Resume failed: ${errorMessage}`
        });
        // Fail queued prompts so the archive→resume loop doesn't repeat indefinitely
        // (without this, archived agents with queued prompts get auto-resumed every 60s,
        // fail again, get archived, and loop forever — burning bandwidth on snapshot uploads)
        try {
          const failedCount = await this.repositoryContainer.agentPrompts.failActivePromptsForAgent(targetAgentId);
          if (failedCount > 0) {
            logger.warn`Agent ${targetAgentId} - Failed ${failedCount} queued prompt(s) after resume failure`;
          }
        } catch (promptError) {
          logger.error`Agent ${targetAgentId} - Failed to mark prompts as failed: ${promptError}`;
        }
      }
    })();

    return {
      targetAgentId,
      agent: enrichedAgent,
      message: `Forked agent ${sourceAgentId} to ${targetAgentId}`
    };
  }

  /**
   * Auto-restore ERROR agents on server restart.
   * Constraints:
   * - Only agents created within last 2 days
   * - Max 1 agent per user per day (checked via lastAutoRestoredAt)
   * - Does NOT count towards usage limits (calls forkOrResume directly)
   */
  async restartErrorAgents(): Promise<void> {
    try {
      logger.info`Checking for ERROR agents to auto-restore...`;

      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const agents = await this.repositoryContainer.agents.getAllAgents();

      // Group eligible ERROR agents by user, pick most recent per user
      const userAgentMap = new Map<string, typeof agents[0]>();
      for (const agent of agents) {
        // Must be in ERROR state
        if (agent.state !== 'error') continue;

        // Must be created within last 2 days
        if (!agent.createdAt || agent.createdAt < twoDaysAgo) continue;

        // Must not have been auto-restored today
        if (agent.lastAutoRestoredAt && agent.lastAutoRestoredAt >= todayStart) continue;

        // Keep the most recent ERROR agent per user
        const existing = userAgentMap.get(agent.userId);
        if (!existing || (agent.createdAt > existing.createdAt!)) {
          userAgentMap.set(agent.userId, agent);
        }
      }

      if (userAgentMap.size === 0) {
        logger.info`No eligible ERROR agents found to auto-restore`;
        return;
      }

      logger.info`Found ${userAgentMap.size} user(s) with ERROR agents eligible for auto-restore`;

      let restoredCount = 0;
      for (const [userId, agent] of userAgentMap) {
        try {
          logger.info`Agent ${agent.id} - Auto-restoring ERROR agent for user ${userId}`;

          // Mark as auto-restored NOW to prevent duplicate attempts
          await this.repositoryContainer.agents.updateAgentFields(agent.id, {
            lastAutoRestoredAt: new Date()
          });

          // Use forkOrResume WITHOUT calling checkAgentUsageLimits (no limit cost)
          await this.forkOrResume({
            sourceAgentId: agent.id,
            newOwnerId: agent.userId
          });

          restoredCount++;
          logger.info`Agent ${agent.id} - Auto-restore initiated successfully`;
        } catch (error) {
          logger.error`Agent ${agent.id} - Failed to auto-restore ERROR agent: ${error}`;
          // Continue with other users
        }
      }

      logger.info`Auto-restored ${restoredCount} ERROR agent(s)`;
    } catch (error) {
      logger.error`Failed to restart ERROR agents: ${error}`;
      // Don't throw - this shouldn't block startup
    }
  }
}