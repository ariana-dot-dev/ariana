import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { automationService } from '../automationService';

const app = new Hono()

app.post('/', async (c) => {
    console.log('[interrupt] Interrupt requested');
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    if (!globalState.claudeService) {
        throw new Error('Claude service not initialized yet');
    }

    // Abort Claude processing
    globalState.claudeService.abortProcessing();

    // Kill all running automation processes and clear tracking
    // This ensures shell commands (npm test, builds, etc.) are actually stopped
    automationService.killAllRunningAutomations();

    // Increment generation to invalidate any in-flight prompt handlers.
    // This prevents the race condition where an old prompt handler finishes after
    // interrupt and overwrites the claudeReadyForPrompt state.
    const newGeneration = ++globalState.promptGeneration;

    // Mark as ready for new prompts
    globalState.claudeReadyForPrompt = true;

    console.log(`[interrupt] Interrupt completed - claudeReadyForPrompt: ${globalState.claudeReadyForPrompt}, generation: ${newGeneration}`);

    const response = {
        success: true
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;
