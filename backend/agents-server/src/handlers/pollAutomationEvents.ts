import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { getPendingAutomationEvents } from '../automationEventReporter';
import { automationService } from '../automationService';

const app = new Hono();

interface PollRequest {
    agentId: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<PollRequest>(body);

    if (!valid) {
        console.error('[PollAutomationEvents] Invalid data:', error);
        return c.json({ error }, 400);
    }

    const events = getPendingAutomationEvents();
    const runningOutputs = automationService.getAllRunningAutomationsOutput();

    // Add agentId to each event (backend needs it to know which agent these belong to)
    const eventsWithAgentId = events.map(e => ({
        ...e,
        agentId: data!.agentId,
        taskId: null
    }));

    const response = {
        success: true,
        events: eventsWithAgentId,
        runningOutputs  // Include live output from running automations
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
});

export default app;
