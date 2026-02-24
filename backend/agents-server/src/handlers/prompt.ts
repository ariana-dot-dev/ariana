import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { processPromptWithGenerationTracking } from '../promptProcessor';
import { globalState } from '../agentsState';

const app = new Hono()

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{
        prompt: string;
        model?: 'opus' | 'sonnet' | 'haiku';
    }>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    const { prompt, model } = data!;

    if (!globalState.claudeService) {
        const encryptedResponse = encryption.encrypt({ success: false, error: 'Claude service not initialized' });
        return c.json({ encrypted: encryptedResponse }, 500);
    }

    // Fire-and-forget: return immediately so the backend's poll loop isn't blocked.
    // The backend polls /conversations and /claude-state for progress.
    processPromptWithGenerationTracking(
        prompt,
        model || 'sonnet',
        'prompt'
    ).catch(err => {
        console.error('[prompt] Background processing failed:', err);
    });

    const encryptedResponse = encryption.encrypt({ success: true });
    return c.json({ encrypted: encryptedResponse });
})

export default app;
