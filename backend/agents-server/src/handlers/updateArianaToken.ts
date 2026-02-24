import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { customEnvironmentVariables } from './start';
import { getBashrcPath } from '../utils/paths';

const app = new Hono();

interface UpdateArianaTokenRequest {
    token: string;
}

/**
 * Update the ARIANA_TOKEN environment variable.
 * Called by backend to refresh the token before it expires.
 */
app.post('/', async (c) => {
    console.log('/update-ariana-token request received');
    const body = await c.req.json();

    const { valid, data, error } = await encryption.decryptAndValidate<UpdateArianaTokenRequest>(body);

    if (!valid) {
        console.log('Invalid data in /update-ariana-token', "\nerror: ", error);
        return c.json({ error }, 400);
    }

    const { token } = data!;

    if (!token) {
        return c.json({ error: 'Token is required' }, 400);
    }

    try {
        // Update process.env for this process
        process.env.ARIANA_TOKEN = token;
        customEnvironmentVariables.add('ARIANA_TOKEN');
        console.log('[Ariana] Token updated in process.env');

        // Update bashrc for SSH sessions
        const bashrcPath = getBashrcPath();
        try {
            if (existsSync(bashrcPath)) {
                let bashrc = readFileSync(bashrcPath, 'utf-8');
                // Remove old ARIANA TOKEN block if exists
                bashrc = bashrc.replace(/\n# ARIANA TOKEN START[\s\S]*?# ARIANA TOKEN END\n?/g, '');
                // Add new token block
                const tokenBlock = `\n# ARIANA TOKEN START\nexport ARIANA_TOKEN="${token}"\nexport ARIANA_BACKEND_URL="${process.env.ARIANA_BACKEND_URL || 'https://ariana.dev'}"\n# ARIANA TOKEN END\n`;
                writeFileSync(bashrcPath, bashrc + tokenBlock);
                console.log('[Ariana] Token updated in bashrc');
            }
        } catch (bashrcError) {
            console.warn('[Ariana] Could not update bashrc:', bashrcError);
            // Not fatal - process.env is still updated
        }

        const encryptedResponse = encryption.encrypt({ success: true });
        return c.json({ encrypted: encryptedResponse });
    } catch (err) {
        console.error('[Ariana] Failed to update token:', err);
        return c.json({
            error: err instanceof Error ? err.message : 'Failed to update token'
        }, 500);
    }
});

export default app;
