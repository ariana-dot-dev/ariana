import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { spawn } from 'child_process';

const app = new Hono()

interface ResetRequest {
    agentId: string;
    commitSha: string;
}

interface ResetResult {
    success: boolean;
    commitSha?: string;
    error?: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<ResetRequest>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    const { commitSha } = data!;

    if (!globalState.projectDir) {
        const response: ResetResult = {
            success: false,
            error: 'Project directory not set'
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    if (!commitSha) {
        const response: ResetResult = {
            success: false,
            error: 'Commit SHA is required'
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Hard reset to the specified commit
    const resetProcess = spawn('git', ['reset', '--hard', commitSha], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let resetStdout = '';
    let resetStderr = '';

    resetProcess.stdout?.on('data', (data) => {
        resetStdout += data.toString();
    });

    resetProcess.stderr?.on('data', (data) => {
        resetStderr += data.toString();
    });

    const resetExitCode = await new Promise<number>((resolve) => {
        resetProcess.on('exit', resolve);
    });

    if (resetExitCode !== 0) {
        console.error('git reset failed:', resetStderr);
        const response: ResetResult = {
            success: false,
            error: resetStderr || 'Git reset failed'
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    console.log('git reset successful:', resetStdout);

    // Optionally force push if GitHub token and repository are available
    if (globalState.githubToken && globalState.githubRepository) {
        try {
            // Get current branch
            const branchProcess = spawn('git', ['branch', '--show-current'], {
                cwd: globalState.projectDir,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let currentBranch = '';
            branchProcess.stdout?.on('data', (data) => {
                currentBranch += data.toString();
            });

            await new Promise<void>((resolve) => {
                branchProcess.on('exit', resolve);
            });

            currentBranch = currentBranch.trim();

            if (currentBranch) {
                // Force push using authenticated URL
                const repoUrl = `https://${globalState.githubToken}@github.com/${globalState.githubRepository}.git`;
                const pushProcess = spawn('git', ['push', '--force', repoUrl, currentBranch], {
                    cwd: globalState.projectDir,
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                let pushStderr = '';
                pushProcess.stderr?.on('data', (data) => {
                    pushStderr += data.toString();
                });

                const pushExitCode = await new Promise<number>((resolve) => {
                    pushProcess.on('exit', resolve);
                });

                if (pushExitCode !== 0) {
                    console.error('git force push failed:', pushStderr);
                    // Don't fail the reset if push fails
                } else {
                    console.log('git force push successful');
                }
            }
        } catch (error) {
            console.error('Failed to force push:', error);
            // Don't fail the reset if push fails
        }
    } else {
        console.log('Skipping git force push - no GitHub credentials available');
    }

    const response: ResetResult = {
        success: true,
        commitSha
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;
