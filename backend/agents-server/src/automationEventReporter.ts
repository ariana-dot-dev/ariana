/**
 * Module to report automation events back to the main backend
 * This will be called by the automation trigger handler to save events to the database
 */

import { registerAutomationEventCallback } from './automationTriggerHandler';

interface AutomationEventData {
    automationId: string;
    automationName: string;
    trigger: string;
    output: string | null;
    isStartTruncated: boolean;
    status: 'running' | 'finished' | 'failed';
    exitCode: number | null;
    blocking: boolean;
    feedOutput: boolean;
}

// Track events to be reported
const pendingEvents: AutomationEventData[] = [];

export function initializeAutomationEventReporter() {
    console.log(`[AutomationEventReporter] Initialized`);

    // Register callback to collect events
    registerAutomationEventCallback(async (event) => {
        // Store event for later retrieval via polling endpoint
        pendingEvents.push(event);

        console.log(`[AutomationEventReporter] Collected event: ${event.automationName} - ${event.status} (total pending: ${pendingEvents.length})`);
    });
}

// Get and clear pending events (called by polling endpoint)
export function getPendingAutomationEvents(): typeof pendingEvents {
    const events = [...pendingEvents];
    pendingEvents.length = 0;
    console.log(`[AutomationEventReporter] Returning ${events.length} pending events, clearing queue`);
    return events;
}

// Add a pending event directly (called by executeAutomations handler)
export function addPendingAutomationEvent(event: AutomationEventData): void {
    pendingEvents.push(event);
    console.log(`[AutomationEventReporter] Added event: ${event.automationName} - ${event.status} (total pending: ${pendingEvents.length})`);
}
