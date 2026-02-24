import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { getBashrcPath } from '../utils/paths';

const execAsync = promisify(exec);
const app = new Hono()

interface UpdateGithubTokenRequest {
    githubToken: string;
}

/**
 * Persist GitHub token to gh CLI config so SSH sessions can use it.
 */
async function persistGhAuth(token: string): Promise<void> {
    try {
        await execAsync(`bash -c 'unset GITHUB_TOKEN; echo "${token}" | gh auth login --with-token'`, {
            env: { ...process.env, GITHUB_TOKEN: undefined }
        });
        console.log('[UPDATE-GITHUB-TOKEN] Persisted token to gh CLI config');
    } catch (error) {
        console.log('[UPDATE-GITHUB-TOKEN] Could not persist gh auth (non-fatal):', error instanceof Error ? error.message : error);
    }
}

app.post('/', async (c) => {
    console.log('Update GitHub token request received');
    const body = await c.req.json();

    const { valid, data, error } = await encryption.decryptAndValidate<UpdateGithubTokenRequest>(body);

    if (!valid) {
        console.log('Invalid data in /update-github-token', "\nerror: ", error);
        return c.json({ error }, 400);
    }

    const { githubToken } = data!;

    try {
        // Update global state
        globalState.githubToken = githubToken;

        // Update environment variable for gh CLI and user scripts
        process.env.GITHUB_TOKEN = githubToken;

        // Persist to gh CLI config so SSH sessions can use it
        await persistGhAuth(githubToken);

        // Update .bashrc for SSH sessions
        try {
            const bashrcPath = getBashrcPath();
            if (existsSync(bashrcPath)) {
                let bashrc = readFileSync(bashrcPath, 'utf-8');
                // Update GITHUB_TOKEN in the existing ARIANA ENVIRONMENT VARIABLES block
                bashrc = bashrc.replace(
                    /export GITHUB_TOKEN="[^"]*"/,
                    `export GITHUB_TOKEN="${githubToken.replace(/"/g, '\\"')}"`
                );
                writeFileSync(bashrcPath, bashrc);
                console.log('[UPDATE-GITHUB-TOKEN] Updated GITHUB_TOKEN in bashrc');
            }
        } catch (bashrcError) {
            console.log('[UPDATE-GITHUB-TOKEN] Could not update bashrc (non-fatal):', bashrcError instanceof Error ? bashrcError.message : bashrcError);
        }

        console.log('[UPDATE-GITHUB-TOKEN] Updated GitHub token in memory, environment, gh CLI, and bashrc');

        const response = {
            status: 'success',
            message: 'GitHub token updated'
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('Failed to update GitHub token:', error);
        return c.json({
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
})

export default app;
