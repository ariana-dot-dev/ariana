import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { getPendingActions } from '../automationActionQueue';
import { automationService } from '../automationService';

const app = new Hono();

/**
 * Endpoint to poll for automation-triggered actions (stopAgent, queuePrompt)
 * Backend calls this periodically to check if automations have triggered any actions
 */
app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nerror: ", error);
        return c.json({ error }, 400);
    }

    // Poll for action files written by automation scripts
    await automationService.pollActionFiles();

    // Get pending actions
    const actions = getPendingActions();

    const response = {
        success: true,
        actions
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
});

export default app;
