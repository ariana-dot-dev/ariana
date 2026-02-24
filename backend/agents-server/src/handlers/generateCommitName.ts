import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { runClaudeQuery } from '../claudeService';
import { spawn } from 'child_process';

const app = new Hono();

interface GenerateCommitNameRequest {
    agentId: string;
    commitSha: string;
    conversationMessages: any[];
}

interface GenerateCommitNameResult {
    success: boolean;
    commitName?: string;
    error?: string;
}

app.post('/', async (c) => {
    console.log('[GenerateCommitName] Request received');
    const body = await c.req.json();

    const { valid, data, error } = await encryption.decryptAndValidate<GenerateCommitNameRequest>(body);

    if (!valid) {
        console.error('[GenerateCommitName] Invalid encrypted data:', error);
        return c.json({ error }, 400);
    }

    console.log(`[GenerateCommitName] Decrypted request for agent ${data!.agentId}, commit ${data!.commitSha}, ${data!.conversationMessages.length} messages`);

    if (!globalState.projectDir) {
        console.error('[GenerateCommitName] Project directory not set');
        const response: GenerateCommitNameResult = { success: false, error: 'Project directory not set' };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Get commit diff
    const diffProcess = spawn('git', ['diff', `${data!.commitSha}~1`, data!.commitSha], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let diffOutput = '';
    diffProcess.stdout?.on('data', (data) => {
        diffOutput += data.toString();
    });

    await new Promise<void>((resolve) => {
        diffProcess.on('exit', resolve);
    });

    // Extract user prompts from conversation
    const conversationSummary = data!.conversationMessages && data!.conversationMessages.length > 0
        ? data!.conversationMessages.map((msg: any, idx: number) =>
            `${idx + 1}. ${msg.timestamp ? new Date(msg.timestamp).toISOString() : ''} - User: ${msg.prompt || msg.content}`
          ).join('\n')
        : 'No user conversation available';

    // Retry up to 5 times
    for (let attempt = 1; attempt <= 5; attempt++) {
        console.log(`[GenerateCommitName] Attempt ${attempt}/5`);

        try {
            // Craft prompt for Claude Haiku
            const prompt = `Generate a concise commit message based on:

## User Conversation:
${conversationSummary}

## Commit Diff:
${diffOutput.substring(0, 10000)}${diffOutput.length > 10000 ? '\n...(truncated)' : ''}

Respond with a single-line commit message (max 72 characters) that summarizes what changed and why.

Rules:
- Use imperative mood (e.g., "Add feature" not "Added feature")
- Be specific and concise
- Focus on the "what" and "why"
- No period at the end
- Write from the user's perspective (first person)

Example good commit messages:
- "Add user authentication with JWT"
- "Fix memory leak in file watcher"
- "Refactor database queries for performance"
- "Update API docs with new endpoints"

Respond with ONLY the commit message, nothing else.`;

            console.log(`[GenerateCommitName] Prompt:\n${prompt}`);

            // Use shared Claude SDK function with Haiku model
            const abortController = new AbortController();

            let completed = false;
            let messageCount = 0;
            let assistantResponse = '';

            console.log(`[GenerateCommitName] Starting Claude query iteration...`);
            for await (const message of runClaudeQuery(prompt, 'haiku', {
                continue: false,  // Fresh conversation (isolated by different cwd)
                cwd: globalState.projectDir,  // Different cwd = different conversation
                abortController
            })) {
                messageCount++;
                console.log(`[GenerateCommitName] Received message ${messageCount}, type: ${message.type}`);

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
                    console.log(`[GenerateCommitName] Received 'result' message, completing`);
                    break;
                }
            }
            console.log(`[GenerateCommitName] Claude query iteration finished. Completed: ${completed}, Messages: ${messageCount}`);

            if (!completed) {
                console.log(`[GenerateCommitName] Attempt ${attempt} - Processing did not complete`);
                continue;
            }

            // Check if the response contains an API error
            const lowerResponse = assistantResponse.toLowerCase();
            if (lowerResponse.includes('api error') || lowerResponse.includes('"type":"error"') || lowerResponse.includes('error:')) {
                console.log(`[GenerateCommitName] Attempt ${attempt} - Detected API error in response`);
                console.log(`[GenerateCommitName] Response was: ${assistantResponse.substring(0, 500)}...`);
                continue; // Skip this attempt and retry
            }

            // Clean up the response - take the first line and trim to 72 chars
            const commitName = assistantResponse.trim().split('\n')[0].substring(0, 72);

            if (commitName && commitName.length > 0) {
                const response: GenerateCommitNameResult = {
                    success: true,
                    commitName: commitName
                };

                console.log(`[GenerateCommitName] Successfully generated commit name on attempt ${attempt}`);
                console.log(`[GenerateCommitName] Commit name: ${commitName}`);
                const encryptedResponse = encryption.encrypt(response);
                return c.json({ encrypted: encryptedResponse });
            } else {
                console.log(`[GenerateCommitName] Attempt ${attempt} - Empty response`);
                console.log(`[GenerateCommitName] Response was: ${assistantResponse.substring(0, 500)}...`);
            }

        } catch (error) {
            console.error(`[GenerateCommitName] Attempt ${attempt} error:`, error);
            if (error instanceof Error) {
                console.error(`[GenerateCommitName] Error message: ${error.message}`);
                console.error(`[GenerateCommitName] Error stack: ${error.stack}`);
            }
        }
    }

    // All attempts failed - fallback to using last user prompt as commit message
    console.log('[GenerateCommitName] All attempts failed, falling back to last user prompt');

    // Extract the last user prompt from conversation messages
    let lastPrompt = 'Update code';
    if (data!.conversationMessages && data!.conversationMessages.length > 0) {
        const lastMessage = data!.conversationMessages[data!.conversationMessages.length - 1];
        lastPrompt = (lastMessage.prompt || lastMessage.content || 'Update code').substring(0, 72);
    }

    const response: GenerateCommitNameResult = {
        success: true,
        commitName: lastPrompt
    };
    console.log(`[GenerateCommitName] Using fallback commit name: ${lastPrompt}`);
    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
});

export default app;
