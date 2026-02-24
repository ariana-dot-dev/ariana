import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';

const app = new Hono();

interface AutomationEventReport {
    agentId: string;
    automationId: string;
    automationName: string;
    trigger: string;
    output: string | null;
    isStartTruncated: boolean;
    status: 'running' | 'finished' | 'failed';
    exitCode: number | null;
    taskId?: string | null;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<AutomationEventReport>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error);
        return c.json({ error }, 400);
    }

    console.log(`[AutomationEvent] Received event: ${data!.automationName} - ${data!.status}`);

    // This endpoint just receives the event - actual storage happens on backend
    // when it polls for events or receives them via this mechanism

    const response = {
        success: true
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
});

export default app;
