/**
 * Queue system for automation-triggered actions that need to be executed by the backend
 * Automations can trigger stopAgent or queuePrompt by writing to files
 * This module tracks those actions and reports them via polling
 */

export type AutomationActionType = 'stop_agent' | 'queue_prompt';

export interface AutomationAction {
    id: string;
    type: AutomationActionType;
    automationId: string;
    automationName: string;
    timestamp: number;
    payload?: {
        promptText?: string;
    };
}

// Queue of pending actions to be polled by backend
const actionQueue: AutomationAction[] = [];
let actionIdCounter = 0;

/**
 * Add an action to the queue
 */
export function enqueueAction(action: Omit<AutomationAction, 'id' | 'timestamp'>): void {
    const fullAction: AutomationAction = {
        ...action,
        id: `action-${++actionIdCounter}-${Date.now()}`,
        timestamp: Date.now(),
    };

    actionQueue.push(fullAction);
    console.log(`[ActionQueue] Enqueued action: ${action.type} from automation ${action.automationName}`);
}

/**
 * Get all pending actions and clear the queue
 */
export function getPendingActions(): AutomationAction[] {
    const actions = [...actionQueue];
    actionQueue.length = 0;
    return actions;
}

/**
 * Get directory path where automations can write action files
 */
export function getActionFilesDir(): string {
    return '/tmp/ariana-automation-actions';
}
