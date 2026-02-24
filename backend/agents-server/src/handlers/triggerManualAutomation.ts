import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { automationService } from '../automationService';
import { globalState } from '../agentsState';

const app = new Hono();

interface TriggerManualAutomationRequest {
  automationId: string;
  automationName: string;
  scriptLanguage: 'bash' | 'javascript' | 'python';
  scriptContent: string;
  blocking: boolean;
  feedOutput: boolean;
}

/**
 * DEPRECATED: This endpoint is kept for backward compatibility
 * Use /execute-automations instead which is the preferred way to trigger automations
 *
 * This endpoint just ensures the automation is loaded into the service
 * The actual execution should be triggered via /execute-automations
 */
app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<TriggerManualAutomationRequest>(body);

    if (!valid || !data) {
        console.log('Invalid data in ' + c.req.path, "\nerror: ", error);
        return c.json({ error }, 400);
    }

    const { automationId, automationName, scriptLanguage, scriptContent, blocking, feedOutput } = data;

    if (!automationId || !automationName || !scriptLanguage || !scriptContent) {
        return c.json({ error: 'Missing required fields' }, 400);
    }

    try {
        const projectDir = globalState.projectDir;
        if (!projectDir) {
            return c.json({ error: 'No project directory set' }, 400);
        }

        console.log(`[TRIGGER-MANUAL] DEPRECATED: Use /execute-automations instead`);
        console.log(`[TRIGGER-MANUAL] Received manual trigger request for automation "${automationName}" (${automationId})`);
        console.log(`[TRIGGER-MANUAL] Script language: ${scriptLanguage}, blocking: ${blocking}, feedOutput: ${feedOutput}`);

        // Create a temporary automation object and add it to automationService
        const automation = {
            id: automationId,
            name: automationName,
            scriptLanguage,
            scriptContent,
            blocking,
            feedOutput,
            trigger: { type: 'manual' as const }
        };

        // Add or update this automation in the service so it can be executed via /execute-automations
        const currentAutomations = globalState.automations || [];
        const existingIndex = currentAutomations.findIndex(a => a.id === automationId);

        if (existingIndex >= 0) {
            console.log(`[TRIGGER-MANUAL] Updating existing automation in service`);
            currentAutomations[existingIndex] = automation;
            globalState.automations = [...currentAutomations];
        } else {
            console.log(`[TRIGGER-MANUAL] Adding new automation to service`);
            globalState.automations = [...currentAutomations, automation];
        }
        automationService.loadAutomations(globalState.automations);

        // NOTE: Actual execution is now done via /execute-automations called by backend
        // This endpoint just ensures the automation config is loaded

        const response = {
            success: true,
            message: 'Automation config loaded. Use /execute-automations to run it.'
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    } catch (error) {
        console.error('[TRIGGER-MANUAL] Failed to load manual automation:', error);
        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse }, 500);
    }
});

export default app;
