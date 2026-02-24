# Interrupt Race Condition Fix

## Issue
The interrupt button in the frontend sometimes fails to properly stop the agent. Symptoms:
- Frontend shows agent in "Ready" state
- Agent keeps sending messages (Claude keeps processing)
- Queued prompts are not picked up

## Root Cause Analysis

Two main issues:

### 1. Race Condition Between Handlers
The interrupt mechanism had a race condition between the `/interrupt` and `/prompt` handlers.
Old prompt handlers would overwrite state flags after interrupt, causing concurrent processing.

### 2. AbortController Doesn't Actually Interrupt
The Claude Agent SDK's AbortController doesn't reliably stop processing. The SDK has a dedicated
`query.interrupt()` method that must be called for immediate interruption.

## Fixes Applied

### 1. Use SDK's `interrupt()` Method (THE KEY FIX)
**File**: `claudeService.ts`

The SDK's `query()` function returns a `Query` object with an `interrupt(): Promise<void>` method.
This is the proper way to immediately stop Claude - AbortController alone doesn't work reliably.

```typescript
// Store the Query object
this.currentQuery = query({ prompt, options });

// In abortProcessing():
if (this.currentQuery) {
    await this.currentQuery.interrupt(); // IMMEDIATE STOP
}
```

### 2. Generation Counter for Race Prevention
**Files**: `agentsState.ts`, `prompt.ts`, `interrupt.ts`

Added `promptGeneration` counter. When interrupt or new prompt happens, generation increments.
Stale handlers check generation before updating state and skip if changed.

### 3. Unified Prompt Processor
**File**: `promptProcessor.ts`

Created shared function `processPromptWithGenerationTracking()` used by both `prompt.ts` and
`executeAutomations.ts` to ensure consistent generation tracking everywhere.

### 4. Processing Synchronization
**File**: `claudeService.ts`

- Added `processingComplete` Promise that resolves when `processMessage()` truly finishes
- New `processMessage()` calls wait for previous processing to complete
- `abortProcessing()` no longer immediately resets `_isProcessing`

### 5. Faster Polling
**File**: `agent.service.ts`

Reduced polling interval from 3s to 1.5s for faster state updates.

## Files Modified
- `backend/agents-server/src/agentsState.ts` - Added `promptGeneration` counter
- `backend/agents-server/src/claudeService.ts` - Store Query object, use `interrupt()`, add sync
- `backend/agents-server/src/promptProcessor.ts` - NEW: Unified prompt processing
- `backend/agents-server/src/handlers/prompt.ts` - Use unified processor
- `backend/agents-server/src/handlers/interrupt.ts` - Increment generation, kill automations
- `backend/agents-server/src/handlers/executeAutomations.ts` - Use unified processor
- `backend/agents-server/src/automationService.ts` - Add `killAllRunningAutomations()`
- `backend/src/services/agent.service.ts` - Faster polling (3s -> 1.5s)
- `backend/src/services/claude-agent.service.ts` - Inline autonomous mode (no IDLE flash)

## Additional Fixes

### Autonomous Mode (Slop/Ralph) - No More "Ready" Flash
Previously, when Claude finished a task in autonomous mode, the agent would:
1. Transition to IDLE (frontend shows "Ready")
2. Fire-and-forget callback queues next prompt
3. Next poll sends prompt (frontend shows "Working")

Now, autonomous mode is checked BEFORE transitioning to IDLE:
1. Agent finishes task
2. Check if slop/ralph mode is active
3. If YES: send next prompt directly, stay in RUNNING (user NEVER sees "Ready")
4. If NO: transition to IDLE normally

### Interrupt Kills Automation Processes
Previously, interrupt only cleared the tracking flags but didn't kill running shell processes.
Now `killAllRunningAutomations()` sends SIGTERM to all running automation processes.

## Sources
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) - Documents `Query.interrupt()`
- [GitHub Issue #120](https://github.com/anthropics/claude-agent-sdk-typescript/issues/120) - V2 interrupt discussion
- [GitHub Issue #2970](https://github.com/anthropics/claude-code/issues/2970) - AbortController not respected bug
