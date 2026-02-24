import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';

const app = new Hono()

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    if (!globalState.claudeService) {
        throw new Error('Claude service not initialized yet');
    }

    // Reset the conversation - moves all current messages to pastConversations
    globalState.claudeService.resetConversation();

    // NOTE: on_after_reset automations are now triggered by backend, not here

    const response = {
        success: true
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;
