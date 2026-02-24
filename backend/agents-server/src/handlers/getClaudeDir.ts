import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { getHomeDir, getClaudeDir } from '../utils/paths';

const app = new Hono()

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.error('[getClaudeDir] Invalid data:', error);
        return c.json({ error }, 400);
    }

    try {
        const homeDir = getHomeDir();
        const claudeDirPath = getClaudeDir();

        if (!existsSync(claudeDirPath)) {
            const response = { success: true, claudeDirectoryZip: null };
            const encryptedResponse = encryption.encrypt(response);
            return c.json({ encrypted: encryptedResponse });
        }

        const zipBase64 = execSync(
            `tar -czf - -C "${homeDir}" .claude | base64 -w 0`,
            {
                encoding: 'utf8',
                maxBuffer: 100 * 1024 * 1024
            }
        );

        const response = { success: true, claudeDirectoryZip: zipBase64.trim() };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('Error getting .claude directory:', error);

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get .claude directory'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;
