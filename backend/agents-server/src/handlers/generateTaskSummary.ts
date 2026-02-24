import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { runClaudeQuery } from '../claudeService';

const app = new Hono();

interface GenerateTaskSummaryRequest {
    agentId: string;
    currentPrompt: string;
    recentPrompts?: string[]; // Optional: previous prompts for context
}

interface GenerateTaskSummaryResult {
    success: boolean;
    taskSummary?: string;
    error?: string;
}

app.post('/', async (c) => {
    console.log('[GenerateTaskSummary] Request received');
    const body = await c.req.json();

    const { valid, data, error } = await encryption.decryptAndValidate<GenerateTaskSummaryRequest>(body);

    if (!valid) {
        console.error('[GenerateTaskSummary] Invalid encrypted data:', error);
        return c.json({ error }, 400);
    }

    console.log(`[GenerateTaskSummary] Decrypted request for agent ${data!.agentId}, prompt length: ${data!.currentPrompt.length}`);

    if (!globalState.projectDir) {
        console.error('[GenerateTaskSummary] Project directory not set');
        const response: GenerateTaskSummaryResult = { success: false, error: 'Project directory not set' };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Build context from prompts
    const currentPrompt = data!.currentPrompt;
    const recentPrompts = data!.recentPrompts || [];

    // Build prompt history context (if available)
    let promptHistory = '';
    if (recentPrompts.length > 0) {
        promptHistory = recentPrompts
            .slice(-3) // Last 3 prompts for context
            .map((p, i) => `${i + 1}. ${p.substring(0, 200)}${p.length > 200 ? '...' : ''}`)
            .join('\n');
        promptHistory = `\n## Previous prompts (for context):\n${promptHistory}\n`;
    }

    // Retry up to 3 times (fewer than commit name since this is less critical)
    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[GenerateTaskSummary] Attempt ${attempt}/3`);

        try {
            // Extract beginning and end of prompt (non-overlapping)
            let promptContent: string;
            if (currentPrompt.length <= 4000) {
                // Short enough to include entirely
                promptContent = currentPrompt;
            } else {
                // Take first 2000 and last 2000 chars (non-overlapping)
                const beginning = currentPrompt.substring(0, 2000);
                const end = currentPrompt.substring(currentPrompt.length - 2000);
                promptContent = `${beginning}\n\n[...middle truncated...]\n\n${end}`;
            }

            // Craft prompt for Claude Haiku
            const prompt = `Generate a very concise task summary (max 50 chars) based on what the user is asking for.

## Current user prompt:
${promptContent}
${promptHistory}
Rules:
- Maximum 50 characters
- Format: "<Topic>: <noun phrase>" - topic first (1-2 words), then noun-form action
- Use noun forms (e.g., "addition", "fix", "implementation", "refactoring")
- Focus on the user's intent, not implementation details
- Be specific but concise
- No period at the end

Example good summaries:
- "Auth: JWT validation addition"
- "Dark mode: toggle implementation"
- "API: handlers refactoring"
- "Docker: config setup"
- "Tests: failures debugging"
- "Login: validation bug fix"

Respond with ONLY the summary, nothing else.`;

            console.log(`[GenerateTaskSummary] Prompt length: ${prompt.length}`);

            // Use shared Claude SDK function with Haiku model
            const abortController = new AbortController();

            let completed = false;
            let messageCount = 0;
            let assistantResponse = '';

            console.log(`[GenerateTaskSummary] Starting Claude query iteration...`);
            for await (const message of runClaudeQuery(prompt, 'haiku', {
                continue: false,
                cwd: globalState.projectDir,
                abortController
            })) {
                messageCount++;
                console.log(`[GenerateTaskSummary] Received message ${messageCount}, type: ${message.type}`);

                // Capture assistant's text response
                if (message.type === 'assistant' && message.message?.content) {
                    for (const content of message.message.content) {
                        if (content.type === 'text') {
                            assistantResponse += content.text;
                        }
                    }
                }

                if (message.type === 'result') {
                    completed = true;
                    console.log(`[GenerateTaskSummary] Received 'result' message, completing`);
                    break;
                }
            }
            console.log(`[GenerateTaskSummary] Claude query iteration finished. Completed: ${completed}, Messages: ${messageCount}`);

            if (!completed) {
                console.log(`[GenerateTaskSummary] Attempt ${attempt} - Processing did not complete`);
                continue;
            }

            // Check if the response contains an API error
            const lowerResponse = assistantResponse.toLowerCase();
            if (lowerResponse.includes('api error') || lowerResponse.includes('"type":"error"') || lowerResponse.includes('error:')) {
                console.log(`[GenerateTaskSummary] Attempt ${attempt} - Detected API error in response`);
                console.log(`[GenerateTaskSummary] Response was: ${assistantResponse.substring(0, 500)}...`);
                continue;
            }

            // Clean up the response - take the first line and trim to 50 chars
            const taskSummary = assistantResponse.trim().split('\n')[0].substring(0, 50);

            if (taskSummary && taskSummary.length > 0) {
                const response: GenerateTaskSummaryResult = {
                    success: true,
                    taskSummary: taskSummary
                };

                console.log(`[GenerateTaskSummary] Successfully generated task summary on attempt ${attempt}`);
                console.log(`[GenerateTaskSummary] Task summary: ${taskSummary}`);
                const encryptedResponse = encryption.encrypt(response);
                return c.json({ encrypted: encryptedResponse });
            } else {
                console.log(`[GenerateTaskSummary] Attempt ${attempt} - Empty response`);
                console.log(`[GenerateTaskSummary] Response was: ${assistantResponse.substring(0, 500)}...`);
            }

        } catch (error) {
            console.error(`[GenerateTaskSummary] Attempt ${attempt} error:`, error);
            if (error instanceof Error) {
                console.error(`[GenerateTaskSummary] Error message: ${error.message}`);
                console.error(`[GenerateTaskSummary] Error stack: ${error.stack}`);
            }
        }
    }

    // All attempts failed - return error, no fallback
    console.error('[GenerateTaskSummary] FAILED to generate task summary after 3 attempts - no fallback, returning error');

    const response: GenerateTaskSummaryResult = {
        success: false,
        error: 'Failed to generate task summary after 3 attempts'
    };
    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
});

export default app;
