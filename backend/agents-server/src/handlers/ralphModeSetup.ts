import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const app = new Hono()

interface RalphModeSetupRequest {
    taskDescription: string;
}

const RALPH_NOTES_DIR = path.join(os.homedir(), '.ariana-ralph-notes');
const TASK_LOCK_FILE = path.join(RALPH_NOTES_DIR, '.task-lock');
const README_FILE = path.join(RALPH_NOTES_DIR, 'README.md');

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<RalphModeSetupRequest>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    const { taskDescription } = data as RalphModeSetupRequest;

    if (!taskDescription) {
        const encryptedResponse = encryption.encrypt({ success: false, error: 'Task description is required' });
        return c.json({ encrypted: encryptedResponse });
    }

    try {
        // Create directory if it doesn't exist
        await fs.mkdir(RALPH_NOTES_DIR, { recursive: true });

        // Create empty .task-lock file
        await fs.writeFile(TASK_LOCK_FILE, '');

        // Create initial README.md
        const readmeContent = `# Ralph Mode Task

## Task Description
${taskDescription}

## Validation Criteria
TODO: Define clear validation criteria (tests passing, performance goals, etc.)

## Iteration Plan
TODO: Document how to iterate on this task

## Work Log
TODO: Document units of work completed

---
Last updated: ${new Date().toISOString()}
`;
        await fs.writeFile(README_FILE, readmeContent);

        console.log('[RalphMode] Setup completed:', RALPH_NOTES_DIR);

        const response = {
            success: true,
            directory: RALPH_NOTES_DIR
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (err) {
        console.error('[RalphMode] Setup failed:', err);
        const response = {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error'
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;
