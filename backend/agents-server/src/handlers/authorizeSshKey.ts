import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { getSshDir } from '../utils/paths';

const app = new Hono()

interface AuthorizeSshKeyRequest {
    publicKey: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<AuthorizeSshKeyRequest>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    const { publicKey } = data!;

    try {
        console.log('[AUTHORIZE-SSH-KEY] Adding SSH key to authorized_keys');
        console.log('[AUTHORIZE-SSH-KEY] Key:', publicKey.substring(0, 50) + '...');

        const sshDir = getSshDir();
        const authorizedKeysPath = `${sshDir}/authorized_keys`;

        // Ensure .ssh directory exists with correct permissions
        if (!existsSync(sshDir)) {
            mkdirSync(sshDir, { recursive: true, mode: 0o700 });
        }

        // Use grep to check if key already exists, if not, append it
        // -qxF means: quiet, exact line match, fixed string (no regex)
        // The || means "if grep fails (key not found), then echo the key"
        const command = `grep -qxF "${publicKey}" "${authorizedKeysPath}" 2>/dev/null || echo "${publicKey}" >> "${authorizedKeysPath}"`;

        execSync(command, { encoding: 'utf8' });

        // Ensure correct permissions on authorized_keys
        execSync(`chmod 600 "${authorizedKeysPath}"`, { encoding: 'utf8' });

        console.log('[AUTHORIZE-SSH-KEY] SSH key authorized successfully');

        const response = {
            success: true,
            message: 'SSH key added to authorized_keys'
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('[AUTHORIZE-SSH-KEY] Error:', error);

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to authorize SSH key'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;
