import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { runClaudeQuery } from '../claudeService';
import { spawn } from 'child_process';

const app = new Hono();

interface GenerateBranchNameRequest {
    agentId: string;
    conversationMessages: any[];
}

interface GenerateBranchNameResult {
    success: boolean;
    branchName?: string;
    error?: string;
}

app.post('/', async (c) => {
    console.log('[GenerateBranchName] Request received');
    const body = await c.req.json();

    const { valid, data, error } = await encryption.decryptAndValidate<GenerateBranchNameRequest>(body);

    if (!valid) {
        console.error('[GenerateBranchName] Invalid encrypted data:', error);
        return c.json({ error }, 400);
    }

    console.log(`[GenerateBranchName] Decrypted request for agent ${data!.agentId}, ${data!.conversationMessages.length} messages`);

    if (!globalState.projectDir) {
        console.error('[GenerateBranchName] Project directory not set');
        const response: GenerateBranchNameResult = { success: false, error: 'Project directory not set' };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Extract user prompts from conversation
    const conversationSummary = data!.conversationMessages && data!.conversationMessages.length > 0
        ? data!.conversationMessages.map((msg: any, idx: number) =>
            `${idx + 1}. ${msg.timestamp ? new Date(msg.timestamp).toISOString() : ''} - User: ${msg.prompt || msg.content}`
          ).join('\n')
        : 'No user conversation available';

    // Retry up to 5 times
    for (let attempt = 1; attempt <= 5; attempt++) {
        console.log(`[GenerateBranchName] Attempt ${attempt}/5`);

        try {
            // Craft prompt for Claude Haiku
            const prompt = `Generate a git branch name based on the user's conversation:

## User Conversation:
${conversationSummary}

Respond with a single git branch name that follows these rules:
- Use kebab-case (lowercase with hyphens)
- Be descriptive but concise (2-5 words max)
- Focus on the main feature or change
- No special characters except hyphens
- Max 50 characters

Example good branch names:
- "add-user-authentication"
- "fix-memory-leak"
- "refactor-database-queries"
- "update-api-docs"

Respond with ONLY the branch name, nothing else.`;

            console.log(`[GenerateBranchName] Prompt:\n${prompt}`);

            // Use shared Claude SDK function with Haiku model
            const abortController = new AbortController();

            let completed = false;
            let messageCount = 0;
            let assistantResponse = '';

            console.log(`[GenerateBranchName] Starting Claude query iteration...`);
            for await (const message of runClaudeQuery(prompt, 'haiku', {
                continue: false,  // Fresh conversation (isolated by different cwd)
                cwd: globalState.projectDir,  // Different cwd = different conversation
                abortController
            })) {
                messageCount++;
                console.log(`[GenerateBranchName] Received message ${messageCount}, type: ${message.type}`);

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
                    console.log(`[GenerateBranchName] Received 'result' message, completing`);
                    break;
                }
            }
            console.log(`[GenerateBranchName] Claude query iteration finished. Completed: ${completed}, Messages: ${messageCount}`);

            if (!completed) {
                console.log(`[GenerateBranchName] Attempt ${attempt} - Processing did not complete`);
                continue;
            }

            // Check if the response contains an API error
            const lowerResponse = assistantResponse.toLowerCase();
            if (lowerResponse.includes('api error') || lowerResponse.includes('"type":"error"') || lowerResponse.includes('error:')) {
                console.log(`[GenerateBranchName] Attempt ${attempt} - Detected API error in response`);
                console.log(`[GenerateBranchName] Response was: ${assistantResponse.substring(0, 500)}...`);
                continue; // Skip this attempt and retry
            }

            // Check if the response is a refusal/clarification request rather than a branch name
            const refusalPatterns = [
                'i need more context',
                'i need additional context',
                'could you describe',
                'could you provide',
                'can you tell me',
                'what feature',
                'what change',
                'more information',
                'please provide',
                'i cannot generate',
                'i\'m unable to',
                'doesn\'t indicate',
                'not enough information',
                'unclear what'
            ];
            if (refusalPatterns.some(pattern => lowerResponse.includes(pattern))) {
                console.log(`[GenerateBranchName] Attempt ${attempt} - Detected refusal/clarification response`);
                console.log(`[GenerateBranchName] Response was: ${assistantResponse.substring(0, 200)}...`);
                continue;
            }

            // Clean up the response - take the first line, trim, and sanitize
            let branchName = assistantResponse.trim().split('\n')[0].substring(0, 50);
            // Remove any quotes or special characters
            branchName = branchName.replace(/[^a-z0-9-]/g, '');

            // Validate branch name looks reasonable - shouldn't have excessively long segments
            const longestSegment = branchName.split('-').reduce((max, seg) => Math.max(max, seg.length), 0);
            if (longestSegment > 25) {
                console.log(`[GenerateBranchName] Attempt ${attempt} - Branch name has suspicious segment length: ${longestSegment}`);
                console.log(`[GenerateBranchName] Generated: ${branchName}`);
                continue;
            }

            if (branchName && branchName.length > 0) {
                const response: GenerateBranchNameResult = {
                    success: true,
                    branchName: branchName
                };

                console.log(`[GenerateBranchName] Successfully generated branch name on attempt ${attempt}`);
                console.log(`[GenerateBranchName] Branch name: ${branchName}`);
                const encryptedResponse = encryption.encrypt(response);
                return c.json({ encrypted: encryptedResponse });
            } else {
                console.log(`[GenerateBranchName] Attempt ${attempt} - Empty response`);
                console.log(`[GenerateBranchName] Response was: ${assistantResponse.substring(0, 500)}...`);
            }

        } catch (error) {
            console.error(`[GenerateBranchName] Attempt ${attempt} error:`, error);
            if (error instanceof Error) {
                console.error(`[GenerateBranchName] Error message: ${error.message}`);
                console.error(`[GenerateBranchName] Error stack: ${error.stack}`);
            }
        }
    }

    // All attempts failed
    const response: GenerateBranchNameResult = {
        success: false,
        error: 'Failed to generate branch name after 5 attempts'
    };
    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
});

export default app;
