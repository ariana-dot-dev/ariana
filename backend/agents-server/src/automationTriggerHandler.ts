/**
 * DEPRECATED: This module is being phased out.
 *
 * All automation triggering logic has been moved to the backend.
 * The agents-server now only executes automations when told to via /execute-automations.
 *
 * This file is kept only for backward compatibility with automationEventReporter
 * which registers a callback to collect automation events.
 */

// Callback to report automation events to backend
export type AutomationEventCallback = (event: {
  automationId: string;
  automationName: string;
  trigger: string;
  output: string | null;
  isStartTruncated: boolean;
  status: 'running' | 'finished' | 'failed';
  exitCode: number | null;
  blocking: boolean;
  feedOutput: boolean;
}) => Promise<void>;

let eventCallback: AutomationEventCallback | null = null;

// Register callback for automation events (used by automationEventReporter)
export function registerAutomationEventCallback(callback: AutomationEventCallback) {
  eventCallback = callback;
}

// Get the registered callback (used internally)
export function getRegisteredEventCallback(): AutomationEventCallback | null {
  return eventCallback;
}
