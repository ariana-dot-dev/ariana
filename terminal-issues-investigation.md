# Terminal Issues Investigation Report

## Issues Identified

### Issue 1: Terminal Freezing and Agent Stuck
- **Symptom**: After extended use, terminal stops receiving updates, agent doesn't complete tasks, timeout mechanisms fail
- **Frequency**: Intermittent, depends on Claude Code screen refresh patterns

### Issue 2: Missing Lines and No Auto-Scroll on Canvas Switch
- **Symptom**: When switching back to a canvas, terminal doesn't auto-scroll to bottom, some lines appear missing
- **Frequency**: Consistent on canvas switches

## Root Cause Analysis

### Issue 1: Event Queue Processing Deadlock

**Primary Theory: Exception in Event Processing**
- **Location**: `ClaudeCodeAgent.ts:283-300` in `processEventQueue()`
- **Mechanism**: 
  1. Claude Code generates rapid `screenUpdate` events during intensive operations
  2. If `handleTerminalEvents()` throws an exception before the `finally` block
  3. `isProcessingEvents` remains permanently `true`
  4. Future events are queued but never processed (line 284 early return)
  5. `lastActivityTime` is never updated (line 330)
  6. Completion timeout never triggers because events aren't processed
  7. Agent becomes permanently stuck

**Supporting Evidence**:
```typescript
// Line 284: Early return prevents processing if already processing
if (this.isProcessingEvents || this.eventQueue.length === 0) {
    return;
}

// Line 330: lastActivityTime only updated during event processing
this.lastActivityTime = Date.now();
this.resetCompletionTimeout();
```

**Secondary Theory: Race Condition in Task Completion**
- **Location**: `handleTaskCompletion:464-468`
- **Issue**: Queue draining logic only checks queue length, not active processing state
- **Result**: Task completion sequence may start while events are still being processed

### Issue 2: Patch-Based Updates Don't Trigger Auto-Scroll

**Primary Theory: Incomplete Auto-Scroll Logic**
- **Location**: `CustomTerminalRenderer.tsx:286-288`
- **Current Logic**: Only scrolls when screen length changes
```typescript
if (newScreen.length != oldScreen.length) {
    scrollDown();
}
```
- **Problem**: Claude Code frequently uses `patch` events to update existing lines
- **Result**: Auto-scroll only triggers on `newLines`, not `patch` events

**Secondary Theory: Incomplete State Restoration**
- **Location**: `TerminalConnectionManager` class
- **Missing**: Scroll position is not persisted or restored
- **Result**: Terminal restores to top position instead of bottom

**Tertiary Theory: Virtualized Rendering Gaps**
- **Location**: Custom terminal renderer with "chunks of 10 lines"
- **Issue**: Off-screen content may not be properly restored from persisted state
- **Result**: Manual scrolling reveals missing chunks

## Event Flow Analysis

### Normal Terminal Event Processing
1. Rust terminal emits events: `screenUpdate`, `newLines`, `patch`, `cursorMove`
2. `CustomTerminalAPI.onTerminalEvent()` receives events
3. `ClaudeCodeAgent.queueEventBatch()` queues events
4. `ClaudeCodeAgent.processEventQueue()` processes events sequentially
5. `handleTerminalEvents()` updates screen state and emits to UI
6. `CustomTerminalRenderer.handleTerminalEvent()` updates React state
7. Auto-scroll triggers if conditions are met

### Failure Points
- **Step 4**: Exception can leave `isProcessingEvents = true` permanently
- **Step 7**: Auto-scroll conditions too restrictive for `patch` events

## Terminal Event Types Analysis

### `screenUpdate` Events
- **Purpose**: Complete screen refresh
- **Frequency**: High during Claude Code operations
- **Contains**: Full screen content, cursor position
- **Auto-scroll**: Should trigger (screen length often changes)

### `newLines` Events  
- **Purpose**: Append new lines to screen
- **Frequency**: Medium
- **Contains**: Array of new line content
- **Auto-scroll**: Currently triggers (increases screen length)

### `patch` Events
- **Purpose**: Update existing lines in-place
- **Frequency**: Very high during Claude Code operations
- **Contains**: Line index and new content
- **Auto-scroll**: Currently doesn't trigger (screen length unchanged)

### `cursorMove` Events
- **Purpose**: Update cursor position
- **Frequency**: Very high
- **Contains**: New cursor line/column
- **Auto-scroll**: Currently doesn't trigger

## Code Locations

### ClaudeCodeAgent.ts
- **Event Processing**: Lines 283-300, 302-340
- **Completion Logic**: Lines 435-551
- **Cleanup**: Lines 228-261

### CustomTerminalRenderer.tsx
- **Event Handling**: Lines 254-308
- **Auto-scroll**: Lines 242-252, 286-288
- **State Persistence**: Lines 88-125

### custom_terminal.rs
- **Event Generation**: Lines 140-304
- **Diff Algorithm**: Lines 188-264

## Recommended Solutions

### Issue 1: Event Queue Deadlock
1. **Add comprehensive error handling** around `handleTerminalEvents()`
2. **Implement processing state timeout** to recover from stuck states
3. **Add queue processing metrics** for monitoring
4. **Improve task completion race condition** handling

### Issue 2: Auto-Scroll and State Restoration
1. **Expand auto-scroll triggers** to include `patch` events with cursor movement
2. **Add scroll position persistence** to `TerminalConnectionManager`
3. **Implement smart auto-scroll** that considers cursor position and user interaction
4. **Add bottom-scroll on terminal restoration**

## Impact Assessment

### Issue 1 Impact
- **Severity**: High - Breaks core functionality
- **User Experience**: Agent becomes unresponsive, requires manual intervention
- **Workaround**: Restart terminal/agent

### Issue 2 Impact  
- **Severity**: Medium - Degrades user experience
- **User Experience**: Missed output, manual scrolling required
- **Workaround**: Manual scroll to bottom

## Testing Strategy

### Issue 1 Testing
- Stress test with rapid Claude Code operations
- Monitor event queue metrics
- Test exception scenarios in event processing

### Issue 2 Testing
- Test canvas switching during active Claude Code operations
- Verify auto-scroll behavior with different event types
- Test scroll position persistence across component lifecycles