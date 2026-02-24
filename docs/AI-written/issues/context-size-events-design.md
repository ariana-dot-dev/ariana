# Context Size Events - Design Document

## Overview

This document outlines the implementation plan for "context size events" that inform users about context window usage and automatic compaction status.

## Event Types to Implement

### 1. Context Warning Event
- **Trigger**: Every 10% decrease in remaining context (90%, 80%, 70%, etc.)
- **Display**: "X% context remaining before compaction"
- **UI**: Simple status line (similar to ResetEvent)

### 2. Compaction Start Event
- **Trigger**: When automatic compaction is triggered
- **Display**: "Automatic compaction triggered, please wait..."
- **UI**: Shows spinner while in progress

### 3. Compaction Complete Event
- **Trigger**: When compaction finishes
- **Display**: "Compaction completed" with expandable summary
- **UI**: Clickable to reveal compaction summary text (like AutomationEventItem)

---

## Current Dataflow Summary

```
┌─────────────────────────────────────────────────────────────┐
│ ANTHROPIC CLAUDE SDK                                        │
│   SDKAssistantMessage.message.usage:                        │
│     - input_tokens                                          │
│     - cache_creation_input_tokens                           │
│     - cache_read_input_tokens                               │
│     - output_tokens                                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ AGENTS-SERVER (claudeService.ts)                            │
│   - Stores messages in Map<UUID, SDKMessage>                │
│   - processMessage() → runClaudeQuery() → yields messages   │
│   - Each assistant message has usage field                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ BACKEND (agent.service.ts)                                  │
│   - Polls /claudeState for readiness                        │
│   - Polls /messages for new messages                        │
│   - Stores in AgentMessage table                            │
│   - getAgentChatEvents() assembles from multiple tables     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ FRONTEND (useAgentEventsStore.ts)                           │
│   - Polls GET /api/agents/{id}/events every 1 second        │
│   - Event.tsx routes to component by event.type             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Type Definitions

**File: `backend/shared/types/api/chat-event.types.ts`**

Add three new event types:

```typescript
// Context warning event - shown at 10% thresholds
export interface ContextWarningEvent extends BaseEvent {
  type: 'context_warning';
  taskId: string | null;
  data: {
    contextUsedPercent: number;      // e.g., 70 means 70% used
    contextRemainingPercent: number; // e.g., 30 means 30% remaining
    inputTokens: number;
    cacheTokens: number;
    contextWindow: number;           // e.g., 200000
  };
}

// Compaction start event
export interface CompactionStartEvent extends BaseEvent {
  type: 'compaction_start';
  taskId: string | null;
  data: {
    triggerReason: 'threshold_exceeded' | 'manual';
    contextUsedPercent: number;
  };
}

// Compaction complete event
export interface CompactionCompleteEvent extends BaseEvent {
  type: 'compaction_complete';
  taskId: string | null;
  data: {
    summary: string;                 // The compaction summary text
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
  };
}

// Update ChatEvent union
export type ChatEvent =
  | PromptEvent
  | ResponseEvent
  | GitCheckpointEvent
  | ResetEvent
  | AutomationEvent
  | AutomationOutputAddedEvent
  | ContextWarningEvent
  | CompactionStartEvent
  | CompactionCompleteEvent;

// Type guards
export function isContextWarningEvent(event: ChatEvent): event is ContextWarningEvent {
  return event.type === 'context_warning';
}

export function isCompactionStartEvent(event: ChatEvent): event is CompactionStartEvent {
  return event.type === 'compaction_start';
}

export function isCompactionCompleteEvent(event: ChatEvent): event is CompactionCompleteEvent {
  return event.type === 'compaction_complete';
}
```

### Phase 2: Database Model

**File: `backend/prisma/schema.prisma`**

Add a new model to store context events:

```prisma
model AgentContextEvent {
  id                    String       @id
  agentId               String
  taskId                String?
  type                  String       // 'context_warning' | 'compaction_start' | 'compaction_complete'
  contextUsedPercent    Int?
  contextRemainingPercent Int?
  inputTokens           Int?
  cacheTokens           Int?
  contextWindow         Int?
  summary               String?      // For compaction_complete
  tokensBefore          Int?
  tokensAfter           Int?
  tokensSaved           Int?
  triggerReason         String?      // For compaction_start
  createdAt             DateTime?
  task                  AgentPrompt? @relation(fields: [taskId], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@index([agentId])
  @@index([createdAt])
  @@index([taskId])
}
```

### Phase 3: Agents-Server Token Tracking

**File: `backend/agents-server/src/claudeService.ts`**

Add context tracking to ClaudeService:

```typescript
export class ClaudeService {
    // ... existing fields ...

    // Context tracking
    private lastContextPercent: number = 0;
    private contextWindow: number = 200000; // Default, will be updated from SDK
    private lastEmittedThreshold: number = 100; // Track which threshold we last emitted

    // Context event callbacks
    private onContextWarning?: (percent: number, usage: TokenUsage) => void;
    private onCompactionStart?: (reason: string, percent: number) => void;
    private onCompactionComplete?: (summary: string, before: number, after: number) => void;

    setContextCallbacks(callbacks: {
        onContextWarning?: (percent: number, usage: TokenUsage) => void;
        onCompactionStart?: (reason: string, percent: number) => void;
        onCompactionComplete?: (summary: string, before: number, after: number) => void;
    }) {
        this.onContextWarning = callbacks.onContextWarning;
        this.onCompactionStart = callbacks.onCompactionStart;
        this.onCompactionComplete = callbacks.onCompactionComplete;
    }

    private checkContextThreshold(usage: {
        input_tokens: number;
        cache_creation_input_tokens: number;
        cache_read_input_tokens: number;
    }) {
        const totalContext = usage.input_tokens +
                            usage.cache_creation_input_tokens +
                            usage.cache_read_input_tokens;

        const usedPercent = Math.round((totalContext / this.contextWindow) * 100);
        const remainingPercent = 100 - usedPercent;

        // Check if we crossed a 10% threshold
        const currentThreshold = Math.floor(remainingPercent / 10) * 10;

        if (currentThreshold < this.lastEmittedThreshold && this.onContextWarning) {
            this.onContextWarning(remainingPercent, {
                inputTokens: usage.input_tokens,
                cacheTokens: usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
                contextWindow: this.contextWindow
            });
            this.lastEmittedThreshold = currentThreshold;
        }

        this.lastContextPercent = usedPercent;
    }
}
```

In `processMessage()`, after receiving an assistant message:

```typescript
// After storing assistant message
if (msg.type === 'assistant' && msg.message?.usage) {
    this.checkContextThreshold(msg.message.usage);
}
```

### Phase 4: Backend Event Storage

**File: `backend/src/data/repositories/agentContextEvent.repository.ts`**

```typescript
import { PrismaClient, AgentContextEvent, Prisma } from '../../../generated/prisma';

export class AgentContextEventRepository {
  constructor(private prisma: PrismaClient) {}

  async createContextWarning(data: {
    id: string;
    agentId: string;
    taskId: string | null;
    contextUsedPercent: number;
    contextRemainingPercent: number;
    inputTokens: number;
    cacheTokens: number;
    contextWindow: number;
  }): Promise<AgentContextEvent> {
    return this.prisma.agentContextEvent.create({
      data: {
        ...data,
        type: 'context_warning',
        createdAt: new Date()
      }
    });
  }

  async createCompactionStart(data: {
    id: string;
    agentId: string;
    taskId: string | null;
    contextUsedPercent: number;
    triggerReason: string;
  }): Promise<AgentContextEvent> {
    return this.prisma.agentContextEvent.create({
      data: {
        ...data,
        type: 'compaction_start',
        createdAt: new Date()
      }
    });
  }

  async createCompactionComplete(data: {
    id: string;
    agentId: string;
    taskId: string | null;
    summary: string;
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
  }): Promise<AgentContextEvent> {
    return this.prisma.agentContextEvent.create({
      data: {
        ...data,
        type: 'compaction_complete',
        createdAt: new Date()
      }
    });
  }

  async getAgentContextEvents(agentId: string): Promise<AgentContextEvent[]> {
    return this.prisma.agentContextEvent.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' }
    });
  }
}
```

### Phase 5: Backend Event Assembly

**File: `backend/src/services/agent.service.ts`**

Add to `getAgentChatEvents()`:

```typescript
// Add context events
const contextEvents = await this.repositories.agentContextEvents.getAgentContextEvents(agentId);
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
        tokensAfter: ctxEvent.tokensAfter!,
        tokensSaved: ctxEvent.tokensSaved!
      }
    };
    events.push(completeEvent);
  }
}
```

### Phase 6: Frontend Components

**File: `frontend/src/components/agent-chat/ContextEvent.tsx`**

```typescript
import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ContextWarningEvent, CompactionStartEvent, CompactionCompleteEvent } from '@shared/types/api/chat-event.types';

const formatTimestamp = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString();
};

// Context Warning Component
export function ContextWarning({ event }: { event: ContextWarningEvent }) {
  const { data } = event;
  const isLow = data.contextRemainingPercent <= 20;

  return (
    <div className="flex flex-col gap-0 items-center">
      <div className="flex justify-center select-none">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className={cn(
                "px-2 py-1 w-fit h-auto text-xs rounded-md transition-opacity flex items-center gap-1",
                isLow ? "text-amber-500 opacity-90" : "text-muted-foreground opacity-70 hover:opacity-100"
              )}>
                {data.contextRemainingPercent < 30 && (<AlertTriangle className="h-3 w-3" />)}
                {data.contextRemainingPercent}% context remaining • {formatTimestamp(event.timestamp)}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Context window: {data.inputTokens.toLocaleString()} input + {data.cacheTokens.toLocaleString()} cache tokens</p>
              <p>Total capacity: {data.contextWindow.toLocaleString()} tokens</p>
              <p className="mt-1 text-muted-foreground">Automatic compaction will trigger when context is low.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

// Compaction Start Component
export function CompactionStart({ event }: { event: CompactionStartEvent }) {
  return (
    <div className="flex flex-col gap-0 items-center">
      <div className="flex justify-center select-none">
        <div className="px-3 py-1.5 w-fit h-auto text-xs rounded-md bg-accent/20 text-accent flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Automatic compaction triggered ({event.data.contextUsedPercent}% context used), please wait...
        </div>
      </div>
    </div>
  );
}

// Compaction Complete Component
export function CompactionComplete({ event }: { event: CompactionCompleteEvent }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data } = event;

  return (
    <div className="flex flex-col gap-0 w-full md:pl-7 md:pr-9 px-3 my-2">
      <div
        className={cn(
          "flex items-center text-sm gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors",
          "dark:bg-emerald-950/30 bg-emerald-50 dark:hover:bg-emerald-950/50 hover:bg-emerald-100",
          isExpanded && "rounded-b-none"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="opacity-50">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-emerald-600" />
          ) : (
            <ChevronRight className="h-4 w-4 text-emerald-600" />
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <CheckCircle className="h-4 w-4 text-emerald-600" />
          <span className="text-emerald-700 dark:text-emerald-400">Compaction completed</span>
          <span className="text-xs text-muted-foreground">
            ({data.tokensSaved.toLocaleString()} tokens saved)
          </span>
          <span className="text-xs opacity-50">
            • {formatTimestamp(event.timestamp)}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="dark:bg-emerald-950/20 bg-emerald-50/50 rounded-b-lg px-4 py-3 border-t border-emerald-200 dark:border-emerald-900">
          <div className="text-xs text-muted-foreground mb-2">
            Tokens: {data.tokensBefore.toLocaleString()} → {data.tokensAfter.toLocaleString()}
          </div>
          <div className="text-sm whitespace-pre-wrap font-mono bg-background/50 p-3 rounded-md max-h-96 overflow-y-auto">
            {data.summary}
          </div>
        </div>
      )}
    </div>
  );
}
```

**File: `frontend/src/components/agent-chat/Event.tsx`**

Add to imports and rendering:

```typescript
import { ContextWarning, CompactionStart, CompactionComplete } from './ContextEvent';

// In the component:
{event.type === 'context_warning' && (
    <ContextWarning event={event} />
)}

{event.type === 'compaction_start' && (
    <CompactionStart event={event} />
)}

{event.type === 'compaction_complete' && (
    <CompactionComplete event={event} />
)}
```

---

## Key Implementation Considerations

### 1. Token Calculation Formula

Based on Anthropic's documentation:
```typescript
const totalContext = input_tokens + cache_creation_input_tokens + cache_read_input_tokens;
const usedPercent = Math.round((totalContext / contextWindow) * 100);
```

Use the **last assistant message's usage** (not cumulative resultMsg.usage).

### 2. Context Window Sizes by Model

- Claude Opus 4.5: 200,000 tokens
- Claude Sonnet 4.5: 200,000 tokens
- Claude Haiku 4.5: 200,000 tokens

The context window can be obtained from `modelUsage` in the SDK result message.

### 3. Threshold Emission Logic

Only emit warnings when crossing DOWN through a 10% boundary:
- 95% used → 90% remaining: Don't emit (above 90% threshold)
- 92% used → cross 90% boundary → emit "10% remaining"
- 85% used → don't emit (already emitted 10%)
- 82% used → cross 80% boundary → emit "20% remaining"

### 4. Automatic Compaction Integration

The SDK's `compaction_control` triggers compaction automatically. We need to:
1. Detect `SDKCompactBoundaryMessage` from SDK
2. Emit compaction_start event when detected
3. Capture the summary from the compaction response
4. Emit compaction_complete with the summary

### 5. Event Deduplication

Context warning events should be deduplicated by threshold level per task to avoid spam.

---

## Files to Modify

### Backend - Shared Types
- `backend/shared/types/api/chat-event.types.ts` - Add new event types

### Backend - Database
- `backend/prisma/schema.prisma` - Add AgentContextEvent model
- `backend/src/data/repositories/index.ts` - Add repository
- `backend/src/data/repositories/agentContextEvent.repository.ts` - Create new

### Backend - Services
- `backend/src/services/agent.service.ts` - Add context event assembly

### Agents-Server
- `backend/agents-server/src/claudeService.ts` - Add token tracking
- `backend/agents-server/src/index.ts` - Wire up context callbacks

### Frontend
- `frontend/src/components/agent-chat/ContextEvent.tsx` - Create new
- `frontend/src/components/agent-chat/Event.tsx` - Add routing

---

## Open Questions

1. **Should context warnings be persisted or synthetic?**
   - Persisting: More accurate history, survives page refresh
   - Synthetic: Simpler, no DB migration needed, but transient

2. **What threshold should trigger automatic compaction?**
   - Anthropic default: 100,000 tokens
   - Could be configurable per agent/project

3. **Should compaction be automatic or user-initiated?**
   - Current: User manually triggers via button (removed)
   - Proposed: Automatic via SDK's compaction_control

4. **How to handle server-side tools (web search) that inflate cache_read_input_tokens?**
   - May need to exclude certain cache tokens from calculation
   - Or use token counting endpoint for accurate measurement
