import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { spawn } from 'child_process';

const app = new Hono()

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{
        agentId: string
    }>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    if (!globalState.projectDir) {
        const response = { hasChanges: false };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    // Check git status for changes
    const statusProcess = spawn('git', ['status', '--porcelain'], {
        cwd: globalState.projectDir,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    statusProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
    });

    statusProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
        statusProcess.on('exit', resolve);
    });

    if (exitCode !== 0) {
        console.error('git status failed:', stderr);
        const response = { hasChanges: false, error: stderr };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }

    const hasChanges = stdout.trim().length > 0;

    const response = {
        hasChanges,
        changes: stdout.trim()
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;