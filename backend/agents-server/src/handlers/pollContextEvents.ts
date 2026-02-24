import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { getPendingContextEvents } from '../contextEventReporter';

const app = new Hono();

interface PollRequest {
    agentId: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<PollRequest>(body);

    if (!valid) {
        console.error('[PollContextEvents] Invalid data:', error);
        return c.json({ error }, 400);
    }

    const events = getPendingContextEvents();

    // Add agentId to each event (backend needs it to know which agent these belong to)
    const eventsWithAgentId = events.map(e => ({
        ...e,
        agentId: data!.agentId
    }));

    const response = {
        success: true,
        events: eventsWithAgentId
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
});

export default app;
