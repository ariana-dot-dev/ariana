# Agent State Machine Issues Analysis

## Overview

This document analyzes three related issues in the agent state machine:
1. Automations with `feedOutput: true` don't transition agent to RUNNING state
2. Race conditions when feeding output while agent is working
3. Agents getting stuck in IDLE after first prompt with fast blocking automations

## Architecture Summary

### Two-Level State Management

**Backend (Database):**
- `agent.state`: PROVISIONING → PROVISIONED → CLONING → READY → IDLE ↔ RUNNING → ARCHIVED/ERROR
- `agent.blockedByAutomationIds`: Array of automation IDs blocking the agent
- `agent.isRunning`, `agent.isReady`: Boolean flags

**Agents-Server (In-Memory):**
- `globalState.claudeReadyForPrompt`: Boolean - TRUE when Claude can accept prompts
- `globalState.claudeService._isProcessing`: Boolean - TRUE when processMessage() is running

### Polling Flow

Backend polls agents-server via:
1. `/claudeState` → returns `{ isReady: globalState.claudeReadyForPrompt }`
2. `/poll-automation-events` → returns pending automation events

State transitions happen in `handleClaudeStateTransitions()`:
- READY → IDLE: When `isReady=true`, trigger `on_agent_ready` automations
- IDLE → RUNNING: When `isReady=true`, not blocked, prompt queued → send `/prompt`
- RUNNING → IDLE: When `isReady=true`, not blocked

---

## Issue 1: FeedOutput Doesn't Set Agent to RUNNING

### Root Cause

In `executeAutomations.ts:166-177`:
```typescript
if (automation.feedOutput && result.output && globalState.claudeService) {
    await globalState.claudeService.processMessage(
        { message: contextPrompt },
        'sonnet'
    );
}
```

Compare to `prompt.ts:25-30`:
```typescript
globalState.claudeReadyForPrompt = false;  // <-- This is MISSING in feedOutput
try {
    await globalState.claudeService.processMessage({...});
    globalState.claudeReadyForPrompt = true;
```

**The Problem:**
- `prompt.ts` sets `claudeReadyForPrompt = false` BEFORE calling `processMessage()`
- `executeAutomations.ts` does NOT set `claudeReadyForPrompt = false`
- Backend polls `/claudeState` and sees `isReady = true` (from `claudeReadyForPrompt`)
- Agent appears IDLE even though Claude is actively generating a response

### Consequence

Agent produces new messages (visible in chat) but state stays IDLE. Users see the agent "speaking" but UI shows IDLE state.

### Fix Location

`backend/agents-server/src/handlers/executeAutomations.ts:166-177`

---

## Issue 2: Race Condition When Feeding Output While Agent Is Working

### Scenario A: Blocking Automation While Agent Processing

1. `/execute-automations` called with `blocking: true`
2. Line 104-108: `globalState.claudeService.abortProcessing()` called
3. Original `processMessage()` is aborted
4. `/prompt` handler catches abort, sets `claudeReadyForPrompt = true`
5. Automation runs, finishes
6. If `feedOutput: true`, calls `processMessage()` WITHOUT setting `claudeReadyForPrompt = false`

### Scenario B: Non-Blocking Automation While Agent Processing

1. `/execute-automations` called with `blocking: false`
2. No abort - Claude keeps processing original prompt
3. Automation runs in parallel
4. If `feedOutput: true`, tries to call `processMessage()` while another is running
5. **TWO CONCURRENT `processMessage()` CALLS!**

### Root Cause

`ClaudeService.processMessage()` has NO mutex/lock:
```typescript
async processMessage(request: MessageRequest, model) {
    this._isProcessing = true;  // Not thread-safe, no lock
    // ... processing ...
}
```

Multiple calls can overlap, corrupting:
- `this.messages` Map
- `this.abortController`
- SDK state

### Consequences

1. Corrupted conversation state
2. Messages associated with wrong prompts
3. Potential hung/stuck Claude SDK
4. Undefined behavior

---

## Issue 3: Agents Stuck in IDLE After First Prompt (Fast Blocking Automations)

### Observed Behavior

- New project with default blocking automations (e.g., `echo` commands)
- Agent processes first prompt, returns to IDLE
- Agent becomes "stuck" - won't process next prompt
- **Longer automations don't cause this issue**

### Root Cause: Timing Race

For fast automations like `echo "test"`:

```
Timeline:
[T0] Backend calls /execute-automations
[T1] "running" event added to pendingEvents
[T2] HTTP response returned to backend
[T3] Backend adds automation to blockedByAutomationIds
[T4] .then() callback executes automation (instant for echo)
[T5] "finished" event added to pendingEvents
[T6] If feedOutput: processMessage() starts
[T7] Backend polls /claudeState → isReady=true (claudeReadyForPrompt never set false)
[T8] Backend polls /poll-automation-events → gets [running, finished] events
[T9] "finished" event removes from blockedByAutomationIds
[T10] Agent is IDLE, not blocked, isReady=true
[T11] But feedOutput's processMessage() is STILL RUNNING!
[T12] Backend might send next prompt → CONCURRENT processMessage() calls
```

### Why Fast Automations Are Problematic

1. Fast automation completes before next poll cycle
2. Blocking is added then removed within milliseconds
3. `feedOutput` processMessage() starts but doesn't set `claudeReadyForPrompt = false`
4. Backend sees agent as "ready" while it's actually processing
5. If backend sends a prompt during feedOutput processing → race condition

### Why Slow Automations Don't Cause This

1. Automation takes longer than poll interval
2. Multiple poll cycles see the automation as "running"
3. More time for events to be processed correctly
4. feedOutput processing is more likely to complete before next prompt

---

## Proposed Fixes

### Fix 1: Set claudeReadyForPrompt for feedOutput

In `executeAutomations.ts`, before calling processMessage for feedOutput:

```typescript
if (automation.feedOutput && result.output && globalState.claudeService) {
    globalState.claudeReadyForPrompt = false;  // ADD THIS
    try {
        await globalState.claudeService.processMessage(...);
    } finally {
        globalState.claudeReadyForPrompt = true;  // ADD THIS
    }
}
```

### Fix 2: Add Processing Lock to ClaudeService

In `claudeService.ts`:

```typescript
export class ClaudeService {
    private processingLock: Promise<void> = Promise.resolve();

    async processMessage(request: MessageRequest, model) {
        // Wait for any existing processing to complete
        await this.processingLock;

        let resolveProcessing: () => void;
        this.processingLock = new Promise(r => resolveProcessing = r);

        try {
            this._isProcessing = true;
            // ... existing code ...
        } finally {
            this._isProcessing = false;
            resolveProcessing!();
        }
    }
}
```

### Fix 3: Coordinate feedOutput with State Tracking

Option A: Block during feedOutput
- Add feedOutput automation IDs to blockedByAutomationIds until processMessage completes

Option B: Queue feedOutput prompts
- Instead of calling processMessage directly, queue a special "system" prompt
- Let normal prompt processing handle it via /prompt endpoint

---

## Files Involved

| File | Line | Issue |
|------|------|-------|
| `agents-server/src/handlers/executeAutomations.ts` | 166-177 | feedOutput doesn't set claudeReadyForPrompt |
| `agents-server/src/handlers/prompt.ts` | 25-30 | Correctly sets claudeReadyForPrompt |
| `agents-server/src/claudeService.ts` | 242-301 | No mutex for processMessage() |
| `backend/src/services/claude-agent.service.ts` | 867-1018 | State transition logic |
| `agents-server/src/handlers/claudeState.ts` | 22-24 | Returns claudeReadyForPrompt |

---

## Severity Assessment

- **Issue 1**: HIGH - Agent state is incorrect, users see IDLE when agent is working
- **Issue 2**: CRITICAL - Race condition can corrupt conversation state, hang SDK
- **Issue 3**: HIGH - Blocks user workflow, requires agent restart

## Recommendation

Fix Issue 1 first (smallest change, biggest impact). Then implement Fix 2 to prevent race conditions. Fix 3 may be resolved by Fixes 1 and 2, but should be tested.

---

## IMPLEMENTED FIX (2024)

### Summary

Replaced the `blockedByAutomationIds` database tracking approach with a polling-based approach where:
1. Blocking state is tracked on agents-server via `runningBlockingAutomations` Set
2. Backend polls this state via `/claudeState` endpoint (`hasBlockingAutomation` field)
3. `feedOutput` now properly sets `claudeReadyForPrompt` to prevent state mismatch

### Changes Made

**agents-server:**
- `automationService.ts`: Added `startBlockingAutomation()`, `finishBlockingAutomation()`, `hasBlockingAutomationRunning()` methods
- `claudeState.ts`: Added `hasBlockingAutomation` and `blockingAutomationIds` to response
- `executeAutomations.ts`:
  - Track blocking automations via new methods
  - Wrap `feedOutput` processMessage with `claudeReadyForPrompt` state management

**backend:**
- `claude-agent.service.ts`:
  - Removed `addBlockingAutomations()` and `isAgentBlocked()` methods
  - State transitions now use `hasBlockingAutomation` from polled `/claudeState`
  - RUNNING state re-checks blocking after `createCheckpointForTask` (handles on_before/after_commit)
- `agent.service.ts`: Removed `addBlockingAutomations` method
- `agentMovements.service.ts`: Simplified fork/resume automation handling
- `automation-handlers.ts`: Removed manual blocking tracking for manual triggers

**shared types:**
- `ClaudeStateResponse`: Added `hasBlockingAutomation: boolean` and `blockingAutomationIds: string[]`

### Benefits
- Single source of truth for blocking state (agents-server)
- No more race conditions with fast automations
- No more "stuck in IDLE" issues from lost events
- `feedOutput` now correctly shows agent as RUNNING while processing

---

## Additional Fixes (December 2024)

### Issue: feedOutput not showing agent as RUNNING

**Problem:**
- When feedOutput called `processMessage()`, the agent stayed in IDLE even though Claude was processing
- The "output added to context" chat event was only created for `finished` automations, not `failed` ones

**Fixes:**
1. **`claude-agent.service.ts`**: In IDLE state, if `!isReady` (Claude is processing), transition to RUNNING. This is the single source of truth - `claudeReadyForPrompt` indicates whether Claude is busy.
2. **`executeAutomations.ts`**: feedOutput now calls `abortProcessing()` before `processMessage()` to interrupt agent if currently working, then feed output.
3. **`agent.service.ts`**: Synthetic `automation_output_added` event now created for both `finished` AND `failed` automations with feedOutput enabled.
