
import { RepositoryContainer } from '@/data/repositories';
import { GitHubService } from './github.service';
import { PermissionService } from './permission.service';
import { getLogger } from '../utils/logger';
import type { Prompt } from "@shared/types/agent/prompt.types.ts";
import type { UserService } from './user.service';
import type { MachinePoolService } from './machinePool.service';
import { PortDomainService } from './portDomain.service';

const logger = getLogger(['agent']);

import {
  type AgentMessage,
  type AgentCommit,
  type AgentPrompt,
  type Agent,
  AgentState,
  type ChatEvent,
  type PromptEvent,
  type ResponseEvent,
  type GitCheckpointEvent,
  type ResetEvent,
  type AutomationEvent,
  type ContextWarningEvent,
  type CompactionStartEvent,
  type CompactionCompleteEvent,
  type ToolUse,
  type ToolResult,
  type AgentProviderConfig,
  getActiveEnvironment,
} from '../../shared/types';
import { ClaudeAgentService, RALPH_MODE_PROMPT } from './claude-agent.service';
import type { PersonalEnvironmentService } from './personalEnvironment.service';
import type { ClaudeOAuthService } from './claude-oauth.service';
import type { UsageLimitsService } from './usageLimits.service';
import type { AuthService } from './auth.service';
import type { AgentMovementsService } from './agentMovements.service';
import type { MachineSnapshotService } from './machineSnapshot.service';

/** Per-agent per-chain loop state */
interface ChainState {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
}

/** Timing snapshot for one chain execution */
interface ChainTiming {
  agentId: string;
  agentName: string;
  chain: 'data' | 'state';
  state: string;
  durationMs: number;
  detail: string; // human-readable detail line
}

export class AgentService {
  private claudeService: ClaudeAgentService;
  private usageLimitsService: UsageLimitsService;
  private agentMovementsService: AgentMovementsService | null = null;
  private machineSnapshotService: MachineSnapshotService | null = null;
  // Tracks when each agent entered continuous RUNNING state (worker 0 only).
  // Resets when agent leaves RUNNING. Lost on restart (agent gets another 24h, acceptable).
  private readonly runningStateSince = new Map<string, number>();

  // Per-agent per-chain independent polling
  private readonly activeChains = new Map<string, ChainState>(); // key = "agentId:data" or "agentId:state"
  private readonly sharedMsgCount = new Map<string, number>(); // written by data chain, read by state chain
  private readonly recentTimings: ChainTiming[] = []; // ring buffer for benchmark logging
  private readonly STALE_PR_CUTOFF_DAYS = 7;

  constructor(
    private repositories: RepositoryContainer,
    githubService: GitHubService,
    private permissions: PermissionService,
    userService: UserService,
    machinePoolService: MachinePoolService,
    personalEnvironmentService: PersonalEnvironmentService,
    claudeOAuthService: ClaudeOAuthService,
    usageLimitsService: UsageLimitsService,
    authService: AuthService
  ) {
    this.claudeService = new ClaudeAgentService(repositories, githubService, userService, machinePoolService, personalEnvironmentService, claudeOAuthService, authService);
    this.usageLimitsService = usageLimitsService;
    this.startAgentPollingSystem();
  }

  /**
   * Set the AgentMovementsService reference.
   * Must be called after ServiceContainer initialization due to circular dependency.
   */
  setAgentMovementsService(service: AgentMovementsService): void {
    this.agentMovementsService = service;
  }

  /**
   * Set the MachineSnapshotService reference.
   * Must be called after ServiceContainer initialization due to circular dependency.
   */
  setMachineSnapshotService(service: MachineSnapshotService): void {
    this.machineSnapshotService = service;
  }

  /**
   * Trigger a snapshot for an agent's machine (fire-and-forget).
   */
  async triggerSnapshotForAgent(agent: Agent): Promise<void> {
    if (!this.machineSnapshotService) return;
    if (!agent.machineId) return;
    if (agent.machineType === 'custom') return;

    await this.machineSnapshotService.triggerSnapshot(agent.machineId);
  }

  /**
   * Create a snapshot immediately (synchronous, blocks until complete).
   * Used for critical moments like before archival.
   * Uses priority mode to preempt any in-progress snapshot.
   */
  async createSnapshotNow(machineId: string): Promise<void> {
    if (!this.machineSnapshotService) {
      throw new Error('Snapshot service not available');
    }

    await this.machineSnapshotService.createSnapshotNow(machineId);
  }

  /**
   * Process the snapshot queue. Called periodically by cron.
   * 1. Clean up stale locks
   * 2. Process scheduled deletions
   * 3. Trigger snapshots for all active agents (queues if locked)
   * 4. Process queued items for unlocked machines
   */
  async processSnapshotQueue(): Promise<void> {
    if (!this.machineSnapshotService) return;

    // Step 1: Trigger snapshots for agents that have successfully started.
    // Only snapshot agents in READY/IDLE/RUNNING — never CLONING/PROVISIONING/ERROR
    // because the disk state may be incomplete (e.g. git clone in progress, temp pack files).
    const activeAgents = await this.repositories.agents.findMany({
      AND: [
        { state: { in: [AgentState.READY, AgentState.IDLE, AgentState.RUNNING] } },
        { machineId: { not: null } },
        { NOT: { machineType: 'custom' } }
      ]
    });

    for (const agent of activeAgents) {
      if (agent.machineId) {
        await this.machineSnapshotService.triggerSnapshot(agent.machineId);
      }
    }
    logger.info`[SNAPSHOT] Triggered snapshots for ${activeAgents.length} active agents`;

    // Step 2: Process the queue (handles stale locks, deletions, retries)
    await this.machineSnapshotService.processQueue();
  }

  /**
   * Checks if an agent is within the threshold of expiration and auto-extends if needed
   * @returns true if extension occurred, false otherwise
   */
  async autoExtendIfNearExpiration(agent: Agent): Promise<boolean> {
    try {
      if (!agent.provisionedAt || agent.state === AgentState.ARCHIVED || agent.state === AgentState.ARCHIVING) {
        return false;
      }

      // Custom machines don't need auto-extension - they run indefinitely
      if (agent.machineType === 'custom') {
        return false;
      }

      const now = new Date();
      const lifetimeUnitMinutes = parseInt(process.env.AGENT_LIFETIME_UNIT_MINUTES || '20');
      const autoExtendThresholdMinutes = parseInt(process.env.AGENT_AUTO_EXTEND_THRESHOLD_MINUTES || '10');
      const lifetimeUnits = agent.lifetimeUnits || 1;
      const lifetimeMs = lifetimeUnits * lifetimeUnitMinutes * 60 * 1000;
      const expiresAt = new Date(agent.provisionedAt.getTime() + lifetimeMs);

      // Calculate time left in minutes
      const timeLeftMs = expiresAt.getTime() - now.getTime();
      const timeLeftMinutes = timeLeftMs / (60 * 1000);

      // If within threshold minutes of expiration, extend lifetime by 1 unit
      if (timeLeftMinutes > 0 && timeLeftMinutes <= autoExtendThresholdMinutes) {
        const newLifetimeUnits = lifetimeUnits + 1;
        await this.repositories.agents.updateAgentFields(agent.id, {
          lifetimeUnits: newLifetimeUnits
        });

        logger.info`Agent ${agent.id} auto-extended from ${lifetimeUnits} to ${newLifetimeUnits} units (${timeLeftMinutes.toFixed(1)} minutes remaining, threshold: ${autoExtendThresholdMinutes})`;
        return true;
      }

      return false;
    } catch (error) {
      logger.error`Failed to auto-extend agent ${agent.id}: ${error}`;
      return false;
    }
  }

  /**
   * Archives an agent by updating state and releasing/deleting machine
   * User access permissions are preserved - actions trigger auto-resume
   */
  async archiveAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const agent = await this.repositories.agents.getAgentById(agentId);
      if (!agent) {
        return { success: false, error: 'Agent not found' };
      }

      if (agent.state === AgentState.ARCHIVED) {
        return { success: false, error: 'Agent is already archived' };
      }

      const isRecovery = agent.state === AgentState.ARCHIVING;

      if (!isRecovery) {
        // Atomically transition to ARCHIVING state to prevent concurrent archival attempts
        // This is critical because snapshot can take >60s and the archival check runs every 60s
        const validSourceStates = [
          AgentState.PROVISIONING,
          AgentState.PROVISIONED,
          AgentState.CLONING,
          AgentState.READY,
          AgentState.IDLE,
          AgentState.RUNNING,
          AgentState.ERROR
        ];
        const transitioned = await this.repositories.agents.tryTransitionState(
          agentId,
          validSourceStates,
          AgentState.ARCHIVING
        );

        if (!transitioned) {
          // Another process already started archiving or agent is already archived
          const currentAgent = await this.repositories.agents.getAgentById(agentId);
          const currentState = currentAgent?.state;
          logger.info`Agent ${agentId} - Archival skipped, state is ${currentState}`;
          return { success: false, error: `Agent is in state ${currentState}, cannot archive` };
        }
      }

      logger.info`Agent ${agentId} - ${isRecovery ? 'Recovering stuck archival' : 'Starting archival'} (state: ARCHIVING)`;

      // Take snapshot SYNCHRONOUSLY before archiving (while machine is still running)
      // Skip snapshot on recovery - it was already attempted and the machine may be gone
      if (!isRecovery && agent.machineId && agent.machineType !== 'custom' && this.machineSnapshotService) {
        try {
          logger.info`Agent ${agentId} - Creating final snapshot before archival`;
          await this.createSnapshotNow(agent.machineId);
          logger.info`Agent ${agentId} - Final snapshot completed`;
        } catch (error) {
          // Log but don't block archival - snapshot failure shouldn't prevent cleanup
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error`Agent ${agentId} - Failed to create final snapshot: ${errorMsg}`;
        }
      }

      // Kill zombie running automation events (machine is going away)
      try {
        await this.repositories.automationEvents.killRunningEventsForAgent(agentId);
      } catch (error) {
        logger.warn`Agent ${agentId} - Failed to kill running automation events: ${error}`;
      }

      // Each step has its own try-catch, so failures don't block other steps
      let stateUpdateSuccess = false;
      let machineReleaseSuccess = false;

      // Kill zombie running automation events (machine is going away)
      try {
        await this.repositories.automationEvents.killRunningEventsForAgent(agentId);
      } catch (error) {
        logger.warn`Agent ${agentId} - Failed to kill running automation events: ${error}`;
      }

      // Step 1: Update agent state to ARCHIVED (we're already in ARCHIVING)
      try {
        await this.repositories.agents.updateAgentFields(agentId, {
          state: 'archived',
          isRunning: false,
          isReady: false
        });
        stateUpdateSuccess = true;
        logger.info`Agent ${agentId} - State updated to ARCHIVED`;
      } catch (error) {
        logger.error`Agent ${agentId} - Failed to update agent state to archived: ${error}`;
      }

      // Step 2: Release custom machines that may still reference this agent
      try {
        const assignedCustomMachines = await this.repositories.prisma.customMachine.findMany({
          where: { currentAgentId: agentId }
        });
        for (const machine of assignedCustomMachines) {
          try {
            await this.repositories.prisma.customMachine.update({
              where: { id: machine.id },
              data: { currentAgentId: null, status: 'online' }
            });
            logger.info`Agent ${agentId} - Released custom machine ${machine.id}`;
          } catch (error) {
            logger.warn`Agent ${agentId} - Failed to release custom machine ${machine.id}: ${error}`;
          }
        }
      } catch (error) {
        logger.warn`Agent ${agentId} - Failed to query custom machines: ${error}`;
      }

      // Step 2.5: Unregister all port domains for this agent
      try {
        const portDomainCount = await this.repositories.agentPortDomains.countByAgent(agentId);
        if (portDomainCount > 0) {
          logger.info`Agent ${agentId} - Unregistering ${portDomainCount} port domains`;
          const portDomainService = new PortDomainService(this.repositories);
          await portDomainService.unregisterAllAgentDomains(agentId);
        }
      } catch (error) {
        logger.warn`Agent ${agentId} - Failed to clean up port domains: ${error}`;
      }

      // Step 3: Release or delete the machine referenced by agent.machineId
      if (agent.machineId) {
        try {
          if (agent.machineType === 'custom') {
            // Custom machine: just release it (don't delete)
            await this.repositories.prisma.customMachine.update({
              where: { id: agent.machineId },
              data: { currentAgentId: null, status: 'online' }
            });
            logger.info`Agent ${agentId} - Custom machine ${agent.machineId} released`;
          } else {
            // Hetzner machine: delete it
            await this.claudeService.deleteMachine(agent.machineId);
            logger.info`Agent ${agentId} - Hetzner machine ${agent.machineId} deleted`;
          }

          // Clear machine fields after successful operation
          // Preserve lastMachineId for snapshot lookup during resume
          await this.repositories.agents.updateAgentFields(agentId, {
            lastMachineId: agent.machineId,
            machineId: null,
            machineType: null
          });
          machineReleaseSuccess = true;
        } catch (error) {
          logger.error`Agent ${agentId} - Failed to release/delete machine ${agent.machineId}: ${error}`;

          // Rate limit errors are non-critical - clear machineId anyway
          const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
          if (errorMessage.includes('rate limit') || errorMessage.includes('rate_limit')) {
            logger.warn`Agent ${agentId} - Machine deletion hit rate limit, continuing with archival`;
            // Preserve lastMachineId for snapshot lookup during resume
            await this.repositories.agents.updateAgentFields(agentId, {
              lastMachineId: agent.machineId,
              machineId: null,
              machineType: null
            });
            machineReleaseSuccess = true;
          }
        }
      } else {
        machineReleaseSuccess = true; // No machine to release
      }

      // Log overall result
      if (machineReleaseSuccess && stateUpdateSuccess) {
        logger.info`Agent ${agentId} - Archival completed successfully`;
        return { success: true };
      } else {
        logger.warn`Agent ${agentId} - Archival completed with some failures: machine=${machineReleaseSuccess}, state=${stateUpdateSuccess}`;
        // Return success if state was updated (minimum requirement)
        return stateUpdateSuccess
          ? { success: true }
          : { success: false, error: 'Failed to update agent state to archived' };
      }
    } catch (error) {
      logger.error`Failed to archive agent ${agentId}: ${error}`;
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Force reboots an agent by archiving it and immediately resuming
   * This gives the agent a fresh machine while preserving all data
   */
  async forceRebootAgent(agentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info`Agent ${agentId} - Starting force reboot`;

      // Step 1: Archive the agent
      logger.info`Agent ${agentId} - Step 1: Archiving agent`;
      const archiveResult = await this.archiveAgent(agentId);
      if (!archiveResult.success) {
        logger.error`Agent ${agentId} - Archive failed: ${archiveResult.error}`;
        return { success: false, error: `Failed to archive agent: ${archiveResult.error}` };
      }
      logger.info`Agent ${agentId} - Archive completed successfully`;

      // Step 2: Resume the agent immediately (this will provision a new machine)
      logger.info`Agent ${agentId} - Step 2: Resuming agent with new machine`;
      await this.claudeService.resumeArchivedAgent(agentId);

      logger.info`Agent ${agentId} - Force reboot completed successfully - agent is now provisioning a new machine`;
      return { success: true };
    } catch (error) {
      logger.error`Failed to force reboot agent ${agentId}: ${error}`;
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // ---------- Per-agent per-chain independent polling ----------

  private startChain(agentId: string, chain: 'data' | 'state'): void {
    const key = `${agentId}:${chain}`;
    if (this.activeChains.has(key)) return; // already running

    const cs: ChainState = { timer: null, running: false };
    this.activeChains.set(key, cs);

    const MIN_INTERVAL_MS = 500;

    const tick = async () => {
      const chainState = this.activeChains.get(key);
      if (!chainState) return; // chain was stopped
      chainState.running = true;
      const start = Date.now();

      try {
        // Fetch fresh agent from DB each tick
        const agent = await this.repositories.agents.getAgentById(agentId);
        if (!agent || !agent.isRunning) {
          // Agent gone or stopped — self-terminate
          this.stopChain(key);
          return;
        }

        if (chain === 'data') {
          await this.runDataChain(agent);
        } else {
          await this.runStateChain(agent);
        }
      } catch (error) {
        logger.error`Chain ${key} error: ${error}`;
      } finally {
        const elapsed = Date.now() - start;
        const cs2 = this.activeChains.get(key);
        if (cs2) {
          cs2.running = false;
          const wait = Math.max(0, MIN_INTERVAL_MS - elapsed);
          cs2.timer = setTimeout(tick, wait);
        }
      }
    };

    // Stagger state chain 250ms behind data chain so first data poll completes first
    const initialDelay = chain === 'state' ? 250 : 0;
    cs.timer = setTimeout(tick, initialDelay);
  }

  private stopChain(key: string): void {
    const cs = this.activeChains.get(key);
    if (!cs) return;
    if (cs.timer) clearTimeout(cs.timer);
    this.activeChains.delete(key);

    // Clean up shared state when both chains for an agent are gone
    const agentId = key.split(':')[0];
    const otherChain = key.endsWith(':data') ? `${agentId}:state` : `${agentId}:data`;
    if (!this.activeChains.has(otherChain)) {
      this.sharedMsgCount.delete(agentId);
    }
  }

  private async runDataChain(agent: Agent): Promise<void> {
    const start = Date.now();
    const pollTiming = await this.claudeService.pollAgent(agent);
    const elapsed = Date.now() - start;

    // Store msgCount for state chain to read
    if (pollTiming) {
      this.sharedMsgCount.set(agent.id, pollTiming.msgCount);
    }

    // Record timing for benchmark log
    const detail = pollTiming
      ? `conv:${pollTiming.conv} git:${pollTiming.git < 0 ? 'skip' : pollTiming.git} pr:${pollTiming.pr} auto:${pollTiming.auto} ctx:${pollTiming.ctx} store:${pollTiming.store}(${pollTiming.msgProcessed}/${pollTiming.msgCount}msg)`
      : 'skipped';
    this.recordTiming({ agentId: agent.id, agentName: agent.name, chain: 'data', state: agent.state as string, durationMs: elapsed, detail });
  }

  private async runStateChain(agent: Agent): Promise<void> {
    const start = Date.now();
    const msgCount = this.sharedMsgCount.get(agent.id) ?? 0;
    const result = await this.claudeService.handleStateLogic(agent, msgCount);
    const elapsed = Date.now() - start;

    const detail = result
      ? `claudeState:${result.claudeState}ms logic:${result.stateLogic}ms`
      : 'skipped';
    this.recordTiming({ agentId: agent.id, agentName: agent.name, chain: 'state', state: agent.state as string, durationMs: elapsed, detail });
  }

  private recordTiming(t: ChainTiming): void {
    this.recentTimings.push(t);
    // Cap at 200 entries to bound memory
    if (this.recentTimings.length > 200) {
      this.recentTimings.splice(0, this.recentTimings.length - 200);
    }
  }

  private emitBenchmarkLog(): void {
    if (this.recentTimings.length === 0) return;

    // Group by agent
    const byAgent = new Map<string, ChainTiming[]>();
    for (const t of this.recentTimings) {
      const list = byAgent.get(t.agentId) || [];
      list.push(t);
      byAgent.set(t.agentId, list);
    }

    const lines: string[] = [];
    lines.push(`[BENCH] ${this.activeChains.size} active chains, ${byAgent.size} agents, ${this.recentTimings.length} samples`);

    for (const [agentId, timings] of byAgent) {
      const shortId = agentId.substring(0, 8);
      const name = timings[0]?.agentName ?? '?';
      const state = timings[timings.length - 1]?.state ?? '?';
      const dataTimings = timings.filter(t => t.chain === 'data');
      const stateTimings = timings.filter(t => t.chain === 'state');
      const dataAvg = dataTimings.length > 0 ? Math.round(dataTimings.reduce((s, t) => s + t.durationMs, 0) / dataTimings.length) : 0;
      const stateAvg = stateTimings.length > 0 ? Math.round(stateTimings.reduce((s, t) => s + t.durationMs, 0) / stateTimings.length) : 0;
      const dataMax = dataTimings.length > 0 ? Math.max(...dataTimings.map(t => t.durationMs)) : 0;
      const stateMax = stateTimings.length > 0 ? Math.max(...stateTimings.map(t => t.durationMs)) : 0;
      lines.push(`  ${shortId} (${name}) ${state}: data avg:${dataAvg}ms max:${dataMax}ms (${dataTimings.length}x) | state avg:${stateAvg}ms max:${stateMax}ms (${stateTimings.length}x)`);
    }

    logger.info`${lines.join('\n')}`;

    // Clear after emitting
    this.recentTimings.length = 0;
  }

  // ---------- Orchestrator ----------

  private startAgentPollingSystem(): void {
    const workerId = process.env.WORKER_ID || '0';

    // Only run polling on worker 0 to prevent duplicate operations
    if (workerId !== '0') {
      logger.info `Worker ${workerId}: Skipping agent polling system (only worker 0 runs it)`;
      return;
    }

    logger.info `Worker ${workerId}: Starting agent polling system (per-agent per-chain)`;

    let orchestratorCount = 0;

    const orchestrate = async () => {
      try {
        const agents = await this.repositories.agents.getAllAgents();
        const runningAgents = agents.filter((agent: Agent) => agent.isRunning);
        const runningIds = new Set(runningAgents.map(a => a.id));

        // Start chains for new running agents
        for (const agent of runningAgents) {
          this.startChain(agent.id, 'data');
          this.startChain(agent.id, 'state');
        }

        // Stop chains for agents that are no longer running
        for (const key of this.activeChains.keys()) {
          const agentId = key.split(':')[0];
          if (!runningIds.has(agentId)) {
            this.stopChain(key);
          }
        }

        // Periodic cleanup of claude-service maps
        if (orchestratorCount % 50 === 0) {
          this.claudeService.sweepStaleAgentEntries(runningIds);
        }

        // Sync PR state for non-running agents with open PRs (fire-and-forget)
        // Skip agents that haven't been updated in STALE_PR_CUTOFF_DAYS (effectively abandoned)
        const cutoffDate = new Date(Date.now() - this.STALE_PR_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
        const staleOpenPRAgents = agents.filter((a: Agent) =>
          a.prState === 'open' &&
          !runningIds.has(a.id) &&
          a.updatedAt && a.updatedAt > cutoffDate
        );
        if (staleOpenPRAgents.length > 0) {
          Promise.allSettled(
            staleOpenPRAgents.map(a => this.claudeService.syncPRStateFromGitHub(a).catch(() => {}))
          );
        }

        // Emit benchmark log every 10 orchestrator ticks
        orchestratorCount++;
        if (orchestratorCount % 10 === 0) {
          this.emitBenchmarkLog();
        }
      } catch (error) {
        logger.error`Orchestrator error: ${error}`;
      }

      setTimeout(orchestrate, 1000);
    };

    orchestrate();

    // Autonomous mode expiration check (every 30 seconds)
    // This only handles expiration - actual prompting happens on state transition to IDLE
    setInterval(async () => {
      try {
        const agents = await this.repositories.agents.getAllAgents();
        const now = new Date();

        for (const agent of agents) {
          // Check slop mode expiration
          if (agent.inSlopModeUntil && agent.inSlopModeUntil.getTime() <= now.getTime()) {
            await this.repositories.agents.updateAgentFields(agent.id, {
              inSlopModeUntil: null,
              slopModeLastPromptAt: null,
              slopModeCustomPrompt: null
            });
            logger.info`Agent ${agent.id} slop mode expired`;
          }

          // Check ralph mode lock file deletion
          if (agent.inRalphMode && agent.machineId) {
            try {
              const response = await this.sendToAgentServer(
                agent.machineId,
                '/ralph-mode-check-lock',
                {}
              );
              const data = await response.json();
              if (!data.exists) {
                await this.repositories.agents.updateAgentFields(agent.id, {
                  inRalphMode: false,
                  ralphModeTaskDescription: null,
                  ralphModeLastPromptAt: null
                });
                logger.info`Agent ${agent.id} ralph mode stopped (lock file deleted)`;
              }
            } catch (error) {
              // If we can't check, don't stop - assume lock file exists
              logger.warn`Failed to check ralph mode lock file for agent ${agent.id}: ${error}`;
            }
          }
        }
      } catch (error) {
        logger.error`Autonomous mode expiration check error: ${error}`;
      }
    }, 30000); // Check every 30 seconds

    // Fast check: auto-resume ARCHIVED agents with queued prompts (every 500ms)
    // Single query: WHERE state='archived' AND has prompt with status IN ('queued','running')
    const resumingAgents = new Set<string>();
    setInterval(async () => {
      try {
        if (!this.agentMovementsService) return;
        const agents = await this.repositories.agents.getArchivedAgentsWithQueuedPrompts();
        for (const agent of agents) {
          if (resumingAgents.has(agent.id)) continue;
          logger.info`ARCHIVED agent ${agent.id} has queued prompts - auto-resuming`;
          resumingAgents.add(agent.id);
          this.agentMovementsService.ensureAgentReadyOrResume(agent.id, agent.userId)
            .then(() => logger.info`ARCHIVED agent ${agent.id} auto-resumed successfully`)
            .catch(async (error) => {
              const errMsg = (error as any)?.message || String(error);
              logger.error`Failed to auto-resume ARCHIVED agent ${agent.id}: ${errMsg}`;
              try {
                const failedCount = await this.repositories.agentPrompts.failActivePromptsForAgent(agent.id);
                if (failedCount > 0) {
                  logger.warn`Agent ${agent.id} - Failed ${failedCount} queued prompt(s) after auto-resume failure`;
                }
              } catch (promptError) {
                logger.error`Agent ${agent.id} - Failed to mark prompts as failed: ${promptError}`;
              }
            })
            .finally(() => resumingAgents.delete(agent.id));
        }
      } catch (error) {
        logger.error`Archived-agent resume check error: ${error}`;
      }
    }, 500);

    // Lifetime / expiration / usage check (every 60 seconds)
    const interval = setInterval(async () => {
      try {
        const agents = await this.repositories.agents.getAllAgents();
        const now = new Date();
        const lifetimeUnitMinutes = parseInt(process.env.AGENT_LIFETIME_UNIT_MINUTES || '20');
        const autoExtendThresholdMinutes = parseInt(process.env.AGENT_AUTO_EXTEND_THRESHOLD_MINUTES || '10');

        for (const agent of agents) {
          // Clean up continuous-running tracker for agents no longer in RUNNING state
          // (must be before any `continue` to avoid leaking map entries)
          if (agent.state !== AgentState.RUNNING) {
            this.runningStateSince.delete(agent.id);
          }

          if (agent.state === 'archived') {
            continue; // Handled by the fast 500ms loop above
          }

          // Skip agents without provisionedAt time
          if (!agent.provisionedAt) {
            continue;
          }

          // Custom machines run indefinitely but track usage every N minutes
          if (agent.machineType === 'custom') {
            // Calculate how many lifetime units should have been charged based on elapsed time
            const elapsedMs = now.getTime() - agent.provisionedAt.getTime();
            const elapsedUnits = Math.floor(elapsedMs / (lifetimeUnitMinutes * 60 * 1000));
            const currentUnits = agent.lifetimeUnits || 1;

            // If more units have elapsed than we've charged, increment usage
            if (elapsedUnits > currentUnits) {
              const unitsToCharge = elapsedUnits - currentUnits;

              // Charge for each elapsed unit
              for (let i = 0; i < unitsToCharge; i++) {
                await this.usageLimitsService.incrementMonthlyAgentUsage(agent.userId);
              }

              // Update lifetimeUnits to track what we've charged
              await this.repositories.agents.updateAgentFields(agent.id, {
                lifetimeUnits: elapsedUnits
              });

              logger.info`Custom machine agent ${agent.id} - charged ${unitsToCharge} usage units (total: ${elapsedUnits})`;
            }
            continue;
          }

          // Calculate expiration time: provisionedAt + (lifetimeUnits * lifetimeUnitMinutes)
          const lifetimeUnits = agent.lifetimeUnits || 1;
          const lifetimeMs = lifetimeUnits * lifetimeUnitMinutes * 60 * 1000;
          const expiresAt = new Date(agent.provisionedAt.getTime() + lifetimeMs);

          // Check if lifetime has expired
          const timeLeftSecs = (expiresAt.getTime() - now.getTime()) / 1000;
          const timeLeftMinutes = timeLeftSecs / 60;

          // Auto-extend if agent is working (RUNNING state) and within threshold of expiration
          // Note: Filesync and port forwarding keep-alive is now handled by the frontend
          // sending periodic keep-alive requests to /api/agents/keep-alive
          // Cap continuous RUNNING duration to 24h to prevent zombie agents stuck on hanging commands.
          // The timer resets if the agent transitions to IDLE (i.e., only continuous RUNNING counts).
          const MAX_CONTINUOUS_RUNNING_MS = 24 * 60 * 60 * 1000;
          let continuousRunningExceeded = false;
          if (agent.state === AgentState.RUNNING) {
            if (!this.runningStateSince.has(agent.id)) {
              this.runningStateSince.set(agent.id, now.getTime());
            }
            continuousRunningExceeded = (now.getTime() - this.runningStateSince.get(agent.id)!) > MAX_CONTINUOUS_RUNNING_MS;
          }
          const shouldAutoExtend = timeLeftMinutes > 0 && timeLeftMinutes <= autoExtendThresholdMinutes && (
            agent.state === AgentState.RUNNING
          ) && !continuousRunningExceeded;

          if (shouldAutoExtend) {
            await this.autoExtendIfNearExpiration(agent);
            continue; // Skip to next agent after extension
          }

          if (expiresAt.getTime() <= now.getTime() && agent.state !== AgentState.ARCHIVED && agent.state !== AgentState.ARCHIVING) {
            logger.info`Agent ${agent.id} has reached end of lifetime - archiving`;
            await this.archiveAgent(agent.id);
          }

          // Recover agents stuck in ARCHIVING for more than 5 minutes
          // This handles the case where the backend restarted mid-archival
          if (agent.state === AgentState.ARCHIVING && agent.updatedAt) {
            const stuckDurationMs = now.getTime() - agent.updatedAt.getTime();
            const STUCK_ARCHIVING_THRESHOLD_MS = 5 * 60 * 1000;
            if (stuckDurationMs > STUCK_ARCHIVING_THRESHOLD_MS) {
              logger.info`Agent ${agent.id} stuck in ARCHIVING for ${Math.round(stuckDurationMs / 60000)} minutes - recovering`;
              await this.archiveAgent(agent.id);
            }
          }
        }
      } catch (error) {
        logger.error`Archival check error: ${error}`;
      }
    }, 60000);
  }

  async createAgent(params: {
    projectId: string;
    userId: string;
    baseBranch?: string | null;
    name?: string;
    environmentId?: string | null;
    machineType?: 'hetzner' | 'custom';
    customMachineId?: string | null;
  }): Promise<string> {
    const { projectId, userId, baseBranch, name, environmentId, machineType, customMachineId } = params;

    const user = await this.repositories.users.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const project = await this.repositories.projects.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    return await this.claudeService.createAgent(
      user,
      projectId,
      baseBranch || null,
      name,
      environmentId || null,
      machineType,
      customMachineId
    );
  }

  async getProjectAgents(projectId: string, userId: string, includeTrashed: boolean = false): Promise<Agent[]> {
    const allProjectAgents = await this.repositories.agents.getProjectAgents(projectId, includeTrashed);

    // Get user's agent accesses
    const userAccesses = await this.repositories.userAgentAccesses.getUserAccesses(userId);
    const accessibleAgentIds = new Set(userAccesses.map(a => a.agentId));

    // Return agents where user is owner OR has access
    return allProjectAgents.filter(agent =>
      agent.userId === userId || accessibleAgentIds.has(agent.id)
    );
  }

  async getAgent(agentId: string): Promise<Agent | null> {
    return await this.repositories.agents.getAgentById(agentId);
  }

  async getAgentWithProject(agentId: string): Promise<(Agent & { project: { id: string; name: string } }) | null> {
    return await this.repositories.agents.getAgentByIdWithProject(agentId);
  }

  async getUserAgents(userId: string, includeTrashed: boolean = false): Promise<Agent[]> {
    const allAgents = await this.repositories.agents.getAllAgents();

    // Get user's agent accesses
    const userAccesses = await this.repositories.userAgentAccesses.getUserAccesses(userId);
    const accessibleAgentIds = new Set(userAccesses.map(a => a.agentId));

    // Return agents where user is owner OR has access, optionally including trashed
    return allAgents.filter(agent => {
      const hasAccess = agent.userId === userId || accessibleAgentIds.has(agent.id);
      if (!hasAccess) return false;
      if (includeTrashed) return true;
      return !agent.isTrashed;
    });
  }

  async getUserAgentsWithProjects(userId: string, includeTrashed: boolean = false): Promise<Array<Agent & { project: { id: string; name: string } }>> {
    // Get all agents with projects
    const allAgents = await this.repositories.agents.getAllAgentsWithProjects(true); // Always get all, filter below

    // Get user's agent accesses
    const userAccesses = await this.repositories.userAgentAccesses.getUserAccesses(userId);
    const accessibleAgentIds = new Set(userAccesses.map(a => a.agentId));

    // Return agents where user is owner OR has access, optionally including trashed
    return allAgents.filter(agent => {
      const hasAccess = agent.userId === userId || accessibleAgentIds.has(agent.id);
      if (!hasAccess) return false;
      if (includeTrashed) return true;
      return !agent.isTrashed;
    });
  }

  async userOwnsAgent(agentId: string, userId: string): Promise<boolean> {
    return this.repositories.agents.userOwnsAgent(agentId, userId);
  }


  async queuePrompt(agentId: string, prompt: Prompt, userId: string): Promise<void> {
    // Access check is done at API handler level via hasWriteAccess
    // No need for redundant ownership check here - allows shared users with write access

    let additionalData = '';
    if (prompt.additionalPlainTextData !== null) {
      additionalData = this.wrapPromptAdditionalInformation(
          prompt.additionalPlainTextData
      );
    }

    const promptToSend: string = `${prompt.message}${additionalData ? additionalData : ''}`;

    // Queue the prompt in database with model - polling system will pick it up
    await this.repositories.agentPrompts.queuePrompt(agentId, promptToSend, prompt.model || undefined);

    logger.info(`Queued prompt for agent ${agentId} with model ${prompt.model || 'default'}: ${promptToSend.substring(0, 50)}...`);
    // Note: Task summary generation moved to claude-agent.service.ts when prompt is actually sent
    // This ensures machineId exists and we use the actual first prompt being sent
  }

  async getAgentPrompts(agentId: string): Promise<AgentPrompt[]> {
    return this.repositories.agentPrompts.getAllPrompts(agentId);
  }

  async getQueuedAgentPrompts(agentId: string): Promise<AgentPrompt[]> {
    return this.repositories.agentPrompts.getQueuedOrRunningPrompts(agentId);
  }

  async getPromptById(promptId: string): Promise<AgentPrompt | null> {
    return this.repositories.agentPrompts.getPromptById(promptId);
  }

  async deletePrompt(promptId: string): Promise<void> {
    return this.repositories.agentPrompts.deletePrompt(promptId);
  }

  async prioritizePrompt(promptId: string): Promise<void> {
    return this.repositories.agentPrompts.prioritizePrompt(promptId);
  }

  async cancelOtherQueuedPrompts(agentId: string, exceptPromptId: string): Promise<number> {
    return this.repositories.agentPrompts.cancelOtherQueuedPrompts(agentId, exceptPromptId);
  }

  async getRunningPrompts(agentId: string): Promise<AgentPrompt[]> {
    return this.repositories.agentPrompts.getRunningPrompts(agentId);
  }

  async getAgentMessages(
    agentId: string,
  ): Promise<AgentMessage[]> {
    return this.repositories.agentMessages.getAgentMessages(agentId);
  }

  async getAgentChatEvents(agentId: string): Promise<ChatEvent[]> {
    const events: ChatEvent[] = [];
    const addedPromptTaskIds = new Set<string>();

    // Run all independent queries in parallel
    const [messages, queuedPrompts, agentPrompts, commits, resets, automationEvents, contextEvents] = await Promise.all([
      this.repositories.agentMessages.getAgentMessages(agentId),
      this.getQueuedAgentPrompts(agentId),
      this.getAgentPrompts(agentId),
      this.repositories.agentCommits.getAgentCommits(agentId),
      this.repositories.agentResets.getAgentResets(agentId),
      this.repositories.automationEvents.getEventsForAgent(agentId),
      this.repositories.agentContextEvents.getAgentContextEvents(agentId)
    ]);

    // Merge messages with queued prompts
    const allMessages = messages.concat(queuedPrompts.map(qp => ({
      id: `qp-${qp.id}`,
      agentId: agentId,
      role: 'user' as const,
      content: qp.prompt,
      model: null,
      timestamp: qp.createdAt || new Date(),
      tools: null,
      taskId: qp.id,
      isReverted: false,
      revertedAt: null,
      revertedByCheckpoint: null,
      isStreaming: false,
      sourceUuid: null
    })));

    for (const msg of allMessages) {
      // Skip system hidden messages
      if (msg.content && msg.content.includes('<system-hidden-for-user>') && msg.content.includes('</system-hidden-for-user>')) {
        continue;
      }

      if (msg.role === 'user') {
        // User message - match with prompt in database (agentPrompts fetched once above)
        const displayContent = this.removePromptAdditionalInformation(msg.content);

        let matchingPrompt = null;

        // match prompts by task_id first
        if (msg.taskId) {
          matchingPrompt = agentPrompts.find(p => p.id === msg.taskId);
        }

        // match by content if not found by task_id
        if (!matchingPrompt) {
          matchingPrompt = agentPrompts.find(p => p.prompt === msg.content);
        }

        if (!matchingPrompt) {
          continue;
        }

        // Skip if we've already added this prompt (deduplication)
        if (addedPromptTaskIds.has(matchingPrompt.id)) {
          continue;
        }

        const status = matchingPrompt.status as 'sending' | 'queued' | 'running' | 'finished' | 'failed';

        const promptEvent: PromptEvent = {
          id: msg.id,
          type: 'prompt',
          timestamp: msg.timestamp.getTime(),
          taskId: matchingPrompt.id,
          data: {
            prompt: displayContent,
            status,
            is_reverted: msg.isReverted || false
          }
        };
        events.push(promptEvent);
        addedPromptTaskIds.add(matchingPrompt.id);
      } else {
        // Assistant message - use persisted tool data from DB
        let tools: Array<{ use: ToolUse; result?: ToolResult }> = [];

        if (msg.tools) {
          try {
            const parsed = typeof msg.tools === 'string' ? JSON.parse(msg.tools as string) : msg.tools;
            if (Array.isArray(parsed)) {
              tools = parsed.filter(tool =>
                tool.use && tool.use.name !== 'TodoWrite' && tool.use.name !== 'TodoRead'
              );
            }
          } catch (e) {
            console.error('Failed to parse tools:', msg.tools);
          }
        }

        // Only create event if there's content or tools to show
        if (msg.content || tools.length > 0) {
          const responseEvent: ResponseEvent = {
            id: msg.id,
            type: 'response',
            timestamp: msg.timestamp.getTime(),
            taskId: msg.taskId,
            data: {
              content: msg.content || '',
              model: msg.model,
              tools: tools.length > 0 ? tools : undefined,
              is_reverted: msg.isReverted || false,
              ...(msg.isStreaming ? { is_streaming: true } : {})
            }
          };
          events.push(responseEvent);
        }
      }
    }

    // Add git checkpoint events
    for (const commit of commits) {
      if (!commit.createdAt) continue;
      if (commit.isDeleted) continue;

      const gitCheckpointEvent: GitCheckpointEvent = {
        id: commit.id,
        type: 'git_checkpoint',
        timestamp: commit.createdAt.getTime(),
        taskId: commit.taskId,
        data: {
          commitSha: commit.commitSha,
          commitMessage: commit.commitMessage,
          commitUrl: commit.commitUrl,
          branch: commit.branchName,
          filesChanged: commit.filesChanged ?? 0,
          additions: commit.additions ?? 0,
          deletions: commit.deletions ?? 0,
          timestamp: commit.createdAt.getTime(),
          pushed: commit.pushed || false,
          is_reverted: commit.isReverted || false
        }
      };
      events.push(gitCheckpointEvent);
    }

    // Add reset events
    for (const reset of resets) {
      if (!reset.createdAt) continue;

      const resetEvent: ResetEvent = {
        id: reset.id,
        type: 'reset',
        timestamp: reset.createdAt.getTime(),
        taskId: reset.taskId,
        data: {}
      };
      events.push(resetEvent);
    }

    // Add automation events
    for (const autoEvent of automationEvents) {
      if (!autoEvent.createdAt) continue;

      // Get automation details to include name and blocking/feedOutput settings
      const automation = await this.repositories.automations.findById(autoEvent.automationId);
      if (!automation) continue;

      const automationChatEvent: AutomationEvent = {
        id: autoEvent.id,
        type: 'automation',
        timestamp: autoEvent.createdAt.getTime(),
        taskId: autoEvent.taskId,
        data: {
          automationId: autoEvent.automationId,
          automationName: automation.parsedData.name,
          trigger: autoEvent.trigger,
          output: autoEvent.output,
          isStartTruncated: autoEvent.isStartTruncated,
          status: autoEvent.status as 'running' | 'finished' | 'failed' | 'killed',
          exitCode: autoEvent.exitCode,
          startedAt: autoEvent.startedAt?.getTime() || null,
          finishedAt: autoEvent.finishedAt?.getTime() || null,
          blocking: automation.parsedData.blocking,
          feedOutput: automation.parsedData.feedOutput
        }
      };
      events.push(automationChatEvent);

      // Add synthetic "output added to context" event for completed automations with feedOutput enabled
      if (
        (autoEvent.status === 'finished' || autoEvent.status === 'failed') &&
        automation.parsedData.feedOutput &&
        autoEvent.finishedAt
      ) {
        const outputAddedEvent: ChatEvent = {
          id: `${autoEvent.id}-output-added`,
          type: 'automation_output_added',
          timestamp: autoEvent.finishedAt.getTime(),
          taskId: autoEvent.taskId,
          data: {
            automationId: autoEvent.automationId,
            automationName: automation.parsedData.name
          }
        };
        events.push(outputAddedEvent);
      }
    }

    // Add context events (warnings, compaction start/complete)
    for (const ctxEvent of contextEvents) {
      if (!ctxEvent.createdAt) continue;

      if (ctxEvent.type === 'context_warning') {
        const warningEvent: ContextWarningEvent = {
          id: ctxEvent.id,
          type: 'context_warning',
          timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: {
            contextUsedPercent: ctxEvent.contextUsedPercent!,
            contextRemainingPercent: ctxEvent.contextRemainingPercent!,
            inputTokens: ctxEvent.inputTokens!,
            cacheTokens: ctxEvent.cacheTokens!,
            contextWindow: ctxEvent.contextWindow!
          }
        };
        events.push(warningEvent);
      } else if (ctxEvent.type === 'compaction_start') {
        const startEvent: CompactionStartEvent = {
          id: ctxEvent.id,
          type: 'compaction_start',
          timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: {
            triggerReason: ctxEvent.triggerReason as 'threshold_exceeded' | 'manual',
            contextUsedPercent: ctxEvent.contextUsedPercent!
          }
        };
        events.push(startEvent);
      } else if (ctxEvent.type === 'compaction_complete') {
        const completeEvent: CompactionCompleteEvent = {
          id: ctxEvent.id,
          type: 'compaction_complete',
          timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: {
            summary: ctxEvent.summary!,
            tokensBefore: ctxEvent.tokensBefore!,
            tokensAfter: ctxEvent.tokensAfter ?? null,
            tokensSaved: ctxEvent.tokensSaved ?? null
          }
        };
        events.push(completeEvent);
      }
    }

    // Sort all events by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    return events;
  }

  async getEventsVersion(agentId: string): Promise<number | null> {
    return this.repositories.agents.getEventsVersion(agentId);
  }

  async getAgentChatEventsPaginated(
    agentId: string,
    options: { limit: number; before?: number }
  ): Promise<{ events: ChatEvent[]; hasMore: boolean; oldestTimestamp: number | null }> {
    const { limit, before } = options;
    const beforeDate = before ? new Date(before) : undefined;
    const paginationOpts = { limit, beforeTimestamp: beforeDate };

    // Over-fetch: each table gets the full limit. Prompts always fetched in full (small, needed for matching).
    const [messages, queuedPrompts, agentPrompts, commits, resets, automationEvents, contextEvents] = await Promise.all([
      this.repositories.agentMessages.getAgentMessagesPaginated(agentId, paginationOpts),
      this.getQueuedAgentPrompts(agentId),
      this.getAgentPrompts(agentId),
      this.repositories.agentCommits.getAgentCommitsPaginated(agentId, paginationOpts),
      this.repositories.agentResets.getAgentResetsPaginated(agentId, paginationOpts),
      this.repositories.automationEvents.getEventsForAgentPaginated(agentId, paginationOpts),
      this.repositories.agentContextEvents.getAgentContextEventsPaginated(agentId, paginationOpts)
    ]);

    // hasMore if any data table returned exactly limit rows
    const hasMore = messages.length === limit
      || commits.length === limit
      || resets.length === limit
      || automationEvents.length === limit
      || contextEvents.length === limit;

    // Build events using same logic as getAgentChatEvents
    const events: ChatEvent[] = [];
    const addedPromptTaskIds = new Set<string>();

    // Merge messages with queued prompts (only if not paginating into history)
    const allMessages = beforeDate
      ? messages
      : messages.concat(queuedPrompts.map(qp => ({
          id: `qp-${qp.id}`,
          agentId: agentId,
          role: 'user' as const,
          content: qp.prompt,
          model: null,
          timestamp: qp.createdAt || new Date(),
          tools: null,
          taskId: qp.id,
          isReverted: false,
          revertedAt: null,
          revertedByCheckpoint: null,
          isStreaming: false,
          sourceUuid: null
        })));

    for (const msg of allMessages) {
      if (msg.content && msg.content.includes('<system-hidden-for-user>') && msg.content.includes('</system-hidden-for-user>')) {
        continue;
      }

      if (msg.role === 'user') {
        const displayContent = this.removePromptAdditionalInformation(msg.content);
        let matchingPrompt = null;
        if (msg.taskId) {
          matchingPrompt = agentPrompts.find(p => p.id === msg.taskId);
        }
        if (!matchingPrompt) {
          matchingPrompt = agentPrompts.find(p => p.prompt === msg.content);
        }
        if (!matchingPrompt) continue;
        if (addedPromptTaskIds.has(matchingPrompt.id)) continue;

        const status = matchingPrompt.status as 'sending' | 'queued' | 'running' | 'finished' | 'failed';
        const promptEvent: PromptEvent = {
          id: msg.id,
          type: 'prompt',
          timestamp: msg.timestamp.getTime(),
          taskId: matchingPrompt.id,
          data: { prompt: displayContent, status, is_reverted: msg.isReverted || false }
        };
        events.push(promptEvent);
        addedPromptTaskIds.add(matchingPrompt.id);
      } else {
        let tools: Array<{ use: ToolUse; result?: ToolResult }> = [];
        if (msg.tools) {
          try {
            const parsed = typeof msg.tools === 'string' ? JSON.parse(msg.tools as string) : msg.tools;
            if (Array.isArray(parsed)) {
              tools = parsed.filter(tool => tool.use && tool.use.name !== 'TodoWrite' && tool.use.name !== 'TodoRead');
            }
          } catch (e) { /* ignore parse errors */ }
        }
        if (msg.content || tools.length > 0) {
          const responseEvent: ResponseEvent = {
            id: msg.id,
            type: 'response',
            timestamp: msg.timestamp.getTime(),
            taskId: msg.taskId,
            data: {
              content: msg.content || '',
              model: msg.model,
              tools: tools.length > 0 ? tools : undefined,
              is_reverted: msg.isReverted || false,
              ...(msg.isStreaming ? { is_streaming: true } : {})
            }
          };
          events.push(responseEvent);
        }
      }
    }

    // Git checkpoints
    for (const commit of commits) {
      if (!commit.createdAt || commit.isDeleted) continue;
      const gitCheckpointEvent: GitCheckpointEvent = {
        id: commit.id,
        type: 'git_checkpoint',
        timestamp: commit.createdAt.getTime(),
        taskId: commit.taskId,
        data: {
          commitSha: commit.commitSha,
          commitMessage: commit.commitMessage,
          commitUrl: commit.commitUrl,
          branch: commit.branchName,
          filesChanged: commit.filesChanged ?? 0,
          additions: commit.additions ?? 0,
          deletions: commit.deletions ?? 0,
          timestamp: commit.createdAt.getTime(),
          pushed: commit.pushed || false,
          is_reverted: commit.isReverted || false
        }
      };
      events.push(gitCheckpointEvent);
    }

    // Resets
    for (const reset of resets) {
      if (!reset.createdAt) continue;
      events.push({
        id: reset.id, type: 'reset', timestamp: reset.createdAt.getTime(),
        taskId: reset.taskId, data: {}
      } as ResetEvent);
    }

    // Automation events - batch-prefetch automation details (fixes N+1)
    const automationIds = [...new Set(automationEvents.map(e => e.automationId))];
    const automationsArr = await Promise.all(automationIds.map(id => this.repositories.automations.findById(id)));
    const automationMap = new Map(automationsArr.filter(Boolean).map(a => [a!.id, a!]));

    for (const autoEvent of automationEvents) {
      if (!autoEvent.createdAt) continue;
      const automation = automationMap.get(autoEvent.automationId);
      if (!automation) continue;

      events.push({
        id: autoEvent.id,
        type: 'automation',
        timestamp: autoEvent.createdAt.getTime(),
        taskId: autoEvent.taskId,
        data: {
          automationId: autoEvent.automationId,
          automationName: automation.parsedData.name,
          trigger: autoEvent.trigger,
          output: autoEvent.output,
          isStartTruncated: autoEvent.isStartTruncated,
          status: autoEvent.status as 'running' | 'finished' | 'failed' | 'killed',
          exitCode: autoEvent.exitCode,
          startedAt: autoEvent.startedAt?.getTime() || null,
          finishedAt: autoEvent.finishedAt?.getTime() || null,
          blocking: automation.parsedData.blocking,
          feedOutput: automation.parsedData.feedOutput
        }
      } as AutomationEvent);

      if (
        (autoEvent.status === 'finished' || autoEvent.status === 'failed') &&
        automation.parsedData.feedOutput && autoEvent.finishedAt
      ) {
        events.push({
          id: `${autoEvent.id}-output-added`,
          type: 'automation_output_added',
          timestamp: autoEvent.finishedAt.getTime(),
          taskId: autoEvent.taskId,
          data: { automationId: autoEvent.automationId, automationName: automation.parsedData.name }
        } as ChatEvent);
      }
    }

    // Context events
    for (const ctxEvent of contextEvents) {
      if (!ctxEvent.createdAt) continue;
      if (ctxEvent.type === 'context_warning') {
        events.push({
          id: ctxEvent.id, type: 'context_warning', timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: {
            contextUsedPercent: ctxEvent.contextUsedPercent!, contextRemainingPercent: ctxEvent.contextRemainingPercent!,
            inputTokens: ctxEvent.inputTokens!, cacheTokens: ctxEvent.cacheTokens!, contextWindow: ctxEvent.contextWindow!
          }
        } as ContextWarningEvent);
      } else if (ctxEvent.type === 'compaction_start') {
        events.push({
          id: ctxEvent.id, type: 'compaction_start', timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: { triggerReason: ctxEvent.triggerReason as 'threshold_exceeded' | 'manual', contextUsedPercent: ctxEvent.contextUsedPercent! }
        } as CompactionStartEvent);
      } else if (ctxEvent.type === 'compaction_complete') {
        events.push({
          id: ctxEvent.id, type: 'compaction_complete', timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: { summary: ctxEvent.summary!, tokensBefore: ctxEvent.tokensBefore!, tokensAfter: ctxEvent.tokensAfter ?? null, tokensSaved: ctxEvent.tokensSaved ?? null }
        } as CompactionCompleteEvent);
      }
    }

    // Sort descending by timestamp, take limit, then reverse to ascending for frontend
    events.sort((a, b) => b.timestamp - a.timestamp);
    const page = events.slice(0, limit);
    page.reverse(); // ascending for frontend consumption

    const oldestTimestamp = page.length > 0 ? page[0].timestamp : null;

    return { events: page, hasMore, oldestTimestamp };
  }

  /**
   * Build ChatEvents for specific message IDs (for WS delta updates).
   * Fetches messages by ID, matches with agentPrompts, transforms to ChatEvent.
   */
  async getChatEventsForMessageIds(agentId: string, messageIds: string[]): Promise<ChatEvent[]> {
    if (messageIds.length === 0) return [];

    const [messages, agentPrompts] = await Promise.all([
      this.repositories.agentMessages.findMany(
        { id: { in: messageIds }, agentId },
        { orderBy: 'ASC' }
      ),
      this.getAgentPrompts(agentId),
    ]);

    const events: ChatEvent[] = [];
    for (const msg of messages) {
      if (msg.content && msg.content.includes('<system-hidden-for-user>') && msg.content.includes('</system-hidden-for-user>')) {
        continue;
      }

      if (msg.role === 'user') {
        const displayContent = this.removePromptAdditionalInformation(msg.content);
        let matchingPrompt = msg.taskId
          ? agentPrompts.find(p => p.id === msg.taskId)
          : null;
        if (!matchingPrompt) {
          matchingPrompt = agentPrompts.find(p => p.prompt === msg.content);
        }
        if (!matchingPrompt) continue;

        const status = matchingPrompt.status as 'sending' | 'queued' | 'running' | 'finished' | 'failed';
        events.push({
          id: msg.id,
          type: 'prompt',
          timestamp: msg.timestamp.getTime(),
          taskId: matchingPrompt.id,
          data: { prompt: displayContent, status, is_reverted: msg.isReverted || false }
        } as PromptEvent);
      } else {
        let tools: Array<{ use: ToolUse; result?: ToolResult }> = [];
        if (msg.tools) {
          try {
            const parsed = typeof msg.tools === 'string' ? JSON.parse(msg.tools as string) : msg.tools;
            if (Array.isArray(parsed)) {
              tools = parsed.filter(tool => tool.use && tool.use.name !== 'TodoWrite' && tool.use.name !== 'TodoRead');
            }
          } catch (e) { /* ignore parse errors */ }
        }
        if (msg.content || tools.length > 0) {
          events.push({
            id: msg.id,
            type: 'response',
            timestamp: msg.timestamp.getTime(),
            taskId: msg.taskId,
            data: {
              content: msg.content || '',
              model: msg.model,
              tools: tools.length > 0 ? tools : undefined,
              is_reverted: msg.isReverted || false,
              ...(msg.isStreaming ? { is_streaming: true } : {})
            }
          } as ResponseEvent);
        }
      }
    }
    return events;
  }

  /**
   * Build ChatEvents for specific prompt IDs (for WS delta updates).
   * Used for both new queued prompts and status transitions.
   */
  async getChatEventsForPromptIds(agentId: string, promptIds: string[]): Promise<ChatEvent[]> {
    if (promptIds.length === 0) return [];

    const prompts = await this.repositories.agentPrompts.findMany(
      { id: { in: promptIds }, agentId },
      { orderBy: { createdAt: 'asc' } }
    );

    // For each prompt, check if there's a matching message (prompt already sent to agent)
    const messages = await this.repositories.agentMessages.findMany(
      { agentId, taskId: { in: promptIds }, role: 'user' },
      { orderBy: 'ASC' }
    );
    const msgByTaskId = new Map(messages.map(m => [m.taskId, m]));

    return prompts.map(p => {
      const msg = msgByTaskId.get(p.id);
      const displayContent = this.removePromptAdditionalInformation(p.prompt);
      const status = p.status as 'sending' | 'queued' | 'running' | 'finished' | 'failed';
      return {
        id: msg?.id || `qp-${p.id}`,
        type: 'prompt' as const,
        timestamp: (msg?.timestamp || p.createdAt || new Date()).getTime(),
        taskId: p.id,
        data: { prompt: displayContent, status, is_reverted: msg?.isReverted || false }
      } as PromptEvent;
    });
  }

  /**
   * Build ChatEvents for specific commit IDs (for WS delta updates).
   */
  async getChatEventsForCommitIds(commitIds: string[]): Promise<ChatEvent[]> {
    if (commitIds.length === 0) return [];

    const commits = await this.repositories.agentCommits.findMany(
      { id: { in: commitIds } },
      { orderBy: 'ASC' }
    );

    const events: ChatEvent[] = [];
    for (const commit of commits) {
      if (!commit.createdAt || commit.isDeleted) continue;
      events.push({
        id: commit.id,
        type: 'git_checkpoint',
        timestamp: commit.createdAt.getTime(),
        taskId: commit.taskId,
        data: {
          commitSha: commit.commitSha,
          commitMessage: commit.commitMessage,
          commitUrl: commit.commitUrl,
          branch: commit.branchName,
          filesChanged: commit.filesChanged ?? 0,
          additions: commit.additions ?? 0,
          deletions: commit.deletions ?? 0,
          timestamp: commit.createdAt.getTime(),
          pushed: commit.pushed || false,
          is_reverted: commit.isReverted || false
        }
      } as GitCheckpointEvent);
    }
    return events;
  }

  /**
   * Build ChatEvents for specific reset IDs (for WS delta updates).
   */
  async getChatEventsForResetIds(resetIds: string[]): Promise<ChatEvent[]> {
    if (resetIds.length === 0) return [];

    const resets = await this.repositories.agentResets.findByIds(resetIds);

    const events: ChatEvent[] = [];
    for (const reset of resets) {
      if (!reset.createdAt) continue;
      events.push({
        id: reset.id,
        type: 'reset',
        timestamp: reset.createdAt.getTime(),
        taskId: reset.taskId,
        data: {}
      } as ResetEvent);
    }
    return events;
  }

  /**
   * Build ChatEvents for specific automation event IDs (for WS delta updates).
   */
  async getChatEventsForAutomationEventIds(automationEventIds: string[]): Promise<ChatEvent[]> {
    if (automationEventIds.length === 0) return [];

    const autoEvents = await this.repositories.automationEvents.findByIds(automationEventIds);

    // Batch-prefetch automation details
    const automationIds = [...new Set(autoEvents.map(e => e.automationId))];
    const automationsArr = await Promise.all(automationIds.map(id => this.repositories.automations.findById(id)));
    const automationMap = new Map(automationsArr.filter(Boolean).map(a => [a!.id, a!]));

    const events: ChatEvent[] = [];
    for (const autoEvent of autoEvents) {
      if (!autoEvent.createdAt) continue;
      const automation = automationMap.get(autoEvent.automationId);
      if (!automation) continue;

      events.push({
        id: autoEvent.id,
        type: 'automation',
        timestamp: autoEvent.createdAt.getTime(),
        taskId: autoEvent.taskId,
        data: {
          automationId: autoEvent.automationId,
          automationName: automation.parsedData.name,
          trigger: autoEvent.trigger,
          output: autoEvent.output,
          isStartTruncated: autoEvent.isStartTruncated,
          status: autoEvent.status as 'running' | 'finished' | 'failed' | 'killed',
          exitCode: autoEvent.exitCode,
          startedAt: autoEvent.startedAt?.getTime() || null,
          finishedAt: autoEvent.finishedAt?.getTime() || null,
          blocking: automation.parsedData.blocking,
          feedOutput: automation.parsedData.feedOutput
        }
      } as AutomationEvent);

      // Also emit the synthetic automation_output_added event if applicable
      if (
        (autoEvent.status === 'finished' || autoEvent.status === 'failed') &&
        automation.parsedData.feedOutput && autoEvent.finishedAt
      ) {
        events.push({
          id: `${autoEvent.id}-output-added`,
          type: 'automation_output_added',
          timestamp: autoEvent.finishedAt.getTime(),
          taskId: autoEvent.taskId,
          data: { automationId: autoEvent.automationId, automationName: automation.parsedData.name }
        } as ChatEvent);
      }
    }
    return events;
  }

  /**
   * Build ChatEvents for specific context event IDs (for WS delta updates).
   */
  async getChatEventsForContextEventIds(contextEventIds: string[]): Promise<ChatEvent[]> {
    if (contextEventIds.length === 0) return [];

    const ctxEvents = await this.repositories.agentContextEvents.findByIds(contextEventIds);

    const events: ChatEvent[] = [];
    for (const ctxEvent of ctxEvents) {
      if (!ctxEvent.createdAt) continue;
      if (ctxEvent.type === 'context_warning') {
        events.push({
          id: ctxEvent.id, type: 'context_warning', timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: {
            contextUsedPercent: ctxEvent.contextUsedPercent!, contextRemainingPercent: ctxEvent.contextRemainingPercent!,
            inputTokens: ctxEvent.inputTokens!, cacheTokens: ctxEvent.cacheTokens!, contextWindow: ctxEvent.contextWindow!
          }
        } as ContextWarningEvent);
      } else if (ctxEvent.type === 'compaction_start') {
        events.push({
          id: ctxEvent.id, type: 'compaction_start', timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: { triggerReason: ctxEvent.triggerReason as 'threshold_exceeded' | 'manual', contextUsedPercent: ctxEvent.contextUsedPercent! }
        } as CompactionStartEvent);
      } else if (ctxEvent.type === 'compaction_complete') {
        events.push({
          id: ctxEvent.id, type: 'compaction_complete', timestamp: ctxEvent.createdAt.getTime(),
          taskId: ctxEvent.taskId,
          data: { summary: ctxEvent.summary!, tokensBefore: ctxEvent.tokensBefore!, tokensAfter: ctxEvent.tokensAfter ?? null, tokensSaved: ctxEvent.tokensSaved ?? null }
        } as CompactionCompleteEvent);
      }
    }
    return events;
  }

  async getAgentCommits(
    agentId: string,
  ): Promise<AgentCommit[]> {
    return this.repositories.agentCommits.getAgentCommits(agentId);
  }

  async getAgentResets(
    agentId: string,
  ) {
    return this.repositories.agentResets.getAgentResets(agentId);
  }

  async revertToCheckpoint(
    agentId: string,
    checkpointSha: string
  ): Promise<void> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    if (!agent.machineId) {
      throw new Error('Agent has no machine - cannot revert');
    }

    // Find the checkpoint commit
    const checkpointCommit = await this.repositories.agentCommits.findOne({
      agentId: agentId,
      commitSha: checkpointSha
    });

    // Allow reverting to startCommitSha even if it's not in agentCommits table
    const isStartCommit = checkpointSha === agent.startCommitSha;

    if (!checkpointCommit && !isStartCommit) {
      throw new Error('Checkpoint commit not found');
    }

    // Call agents-server to perform git reset
    const resetResponse = await this.sendToAgentServer(
      agent.machineId,
      '/git-reset',
      {
        agentId,
        commitSha: checkpointSha
      }
    );

    const resetData = await resetResponse.json();
    if (!resetData.success) {
      throw new Error(`Git reset failed: ${resetData.error || 'Unknown error'}`);
    }

    // Determine the timestamp for marking messages/commits as reverted
    const revertTimestamp = checkpointCommit?.createdAt?.getTime() || agent.createdAt?.getTime() || 0;

    // Mark messages as reverted
    const allMessages = await this.repositories.agentMessages.getAgentMessages(agentId);
    const messagesToRevert = allMessages
      .filter(msg => msg.timestamp.getTime() > revertTimestamp)
      .map(msg => msg.id);

    if (messagesToRevert.length > 0) {
      await this.repositories.agentMessages.markAsReverted(agentId, messagesToRevert, checkpointSha);
    }

    // Mark commits as deleted (they were removed from git by reset --hard)
    await this.repositories.agentCommits.markCommitsAsDeleted(
      agentId,
      revertTimestamp,
      checkpointSha
    );

    // Update agent's lastCommitSha to the checkpoint we reverted to
    await this.repositories.agents.updateAgentFields(agentId, {
      lastCommitSha: checkpointSha,
      lastCommitUrl: checkpointCommit?.commitUrl || null,
      lastCommitAt: checkpointCommit?.createdAt || new Date()
    });

    logger.info(`Agent ${agentId} ${agent.name} reverted to checkpoint ${checkpointSha}${isStartCommit ? ' (startCommitSha)' : ''}`);
  }

  async trashAgent(agentId: string, userId: string): Promise<void> {
    const ownsAgent = await this.userOwnsAgent(agentId, userId);
    if (!ownsAgent) {
      throw new Error('You can only trash your own agents');
    }
    // Now trashes instead of deleting
    await this.claudeService.trashAgent(agentId);
  }

  async untrashAgent(agentId: string, userId: string): Promise<void> {
    const ownsAgent = await this.userOwnsAgent(agentId, userId);
    if (!ownsAgent) {
      throw new Error('You can only restore your own agents from trash');
    }
    await this.claudeService.untrashAgent(agentId);
  }

  async updateAgentState(agentId: string, state: string): Promise<void> {
    await this.repositories.agents.updateState(agentId, state as any);
  }

  async clearAgentMachine(agentId: string): Promise<void> {
    const now = new Date();

    // Get current machineId to preserve as lastMachineId for snapshot lookup
    const agent = await this.repositories.agents.getAgentById(agentId);
    const machineIdToPreserve = agent?.machineId;

    await this.repositories.agents.update(
      { id: agentId },
      {
        // Preserve machineId as lastMachineId for snapshot lookup during resume
        ...(machineIdToPreserve ? { lastMachineId: machineIdToPreserve } : {}),
        machineId: null,
        machineIpv4: null,
        machineSharedKey: null,
        isRunning: false,
        isReady: false,
        updatedAt: now
      }
    );
  }

  async getAllAgents(): Promise<Agent[]> {
    return await this.repositories.agents.getAllAgents();
  }

  async interruptAgent(agentId: string, userId: string): Promise<void> {
    // Access check is done at API handler level via hasWriteAccess
    // No need for redundant ownership check here - allows shared users with write access
    await this.claudeService.interruptAgent(agentId);
  }

  async resetAgent(agentId: string, userId: string): Promise<void> {
    // Access check is done at API handler level via hasWriteAccess
    // No need for redundant ownership check here - allows shared users with write access

    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    if (!agent.machineId) {
      throw new Error('Agent has no machine - cannot reset');
    }

    // Call agents-server to reset conversation
    const resetResponse = await this.sendToAgentServer(
      agent.machineId,
      '/reset',
      {}
    );

    const resetData = await resetResponse.json();
    if (!resetData.success) {
      throw new Error(`Reset failed: ${resetData.error || 'Unknown error'}`);
    }

    // Create a reset event in the database
    const currentTaskId = agent.currentTaskId;
    await this.repositories.agentResets.createReset({
      id: `reset-${agentId}-${Date.now()}`,
      agentId,
      taskId: currentTaskId || null
    });

    logger.info(`Agent ${agentId} ${agent.name} conversation reset successfully`);

    await this.claudeService.triggerAutomations(agent, 'on_after_reset');
  }

  async cleanupAllMachines(): Promise<void> {
    return this.claudeService.cleanupAllMachines();
  }

  /**
   * Trigger automations for an agent (delegates to ClaudeAgentService)
   */
  async triggerAutomations(
    agent: any,
    triggerType: 'on_agent_ready' | 'on_before_commit' | 'on_after_commit' | 'on_before_push_pr' | 'on_after_push_pr' | 'on_automation_finishes' | 'on_after_reset',
    context?: any
  ): Promise<string[]> {
    return this.claudeService.triggerAutomations(agent, triggerType, context);
  }

  async startupProcedure(): Promise<void> {
    return this.claudeService.startupProcedure();
  }

  async healthCheckMachine(machineId: string): Promise<Response> {
    return await this.claudeService.healthCheckMachine(machineId);
  }

  async sendToAgentServer(machineId: string, endpoint: string, body?: any, timeoutMs?: number): Promise<Response> {
    return this.claudeService.sendToAgentServer(machineId, endpoint, body, timeoutMs);
  }

  /**
   * Execute ralph mode setup on agent machine
   * Creates ~/.ariana-ralph-notes/ directory with README.md and .task-lock file
   */
  async executeRalphModeSetup(agentId: string, taskDescription: string): Promise<void> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) {
      throw new Error('Agent not found');
    }

    if (!agent.machineId) {
      throw new Error('Agent has no machine - cannot setup ralph mode');
    }

    const response = await this.sendToAgentServer(
      agent.machineId,
      '/ralph-mode-setup',
      { taskDescription }
    );

    const data = await response.json();
    if (!data.success) {
      throw new Error(`Ralph mode setup failed: ${data.error || 'Unknown error'}`);
    }

    logger.info`Ralph mode setup completed for agent ${agentId}`;
  }

  async startAgent(
      agentId: string,
      params: {
        baseBranch?: string;
        setupType?: string;
        remotePath?: string;
        cloneUrl?: string;
        branch?: string;
        credentialsEnvironment: Record<string, string>;
        agentProviderConfig: AgentProviderConfig;
        dontSendInitialMessage?: boolean;
        // Patch-based upload parameters
        commits?: Array<{ title: string; patch: string; timestamp?: number }>;
        gitHistoryLastPushedCommitSha?: string | null;
        uncommittedPatch?: string | null;
      }): Promise<void> {
    return this.claudeService.startAgent(agentId, params);
  }

  wrapPromptAdditionalInformation(additionalInformation: string): string {
    return `<<PROMPT_ADDITIONAL_INFORMATION>> ${additionalInformation} <<PROMPT_ADDITIONAL_INFORMATION>>`;
  }

  removePromptAdditionalInformation(content: string): string {
    const regex = /<<PROMPT_ADDITIONAL_INFORMATION>>[\s\S]*?<<PROMPT_ADDITIONAL_INFORMATION>>/g;
    return content.replace(regex, '').trim();
  }

  // Move agents from one project to another
  async moveAgentsToProject(fromProjectId: string, toProjectId: string): Promise<number> {
    return this.repositories.agents.moveAgentsToProject(fromProjectId, toProjectId);
  }

  // Claude Code OAuth token management
  async saveClaudeCodeOauthToken(userId: string, token: string) {
    return this.claudeService.saveClaudeCodeOauthToken(userId, token);
  }

  async removeClaudeCodeOauthToken(userId: string) {
    return this.claudeService.removeClaudeCodeOauthToken(userId);
  }

  // Update commit fields
  async updateCommit(commitId: string, fields: Partial<AgentCommit>): Promise<void> {
    await this.repositories.agentCommits.update(commitId, fields);
  }

  // Update agent fields
  async updateAgent(agentId: string, fields: Partial<Agent>): Promise<void> {
    await this.repositories.agents.updateAgentFields(agentId, fields);
  }

  async hasClaudeToken(userId: string) {
    return this.claudeService.hasClaudeToken(userId);
  }

  // Fork-related methods
  async copyMessagesFromAgent(sourceAgentId: string, targetAgentId: string, promptIdMapping: Map<string, string>): Promise<number> {
    return await this.repositories.agentMessages.copyMessagesFromAgent(sourceAgentId, targetAgentId, promptIdMapping);
  }

  // Removed: copyCommitsFromAgent - commits are now populated by polling, not copied during fork

  async copyPromptsFromAgent(sourceAgentId: string, targetAgentId: string): Promise<{ count: number; idMapping: Map<string, string> }> {
    return await this.repositories.agentPrompts.copyPromptsFromAgent(sourceAgentId, targetAgentId);
  }

  async copyResetsFromAgent(sourceAgentId: string, targetAgentId: string, promptIdMapping: Map<string, string>): Promise<number> {
    return await this.repositories.agentResets.copyResetsFromAgent(sourceAgentId, targetAgentId, promptIdMapping);
  }

  async updateAgentFields(agentId: string, fields: Partial<Agent>): Promise<void> {
    await this.repositories.agents.updateAgentFields(agentId, fields);
  }

  getParkingMetrics() {
    return this.claudeService.getParkingMetrics();
  }

  // Get all agents in a project without user filtering (for admin operations)
  async getAllProjectAgents(projectId: string): Promise<Agent[]> {
    return await this.repositories.agents.getProjectAgents(projectId);
  }

  // Update credentials for all running agents owned by a user using the unified config
  async updateCredentialsForUserAgentsWithConfig(userId: string, config: AgentProviderConfig): Promise<{ success: number; failed: number; total: number }> {
    logger.info`Updating credentials for all agents owned by user ${userId}`;

    // Get all running agents for this user
    const allAgents = await this.getUserAgents(userId);
    const runningAgents = allAgents.filter(agent => agent.isRunning && agent.machineId);

    logger.info`Found ${runningAgents.length} running agents for user ${userId}`;

    // Get environment from the unified config
    const environment = getActiveEnvironment(config);

    let successCount = 0;
    let failedCount = 0;

    // Update each running agent
    for (const agent of runningAgents) {
      try {
        logger.info`Updating credentials for agent ${agent.id} (machine ${agent.machineId})`;
        const response = await this.sendToAgentServer(
          agent.machineId!,
          '/update-credentials',
          { environment, agentProviderConfig: config }
        );

        const result = await response.json();
        if (result.status === 'success' || response.ok) {
          successCount++;
          logger.info`Successfully updated credentials for agent ${agent.id}`;
        } else {
          failedCount++;
          logger.error`Failed to update credentials for agent ${agent.id}: ${result.error || 'Unknown error'}`;
        }
      } catch (error) {
        failedCount++;
        logger.error`Error updating credentials for agent ${agent.id}: ${error}`;
      }
    }

    logger.info`Credential update complete: ${successCount} succeeded, ${failedCount} failed out of ${runningAgents.length} total`;

    return {
      success: successCount,
      failed: failedCount,
      total: runningAgents.length
    };
  }

  async updateSecretsForAgent(agentId: string): Promise<void> {
    await this.claudeService.updateSecretsForAgent(agentId);
  }

  // Update environment for a single agent
  async updateEnvironmentForAgent(agentId: string): Promise<void> {
    logger.info`Updating environment for agent ${agentId}`;
    await this.claudeService.updateEnvironmentForAgent(agentId);
  }


  // Resume an archived agent (triggers machine provisioning)
  async resumeArchivedAgent(agentId: string): Promise<void> {
    return this.claudeService.resumeArchivedAgent(agentId);
  }

  // Resume an error agent (triggers machine provisioning)
  async resumeErrorAgent(agentId: string): Promise<void> {
    return this.claudeService.resumeErrorAgent(agentId);
  }

  // Get total count of Agent records
  async getTotalAgentsCount(): Promise<number> {
    return this.repositories.agents.count();
  }

  /**
   * Queue the initial ralph mode prompt when ralph mode is activated.
   * This is called from the handler after setting up ralph mode.
   */
  async queueRalphModeInitialPrompt(agentId: string): Promise<void> {
    const agent = await this.repositories.agents.getAgentById(agentId);
    if (!agent) return;

    // Get the last prompt to reuse the same model
    const lastPrompts = await this.repositories.agentPrompts.findMany(
      { agentId: agent.id, status: 'finished' },
      { orderBy: { createdAt: 'desc' }, limit: 1 }
    );
    const lastPromptModel = lastPrompts?.[0]?.model as 'opus' | 'sonnet' | 'haiku' | undefined;

    // Queue the ralph mode prompt
    await this.queuePrompt(
      agent.id,
      {
        message: RALPH_MODE_PROMPT,
        model: lastPromptModel || 'sonnet',
        additionalPlainTextData: null
      },
      agent.userId
    );

    logger.info`Agent ${agentId} queued initial ralph mode prompt`;
  }

}