import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { spawn } from 'child_process';

const app = new Hono()

interface CommitInfo {
    sha: string;
    message: string;
    timestamp: number;
    branch: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    if (!globalState.projectDir) {
        throw new Error("project directory not set");
    }

    // Get the most recent commit
    const logProcess = spawn('git', ['log', '-1', '--format=%H|%s|%ct|%an|%ae'], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    logProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
    });

    logProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
        logProcess.on('exit', resolve);
    });

    if (exitCode !== 0 || !stdout.trim()) {
        return new Response(JSON.stringify({
            hasCommits: false,
            lastCommit: null,
            error: stderr.trim() || 'No commits found'
        }), { headers: { 'Content-Type': 'application/json' } });
    }

    const [sha, message, timestamp, _authorName, _authorEmail] = stdout.trim().split('|');

    // Get current branch
    const branchProcess = spawn('git', ['branch', '--show-current'], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let currentBranch = '';
    branchProcess.stdout?.on('data', (data) => {
        currentBranch += data.toString();
    });

    await new Promise((resolve) => {
        branchProcess.on('exit', resolve);
    });

    currentBranch = currentBranch.trim();

    const response: CommitInfo = {
        sha: sha,
        message: message,
        timestamp: parseInt(timestamp),
        branch: currentBranch
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;
