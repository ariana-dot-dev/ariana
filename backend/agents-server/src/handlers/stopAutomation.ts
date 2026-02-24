import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { automationService } from '../automationService';
import { addPendingAutomationEvent } from '../automationEventReporter';

const app = new Hono();

interface StopAutomationRequest {
  automationId: string;
}

/**
 * Endpoint to stop a specific running automation by ID.
 * Kills the running process and reports a 'failed' event.
 */
app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<StopAutomationRequest>(body);

    if (!valid || !data) {
        console.log('Invalid data in ' + c.req.path, "\nerror: ", error);
        return c.json({ error }, 400);
    }

    const { automationId } = data;

    if (!automationId) {
        return c.json({ error: 'Missing automationId' }, 400);
    }

    try {
        console.log(`[STOP-AUTOMATION] Received request to stop automation: ${automationId}`);

        const result = automationService.killAutomation(automationId);

        if (result.killed) {
            // Report a failed event preserving the logs accumulated while it was running
            const allAutomations = automationService.getAutomations();
            const automation = allAutomations.find(a => a.id === automationId);

            // Append a note that the automation was stopped, keeping existing output
            const stoppedNote = '\n[Stopped by user]';
            const output = result.output
                ? result.output + stoppedNote
                : 'Automation stopped by user.';

            addPendingAutomationEvent({
                automationId,
                automationName: automation?.name || 'Unknown',
                trigger: JSON.stringify({ type: 'manual', context: {}, timestamp: Date.now() }),
                output,
                isStartTruncated: result.isStartTruncated,
                status: 'failed',
                exitCode: 137, // SIGTERM exit code convention
                blocking: automation?.blocking ?? false,
                feedOutput: false,
            });
        }

        const response = {
            success: true,
            killed: result.killed,
            message: result.killed ? 'Automation stopped successfully' : 'Automation was not running'
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    } catch (error) {
        console.error('[STOP-AUTOMATION] Failed to stop automation:', error);
        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse }, 500);
    }
});

export default app;
