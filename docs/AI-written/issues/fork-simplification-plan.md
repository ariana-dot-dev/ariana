# Fork Simplification Plan

## Current State Analysis

### What Currently Happens in Fork/Resume

**agentMovements.service.ts `forkOrResume()` (lines 143-542):**

```
PHASE 1: Validation & Setup (lines 143-209) - KEEP ALL
├─ Validate source agent exists
├─ Check access permissions
├─ Check machine pool capacity
├─ Determine if resuming vs forking
└─ Create new agent record OR resume existing

PHASE 2: Get Project & Attachments (lines 211-303) - MOSTLY REMOVE
├─ Get project and attachments (KEEP project lookup)
├─ Get commits (REMOVE - not needed for snapshot)
├─ Determine clone source (REMOVE - complex GitHub/SCP logic)
└─ Prepare patches (REMOVE - not needed for snapshot)

PHASE 3: Wait for Provisioning (lines 305-326) - KEEP ALL
├─ Poll until target agent reaches PROVISIONED
└─ Return enriched agent for response

PHASE 4: Background Setup (lines 328-535)
├─ Copy DB records if not resuming (lines 334-356) - KEEP ALL
│   ├─ copyPromptsFromAgent
│   ├─ copyMessagesFromAgent
│   ├─ copyResetsFromAgent
│   ├─ copyCompactionsFromAgent
│   └─ updateAgentFields (git info, last prompt/tool info)
│
├─ Get git user info (lines 360-369) - KEEP ALL
│   └─ GitHub profile for gitUserName/gitUserEmail
│
├─ Get environment (line 372) - KEEP ALL
│   └─ getActiveCredentials(targetUser.id) → environment vars
│
├─ FILE TRANSFER (lines 374-507) - REPLACE WITH SNAPSHOT
│   ├─ SCP transfer path (lines 374-444) - REMOVE
│   └─ Git-based fork path (lines 446-507) - REMOVE
│
├─ Start agent (shared in both paths) - KEEP (modify)
│   └─ /start with { type: 'existing', environment, gitUserName, gitUserEmail }
│
├─ Update to READY state (lines 510-515) - KEEP ALL
├─ Trigger automations (lines 517-521) - KEEP ALL
└─ Update secrets (line 525) - KEEP ALL
    └─ updateSecretsForAgent() → sends secrets + SSH keys to machine
```

### How Environment Variables Work

1. **At fork/resume**: `getActiveCredentials(userId)` returns `{ environment: Record<string, string> }`
2. **Passed to `/start`**: The `environment` object is sent to agents-server
3. **agents-server/handlers/start.ts**:
   - Sets `process.env[key] = value` for Claude SDK
   - Writes to `.bashrc` for SSH access
4. **After start**: `updateSecretsForAgent()` separately handles secret files + SSH keys

**KEY INSIGHT**: Environment vars are NOT in the snapshot - they're sent separately via `/start`. This is correct because:
- Different users may have different environments
- Secrets should not be in filesystem snapshots

---

## Proposed Simplification

### Core Concept

Replace ONLY the file transfer portion (lines 374-507) with snapshot restore:
- Current: SCP transfer OR git clone + patch application
- New: Download R2 snapshot → extract to `/`

Everything else stays EXACTLY the same.

### New Architecture

```
Agent Running → State Change → Snapshot Queue → R2 Upload (background)
                                    ↓
Fork/Resume → Check Snapshot → Provision Machine → Restore Snapshot → /start
```

---

## Implementation Plan

### Phase 1: Block Custom Machine Forking

**Files to modify:**
- `backend/src/services/agentMovements.service.ts`

**Changes (add after line 159):**
```typescript
// 2.5 Block forking from custom machines
if (sourceAgent.machineType === 'custom') {
  throw new Error('Cannot fork agents running on custom machines');
}
```

**Frontend changes:**
- `frontend/src/components/agent-manager/AgentListItem.tsx`
- `frontend/src/components/agent-chat/AgentSyncHeader.tsx`
- Add check: `agent.machineType === 'custom'` → disable fork button

### Phase 2: Database Schema for Snapshots

**Add to `schema.prisma`:**
```prisma
model AgentSnapshot {
  id          String    @id
  agentId     String
  machineId   String
  status      String    @default("queued")  // queued, in_progress, completed, failed
  r2Key       String?
  sizeBytes   BigInt?
  createdAt   DateTime  @default(now())
  completedAt DateTime?
  expiresAt   DateTime  // 30 days from creation
  error       String?

  agent       Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@index([agentId, status])
  @@index([agentId, completedAt])
  @@index([expiresAt])
}
```

**Add field to Agent model:**
```prisma
latestSnapshotId String?  // Points to most recent completed snapshot
```

### Phase 3: Snapshot Service

**New file: `backend/src/services/snapshot.service.ts`**

```typescript
export class SnapshotService {
  // Queue a snapshot request (called before agent state changes)
  async requestSnapshot(agentId: string): Promise<void> {
    const agent = await this.getAgent(agentId);
    if (!agent?.machineId || !agent.isRunning) return;
    if (agent.machineType === 'custom') return; // No snapshots for custom machines

    // Cancel any queued snapshots for this agent
    await this.cancelQueuedSnapshots(agentId);

    // Check if snapshot already in progress
    const inProgress = await this.getInProgressSnapshot(agentId);
    if (inProgress) {
      // Queue for after current completes
      await this.createSnapshot(agentId, agent.machineId, 'queued');
    } else {
      // Start immediately
      await this.startSnapshot(agentId, agent.machineId);
    }
  }

  // Get latest completed snapshot for an agent
  async getLatestSnapshot(agentId: string): Promise<AgentSnapshot | null> {
    return await this.prisma.agentSnapshot.findFirst({
      where: { agentId, status: 'completed' },
      orderBy: { completedAt: 'desc' }
    });
  }

  // Background worker: process queue and create snapshots
  async processSnapshotQueue(): Promise<void> {
    // Find agents with queued snapshots and no in-progress
    // Start snapshot for each
  }

  // Cleanup expired snapshots (scheduled job)
  async cleanupExpiredSnapshots(): Promise<void> {
    const expired = await this.prisma.agentSnapshot.findMany({
      where: { expiresAt: { lt: new Date() } }
    });
    for (const snapshot of expired) {
      if (snapshot.r2Key) {
        await this.r2.delete(snapshot.r2Key);
      }
      await this.prisma.agentSnapshot.delete({ where: { id: snapshot.id } });
    }
  }
}
```

### Phase 4: Agents-Server Snapshot Handlers

**New file: `backend/agents-server/src/handlers/createSnapshot.ts`**

```typescript
// POST /create-snapshot
// Input: { presignedUploadUrl: string }
// Creates tar.gz of / (excluding /proc, /sys, /dev, /tmp, /run, /snap)
// Uploads to R2 via presigned URL
// Returns: { success: boolean, sizeBytes: number }
```

**New file: `backend/agents-server/src/handlers/restoreSnapshot.ts`**

```typescript
// POST /restore-snapshot
// Input: { presignedDownloadUrl: string }
// Downloads tar.gz from R2
// Extracts to /
// Returns: { success: boolean }
```

### Phase 5: Centralize State Changes (Trigger Snapshots)

**Files to modify:**
- `backend/src/services/agent.service.ts`

**New method:**
```typescript
async updateAgentStateWithSnapshot(
  agentId: string,
  newState: AgentState,
  additionalUpdates?: Partial<Agent>
): Promise<void> {
  const agent = await this.getAgent(agentId);

  // Request snapshot if agent is running on Hetzner
  if (agent?.isRunning && agent.machineType !== 'custom') {
    await this.snapshotService.requestSnapshot(agentId);
  }

  // Update state
  await this.updateAgent(agentId, { state: newState, ...additionalUpdates });
}
```

**Replace state updates in these locations:**
- After prompt completes (RUNNING → IDLE)
- After automations (various states)
- On interrupt
- On reset
- Any other state transition while machine is running

### Phase 6: Simplify forkOrResume

**In `agentMovements.service.ts`, replace lines 211-507 with:**

```typescript
// 5. Check snapshot exists (replaces hasWorkDone check)
const snapshot = await this.services.snapshots.getLatestSnapshot(sourceAgentId);
if (!snapshot) {
  throw new Error('Cannot fork: no snapshot available for this agent');
}

// Skip old: Get project, attachments, commits, clone source, patches

// 6. Wait for provisioning (KEEP lines 305-320 as-is)
// ...existing provisioning wait code...

// 7. Background setup
(async () => {
  try {
    // Copy database records if not resuming (KEEP lines 334-356 EXACTLY)
    if (!isOwnerResuming) {
      logger.info`Copying database records from ${sourceAgentId} to ${targetAgentId}`;
      const promptCopyResult = await this.services.agents.copyPromptsFromAgent(sourceAgentId, targetAgentId);
      await Promise.all([
        this.services.agents.copyMessagesFromAgent(sourceAgentId, targetAgentId, promptCopyResult.idMapping),
        this.services.agents.copyResetsFromAgent(sourceAgentId, targetAgentId, promptCopyResult.idMapping),
        this.services.agents.copyCompactionsFromAgent(sourceAgentId, targetAgentId, promptCopyResult.idMapping)
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
        lastToolAt: sourceAgent.lastToolAt
      });
    }

    // Get git user info (KEEP lines 360-369 EXACTLY)
    const targetUser = await this.services.users.getUserById(newOwnerId);
    if (!targetUser) throw new Error('Target user not found');
    let githubProfile = null;
    if (targetUser.githubProfileId) {
      githubProfile = await this.services.github.getUserGithubProfile(targetUser.id);
    }
    const gitUserName = githubProfile?.name || targetUser.id;
    const gitUserEmail = githubProfile?.email || `${targetUser.id}@github.local`;

    // Get environment (KEEP line 372 EXACTLY)
    const { environment } = await this.services.users.getActiveCredentials(targetUser.id);

    // NEW: Restore snapshot (replaces SCP/git transfer)
    const presignedUrl = await this.services.snapshots.getPresignedDownloadUrl(snapshot.r2Key);
    const restoreResponse = await this.services.agents.sendToAgentServer(
      provisionedAgent.machineId,
      '/restore-snapshot',
      { presignedDownloadUrl: presignedUrl },
      300000 // 5 min timeout
    );
    const restoreData = await restoreResponse.json();
    if (!restoreData.success) throw new Error(`Failed to restore snapshot: ${restoreData.error}`);

    // Start agent (KEEP - same as before, type: 'existing')
    const startResponse = await this.services.agents.sendToAgentServer(
      provisionedAgent.machineId,
      '/start',
      {
        setup: { type: 'existing', targetBranch: provisionedAgent.branchName },
        gitUserName,
        gitUserEmail,
        credentials: {},
        environment,  // <-- Environment vars passed here, not in snapshot
        dontSendInitialMessage: true
      }
    );
    const startData = await startResponse.json();
    if (!startData.status || startData.status !== 'success') {
      throw new Error(`Failed to start agent: ${startData.error}`);
    }

    await this.services.agents.updateAgentFields(targetAgentId, {
      startCommitSha: sourceAgent.startCommitSha || null,
      gitHistoryLastPushedCommitSha: startData.gitHistoryLastPushedCommitSha || null
    });

    // Update to READY state (KEEP lines 510-515 EXACTLY)
    await this.services.agents.updateAgent(targetAgentId, {
      state: AgentState.READY,
      isRunning: true,
      isReady: true
    });

    // Trigger automations (KEEP lines 517-521 EXACTLY)
    const forkedAgent = await this.services.agents.getAgent(targetAgentId);
    if (forkedAgent) {
      await this.services.agents.triggerAutomations(forkedAgent, 'on_agent_ready');
      await this.services.agents.updateAgent(targetAgentId, { state: AgentState.IDLE });
    }

    // Update secrets (KEEP line 525 EXACTLY)
    await this.services.agents.updateSecretsForAgent(targetAgentId);

    logger.info`Agent fork/resume completed successfully: ${sourceAgentId} -> ${targetAgentId}`;
  } catch (error) {
    // ... existing error handling
  }
})();
```

### Phase 7: Update Frontend Fork Conditions

**Files to modify:**
- `frontend/src/components/agent-manager/AgentListItem.tsx`
- `frontend/src/components/agent-chat/AgentSyncHeader.tsx`

**Changes:**
- Remove `hasWorkDone` check (`!!agent.lastPromptText`)
- Add `hasSnapshot` field to agent API response (or check via separate API)
- Disable fork if: `machineType === 'custom'` OR `!hasSnapshot`
- Update tooltip messages accordingly

### Phase 8: Scheduled Cleanup Job

**In `backend/src/services/scheduledJobs.service.ts`:**

```typescript
// Run daily
async cleanupExpiredSnapshots() {
  await this.snapshotService.cleanupExpiredSnapshots();
}
```

---

## Files to DELETE

### Entire Files:
1. `backend/src/api/agents/fork-bundle-handlers.ts`
2. `backend/src/services/forkBundle.service.ts`
3. `backend/src/data/repositories/forkBundle.repository.ts`
4. `backend/agents-server/src/handlers/restoreGitHistory.ts`
5. `backend/agents-server/src/handlers/exportProjectViaScp.ts`
6. `backend/agents-server/src/handlers/importProjectViaScp.ts`
7. `backend/agents-server/src/handlers/restoreClaudeDir.ts`

### Database Tables to DELETE:
1. `ForkBundleChunk`
2. `ForkBundleFinalized`

### Code Sections to DELETE in `agentMovements.service.ts`:
- Lines 211-218: Get attachments and commits (can keep project lookup)
- Lines 220-303: Clone source determination + patch preparation
- Lines 374-507: SCP transfer and git-based fork logic

### Routes to DELETE:
- `/fork-bundle-chunk`
- `/fork-bundle-finalize`
- `/restore-git-history`
- `/export-project-via-scp`
- `/import-project-via-scp`
- `/restore-claude-dir`

---

## What Stays EXACTLY The Same

### In `agentMovements.service.ts`:
1. **Lines 143-209**: Validation, access check, machine pool check, create/resume agent
2. **Lines 305-326**: Wait for provisioning
3. **Lines 334-356**: Copy DB records (prompts, messages, resets, compactions)
4. **Lines 360-369**: Get git user info
5. **Line 372**: Get environment (`getActiveCredentials`)
6. **Lines 510-525**: Update to READY, trigger automations, update secrets

### Agents-server handlers that STAY:
- `/start` - still used with `type: 'existing'` to:
  - Set environment variables (process.env + .bashrc)
  - Configure git user
  - Start Claude service
- `/update-secrets` - still used by `updateSecretsForAgent()`
- `/update-environment` - still used for live env updates
- `/deploy-ssh-identity` - still used for SSH keys

---

## Rough Line Count Impact

**Removed:**
- `agentMovements.service.ts`: ~95 lines (lines 211-303, plus parts of file transfer)
- `fork-bundle-handlers.ts`: 145 lines (entire file)
- `forkBundle.service.ts`: 53 lines (entire file)
- `forkBundle.repository.ts`: 108 lines (entire file)
- `restoreGitHistory.ts`: 240 lines (entire file)
- `exportProjectViaScp.ts`: 117 lines (entire file)
- `importProjectViaScp.ts`: 74 lines (entire file)
- `restoreClaudeDir.ts`: ~50 lines (entire file)
- Route registrations: ~30 lines

**Total removed: ~910 lines**

**Added:**
- `snapshot.service.ts`: ~120 lines
- `snapshot.repository.ts`: ~60 lines
- `createSnapshot.ts` (agents-server): ~50 lines
- `restoreSnapshot.ts` (agents-server): ~40 lines
- Database migration: ~20 lines
- Modifications to agentMovements.service.ts: ~30 lines
- Frontend changes: ~15 lines

**Total added: ~335 lines**

**Net reduction: ~575 lines**

---

## Summary of Changes

| Aspect | Before | After |
|--------|--------|-------|
| File transfer method | SCP or Git+patches | R2 snapshot |
| Forkability check | `hasWorkDone` | `hasSnapshot` |
| Custom machine fork | Partially supported | Blocked |
| Resume behavior | Same as fork | Same as fork (both use snapshots) |
| Environment vars | Via `/start` | Via `/start` (unchanged) |
| Secrets/SSH keys | Via `updateSecretsForAgent` | Via `updateSecretsForAgent` (unchanged) |
| DB record copying | Full copy | Full copy (unchanged) |
| Git user config | Via `/start` | Via `/start` (unchanged) |
| Automations trigger | Via `on_agent_ready` | Via `on_agent_ready` (unchanged) |
