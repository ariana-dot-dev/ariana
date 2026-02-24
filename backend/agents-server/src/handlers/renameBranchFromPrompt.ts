import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { runClaudeQuery } from '../claudeService';
import { spawn } from 'child_process';

const app = new Hono();

interface RenameBranchRequest {
    agentId: string;
    currentPrompt: string;
}

interface RenameBranchResult {
    success: boolean;
    branchName?: string;
    error?: string;
}

app.post('/', async (c) => {
    console.log('[RenameBranchFromPrompt] Request received');
    const body = await c.req.json();

    const { valid, data, error } = await encryption.decryptAndValidate<RenameBranchRequest>(body);

    if (!valid) {
        console.error('[RenameBranchFromPrompt] Invalid encrypted data:', error);
        return c.json({ error }, 400);
    }

    console.log(`[RenameBranchFromPrompt] Decrypted request for agent ${data!.agentId}, prompt length: ${data!.currentPrompt.length}`);

    if (!globalState.projectDir) {
        console.error('[RenameBranchFromPrompt] Project directory not set');
        const response: RenameBranchResult = { success: false, error: 'Project directory not set' };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Check if branch was already renamed
    if (globalState.branchRenamed) {
        console.log('[RenameBranchFromPrompt] Branch already renamed, skipping');
        const response: RenameBranchResult = { success: false, error: 'Branch already renamed' };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    const currentPrompt = data!.currentPrompt;

    // Retry up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[RenameBranchFromPrompt] Attempt ${attempt}/3`);

        try {
            // Extract beginning and end of prompt (non-overlapping)
            let promptContent: string;
            if (currentPrompt.length <= 4000) {
                promptContent = currentPrompt;
            } else {
                const beginning = currentPrompt.substring(0, 2000);
                const end = currentPrompt.substring(currentPrompt.length - 2000);
                promptContent = `${beginning}\n\n[...middle truncated...]\n\n${end}`;
            }

            // Craft prompt for Claude Haiku
            const prompt = `Generate a git branch name based on what the user is asking for.

## Current user prompt:
${promptContent}

Respond with a single git branch name that follows these rules:
- Use kebab-case (lowercase with hyphens)
- Be descriptive but concise (2-5 words max)
- Start with a verb when possible (add-, fix-, update-, refactor-)
- Focus on the main feature or change
- No special characters except hyphens
- Max 50 characters

Example good branch names:
- "add-user-authentication"
- "fix-memory-leak"
- "add-dark-mode-toggle"
- "refactor-database-queries"
- "update-api-docs"
- "add-dnd-vertical-split"

Respond with ONLY the branch name, nothing else.`;

            console.log(`[RenameBranchFromPrompt] Prompt length: ${prompt.length}`);

            const abortController = new AbortController();

            let completed = false;
            let messageCount = 0;
            let assistantResponse = '';

            console.log(`[RenameBranchFromPrompt] Starting Claude query iteration...`);
            for await (const message of runClaudeQuery(prompt, 'haiku', {
                continue: false,
                cwd: globalState.projectDir,
                abortController
            })) {
                messageCount++;
                console.log(`[RenameBranchFromPrompt] Received message ${messageCount}, type: ${message.type}`);

                if (message.type === 'assistant' && message.message?.content) {
                    for (const content of message.message.content) {
                        if (content.type === 'text') {
                            assistantResponse += content.text;
                        }
                    }
                }

                if (message.type === 'result') {
                    completed = true;
                    console.log(`[RenameBranchFromPrompt] Received 'result' message, completing`);
                    break;
                }
            }
            console.log(`[RenameBranchFromPrompt] Claude query iteration finished. Completed: ${completed}, Messages: ${messageCount}`);

            if (!completed) {
                console.log(`[RenameBranchFromPrompt] Attempt ${attempt} - Processing did not complete`);
                continue;
            }

            // Check if the response contains an API error
            const lowerResponse = assistantResponse.toLowerCase();
            if (lowerResponse.includes('api error') || lowerResponse.includes('"type":"error"') || lowerResponse.includes('error:')) {
                console.log(`[RenameBranchFromPrompt] Attempt ${attempt} - Detected API error in response`);
                console.log(`[RenameBranchFromPrompt] Response was: ${assistantResponse.substring(0, 500)}...`);
                continue;
            }

            // Check if the response is a refusal/clarification request rather than a branch name
            // These patterns indicate the LLM didn't generate a branch name
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
                console.log(`[RenameBranchFromPrompt] Attempt ${attempt} - Detected refusal/clarification response`);
                console.log(`[RenameBranchFromPrompt] Response was: ${assistantResponse.substring(0, 200)}...`);
                continue;
            }

            // Clean up the response - take the first line, trim, and sanitize
            let branchName = assistantResponse.trim().split('\n')[0].substring(0, 50);
            // Remove any quotes, special characters (keep lowercase, numbers, hyphens)
            branchName = branchName.toLowerCase().replace(/[^a-z0-9-]/g, '');
            // Remove leading/trailing hyphens
            branchName = branchName.replace(/^-+|-+$/g, '');

            // Validate branch name looks reasonable (should have at least one hyphen for multi-word names)
            // and shouldn't be excessively long without hyphens (indicates garbled text)
            const hyphenCount = (branchName.match(/-/g) || []).length;
            const longestSegment = branchName.split('-').reduce((max, seg) => Math.max(max, seg.length), 0);
            if (longestSegment > 25) {
                console.log(`[RenameBranchFromPrompt] Attempt ${attempt} - Branch name has suspicious segment length: ${longestSegment}`);
                console.log(`[RenameBranchFromPrompt] Generated: ${branchName}`);
                continue;
            }

            if (branchName && branchName.length > 0) {
                // Prefix with "feat" if it doesn't start with a verb
                const verbPrefixes = ['add-', 'fix-', 'update-', 'refactor-', 'remove-', 'implement-', 'improve-', 'create-', 'setup-', 'configure-'];
                const hasVerbPrefix = verbPrefixes.some(prefix => branchName.startsWith(prefix));
                if (!hasVerbPrefix) {
                    branchName = `feat${branchName.startsWith('-') ? '' : '-'}${branchName}`;
                }

                // Rename the current branch
                console.log(`[RenameBranchFromPrompt] Renaming branch to: ${branchName}`);
                const renameProcess = spawn('git', ['branch', '-m', branchName], {
                    cwd: globalState.projectDir,
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let renameError = '';
                renameProcess.stderr?.on('data', (data) => {
                    renameError += data.toString();
                });

                const exitCode = await new Promise<number>((resolve) => {
                    renameProcess.on('exit', (code) => resolve(code || 0));
                });

                if (exitCode !== 0) {
                    console.error(`[RenameBranchFromPrompt] git branch -m failed: ${renameError}`);
                    continue;
                }

                // Mark branch as renamed so we don't rename again on commit
                globalState.branchRenamed = true;

                const response: RenameBranchResult = {
                    success: true,
                    branchName: branchName
                };

                console.log(`[RenameBranchFromPrompt] Successfully renamed branch to: ${branchName}`);
                const encryptedResponse = encryption.encrypt(response);
                return c.json({ encrypted: encryptedResponse });
            } else {
                console.log(`[RenameBranchFromPrompt] Attempt ${attempt} - Empty response`);
                console.log(`[RenameBranchFromPrompt] Response was: ${assistantResponse.substring(0, 500)}...`);
            }

        } catch (error) {
            console.error(`[RenameBranchFromPrompt] Attempt ${attempt} error:`, error);
            if (error instanceof Error) {
                console.error(`[RenameBranchFromPrompt] Error message: ${error.message}`);
                console.error(`[RenameBranchFromPrompt] Error stack: ${error.stack}`);
            }
        }
    }

    // All attempts failed
    console.error('[RenameBranchFromPrompt] FAILED to rename branch after 3 attempts');

    const response: RenameBranchResult = {
        success: false,
        error: 'Failed to generate and rename branch after 3 attempts'
    };
    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
});

export default app;
