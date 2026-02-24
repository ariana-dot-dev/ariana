import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const app = new Hono();

interface WriteAutomationLogsRequest {
  automationId: string;
  automationName: string;
  output: string;
}

/**
 * Writes automation output to a temp file on the agent machine.
 * Returns the file path so the backend can reference it in a prompt.
 */
app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<WriteAutomationLogsRequest>(body);

    if (!valid || !data) {
        console.log('Invalid data in ' + c.req.path, "\nerror: ", error);
        return c.json({ error }, 400);
    }

    const { automationId, automationName, output } = data;

    if (!automationId || !output) {
        return c.json({ error: 'Missing automationId or output' }, 400);
    }

    try {
        const logsDir = join(homedir(), '.automation-logs');
        await mkdir(logsDir, { recursive: true });

        const sanitizedName = automationName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50);
        const filePath = join(logsDir, `${sanitizedName}-${automationId.slice(0, 8)}.log`);

        await writeFile(filePath, output, { encoding: 'utf-8' });

        const lineCount = output.split('\n').length;

        console.log(`[WRITE-AUTOMATION-LOGS] Wrote ${output.length} chars (${lineCount} lines) to ${filePath}`);

        const response = {
            success: true,
            filePath,
            lineCount,
            charCount: output.length,
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    } catch (error) {
        console.error('[WRITE-AUTOMATION-LOGS] Failed:', error);
        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse }, 500);
    }
});

export default app;
