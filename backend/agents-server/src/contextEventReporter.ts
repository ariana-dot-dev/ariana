/**
 * Module to report context events (compaction) back to the main backend
 * This will be polled by the backend to save events to the database
 */

import type { CompactionCompleteEvent } from '../../shared/types/api/chat-event.types';

// Pending compaction events to be polled by backend
type PendingCompactionEvent = Omit<CompactionCompleteEvent, 'id' | 'timestamp'>;
const pendingCompactionEvents: PendingCompactionEvent[] = [];

/**
 * Add a compaction complete event to the queue.
 * Note: tokensAfter is null because the SDK's compact_boundary message only provides pre_tokens.
 */
export function addCompactionCompleteEvent(
    taskId: string | null,
    summary: string,
    tokensBefore: number
): void {
    const event: PendingCompactionEvent = {
        type: 'compaction_complete',
        taskId,
        data: {
            summary,
            tokensBefore,
            tokensAfter: null,   // SDK doesn't provide post-compaction token count
            tokensSaved: null    // Cannot calculate without tokensAfter
        }
    };
    pendingCompactionEvents.push(event);
    console.log(`[ContextEventReporter] Added compaction complete event (tokensBefore: ${tokensBefore})`);
}

/**
 * Get and clear pending compaction events (called by polling endpoint)
 */
export function getPendingContextEvents(): PendingCompactionEvent[] {
    const events = [...pendingCompactionEvents];
    pendingCompactionEvents.length = 0;
    if (events.length > 0) {
        console.log(`[ContextEventReporter] Returning ${events.length} pending events, clearing queue`);
    }
    return events;
}
