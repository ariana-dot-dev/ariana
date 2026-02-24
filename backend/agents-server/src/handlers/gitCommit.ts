import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { spawn } from 'child_process';
import { runClaudeQuery } from '../claudeService';

const app = new Hono()

interface CommitRequest {
    agentId: string;
    message: string;
    conversationMessages?: any[];
}

interface CommitResult {
    success: boolean;
    commit?: {
        sha: string;
        message: string;
        timestamp: number;
    };
    error?: string;
    pushError?: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<CommitRequest>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    const { message } = data!;

    if (!globalState.projectDir) {
        const response: CommitResult = {
            success: false,
            error: 'Project directory not set'
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Add all changes
    const addProcess = spawn('git', ['add', '-A'], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    await new Promise<void>((resolve, reject) => {
        addProcess.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`git add failed with code ${code}`));
        });
    });

    // Commit changes
    const commitProcess = spawn('git', ['commit', '-m', message], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let commitStderr = '';
    commitProcess.stderr?.on('data', (data) => {
        commitStderr += data.toString();
    });

    const commitExitCode = await new Promise<number>((resolve) => {
        commitProcess.on('exit', resolve);
    });

    // Check if commit was successful (exit code 0) or if there were no changes (exit code 1)
    if (commitExitCode !== 0) {
        // Check if error is "nothing to commit"
        if (commitStderr.includes('nothing to commit') || commitStderr.includes('no changes added')) {
            const response: CommitResult = {
                success: false,
                error: 'No changes to commit'
            };
            const encryptedResponse = encryption.encrypt(response);
            return c.json({ encrypted: encryptedResponse });
        }

        console.error('git commit failed:', commitStderr);
        const response: CommitResult = {
            success: false,
            error: commitStderr
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Get commit info
    const logProcess = spawn('git', ['log', '-1', '--format=%H|%s|%ct'], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let logStdout = '';
    logProcess.stdout?.on('data', (data) => {
        logStdout += data.toString();
    });

    await new Promise<void>((resolve) => {
        logProcess.on('exit', resolve);
    });

    const [sha, commitMessage, timestamp] = logStdout.trim().split('|');

    // No longer auto-pushing commits - push will be done explicitly via git-push endpoint
    console.log('Commit created, not pushing automatically');

    const response: CommitResult = {
        success: true,
        commit: {
            sha,
            message: commitMessage,
            timestamp: parseInt(timestamp)
        }
    };

    const encryptedResponse = encryption.encrypt(response);

    // Start background task but don't await it
    if (data!.conversationMessages && data!.conversationMessages.length > 0) {
        // Mark SHA as pending rename so git-history filters it out.
        // This prevents polling from storing the pre-amend SHA as a separate commit.
        globalState.pendingRenames.add(sha);
        (async () => {
            try {
                console.log(`[GitCommit] Starting background task for commit ${sha}`);

                // Generate commit name
                await renameCommit(sha, data!.conversationMessages);

                // Generate branch name only on first commit (if we haven't renamed it yet)
                if (!globalState.branchRenamed) {
                    console.log(`[GitCommit] First commit with changes, renaming branch...`);
                    await renameBranch(data!.conversationMessages);
                    globalState.branchRenamed = true;
                } else {
                    console.log(`[GitCommit] Branch already renamed, skipping branch rename`);
                }

                console.log(`[GitCommit] Background task completed for commit ${sha}`);
            } catch (error) {
                console.error(`[GitCommit] Background task failed:`, error);
            } finally {
                globalState.pendingRenames.delete(sha);
            }
        })();
    }

    // Return the response
    return c.json({ encrypted: encryptedResponse });
})

async function renameCommit(commitSha: string, conversationMessages: any[]): Promise<void> {
    if (!globalState.projectDir) return;

    console.log(`[GitCommit] Generating name for commit ${commitSha}`);

    // Get commit diff
    const diffProcess = spawn('git', ['diff', `${commitSha}~1`, commitSha], {
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
    const conversationSummary = conversationMessages.map((msg: any, idx: number) =>
        `${idx + 1}. ${msg.timestamp ? new Date(msg.timestamp).toISOString() : ''} - User: ${msg.prompt || msg.content}`
    ).join('\n');

    // Retry up to 3 times (fewer than the handler to save resources)
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const prompt = `Generate a concise commit message based on:

## User Conversation:
${conversationSummary}

## Commit Diff:
${diffOutput.substring(0, 10000)}${diffOutput.length > 10000 ? '\n...(truncated)' : ''}

Respond with a single-line commit message (max 72 characters) that summarizes what changed and why.

Rules:
- Format: "<Topic>: <noun phrase A> + <noun phrase B>" - topic first (1-2 words), then noun-form actions
- Use noun forms (e.g., "addition", "fix", "removal", "refactoring", "update")
- If multiple changes, separate with " + "
- Be specific and concise
- No period at the end

Example good commit messages:
- "Auth: JWT validation addition + legacy tokens removal"
- "API: handlers refactoring + error logging addition"
- "Tests: flaky assertions fix + coverage addition"
- "Docker: config update + health checks addition"
- "Login: validation bug fix"

Respond with ONLY the commit message, nothing else.`;

            const abortController = new AbortController();
            let completed = false;
            let assistantResponse = '';

            for await (const message of runClaudeQuery(prompt, 'haiku', {
                continue: false,
                cwd: globalState.projectDir,
                abortController
            })) {
                if (message.type === 'assistant' && message.message?.content) {
                    for (const content of message.message.content) {
                        if (content.type === 'text') {
                            assistantResponse += content.text;
                        }
                    }
                }

                if (message.type === 'result') {
                    completed = true;
                    break;
                }
            }

            if (!completed) continue;

            const commitName = assistantResponse.trim().split('\n')[0].substring(0, 72);

            if (commitName && commitName.length > 0) {
                // Amend the commit message
                const amendProcess = spawn('git', ['commit', '--amend', '-m', commitName], {
                    cwd: globalState.projectDir,
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                await new Promise<void>((resolve) => {
                    amendProcess.on('exit', resolve);
                });

                console.log(`[GitCommit] Renamed commit ${commitSha} to: ${commitName}`);
                return;
            }
        } catch (error) {
            console.error(`[GitCommit] Rename attempt ${attempt} failed:`, error);
        }
    }

    console.error(`[GitCommit] FAILED to rename commit ${commitSha} after 3 attempts - keeping original message`);
}

async function renameBranch(conversationMessages: any[]): Promise<void> {
    if (!globalState.projectDir) return;

    console.log(`[GitCommit] Generating branch name`);

    // Extract user prompts from conversation
    const conversationSummary = conversationMessages.map((msg: any, idx: number) =>
        `${idx + 1}. ${msg.timestamp ? new Date(msg.timestamp).toISOString() : ''} - User: ${msg.prompt || msg.content}`
    ).join('\n');

    // Retry up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const prompt = `Generate a git branch name based on the user's conversation:

## User Conversation:
${conversationSummary}

Respond with a single git branch name that follows these rules:
- Use kebab-case (lowercase with hyphens)
- Be descriptive but concise (2-5 words max)
- Focus on the main feature or change
- No special characters except hyphens
- Max 50 characters

Respond with ONLY the branch name, nothing else.`;

            const abortController = new AbortController();
            let completed = false;
            let assistantResponse = '';

            for await (const message of runClaudeQuery(prompt, 'haiku', {
                continue: false,
                cwd: globalState.projectDir,
                abortController
            })) {
                if (message.type === 'assistant' && message.message?.content) {
                    for (const content of message.message.content) {
                        if (content.type === 'text') {
                            assistantResponse += content.text;
                        }
                    }
                }

                if (message.type === 'result') {
                    completed = true;
                    break;
                }
            }

            if (!completed) continue;

            let branchName = assistantResponse.trim().split('\n')[0].substring(0, 50);
            branchName = branchName.replace(/[^a-z0-9-]/g, '');

            if (branchName && branchName.length > 0) {
                // Rename the current branch
                const renameProcess = spawn('git', ['branch', '-m', branchName], {
                    cwd: globalState.projectDir,
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                await new Promise<void>((resolve) => {
                    renameProcess.on('exit', resolve);
                });

                console.log(`[GitCommit] Renamed branch to: ${branchName}`);
                return;
            }
        } catch (error) {
            console.error(`[GitCommit] Branch rename attempt ${attempt} failed:`, error);
        }
    }

    console.error(`[GitCommit] FAILED to rename branch after 3 attempts - keeping default branch name`);
}

export default app;