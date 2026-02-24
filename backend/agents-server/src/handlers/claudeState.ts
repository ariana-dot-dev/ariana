import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { automationService } from '../automationService';

interface ContextUsage {
    usedPercent: number;
    remainingPercent: number;
    totalTokens: number;
}

interface ClaudeStateResponse {
    isReady: boolean;
    hasBlockingAutomation: boolean;
    blockingAutomationIds: string[];
    contextUsage: ContextUsage | null;
}

const app = new Hono()

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.error('[claudeState] Invalid data:', error);
        return c.json({ error }, 400);
    }

    const isClaudeProcessing = globalState.claudeService
        ? await globalState.claudeService.isProcessing()
        : false;

    const isReady = globalState.claudeReadyForPrompt ||
        (globalState.claudeService !== null && !isClaudeProcessing);

    // Get context usage if claude service is available
    const contextUsage = globalState.claudeService?.getContextUsage() || null;

    const response: ClaudeStateResponse = {
        isReady,
        hasBlockingAutomation: automationService.hasBlockingAutomationRunning(),
        blockingAutomationIds: automationService.getRunningBlockingAutomationIds(),
        contextUsage
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;
