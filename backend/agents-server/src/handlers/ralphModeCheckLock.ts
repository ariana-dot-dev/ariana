import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const app = new Hono()

const RALPH_NOTES_DIR = path.join(os.homedir(), '.ariana-ralph-notes');
const TASK_LOCK_FILE = path.join(RALPH_NOTES_DIR, '.task-lock');

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    let exists = false;
    try {
        await fs.access(TASK_LOCK_FILE);
        exists = true;
    } catch {
        exists = false;
    }

    const response = {
        success: true,
        exists
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
})

export default app;
