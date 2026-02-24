import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { spawn } from 'child_process';

const app = new Hono()

interface PushRequest {
    agentId: string;
}

interface PushResult {
    success: boolean;
    error?: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<PushRequest>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    if (!globalState.projectDir) {
        const response: PushResult = {
            success: false,
            error: 'Project directory not set'
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Get current branch name
    const branchProcess = spawn('git', ['branch', '--show-current'], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let branchStdout = '';
    branchProcess.stdout?.on('data', (data) => {
        branchStdout += data.toString();
    });

    await new Promise<void>((resolve) => {
        branchProcess.on('exit', resolve);
    });

    const branch = branchStdout.trim();
    if (!branch) {
        const response: PushResult = {
            success: false,
            error: 'Could not determine current branch'
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Push to origin
    const pushProcess = spawn('git', ['push', 'origin', branch], {
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
        console.error('[GitPush] git push failed:', pushStderr);
        const response: PushResult = {
            success: false,
            error: pushStderr
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    console.log(`[GitPush] Pushed branch ${branch} to origin`);

    const response: PushResult = {
        success: true
    };
    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;
