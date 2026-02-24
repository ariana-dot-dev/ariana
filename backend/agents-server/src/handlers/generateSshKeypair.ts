import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { getSshDir } from '../utils/paths';

const app = new Hono()

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    try {
        console.log('[GENERATE-SSH-KEYPAIR] Generating SSH keypair for fork transfer');

        const sshDir = getSshDir();
        const keyPath = `${sshDir}/fork_transfer`;
        const pubKeyPath = `${keyPath}.pub`;

        // Ensure .ssh directory exists
        if (!existsSync(sshDir)) {
            mkdirSync(sshDir, { recursive: true, mode: 0o700 });
        }

        // Generate ed25519 keypair (no passphrase, non-interactive)
        console.log('[GENERATE-SSH-KEYPAIR] Running ssh-keygen');
        execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "fork-transfer" -q`, {
            encoding: 'utf8'
        });

        // Set correct permissions
        execSync(`chmod 600 "${keyPath}"`, { encoding: 'utf8' });
        execSync(`chmod 644 "${pubKeyPath}"`, { encoding: 'utf8' });

        // Read public key
        const publicKey = readFileSync(pubKeyPath, 'utf8').trim();

        console.log('[GENERATE-SSH-KEYPAIR] Keypair generated successfully');
        console.log('[GENERATE-SSH-KEYPAIR] Public key:', publicKey.substring(0, 50) + '...');

        const response = {
            success: true,
            publicKey,
            privateKeyPath: keyPath
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('[GENERATE-SSH-KEYPAIR] Error:', error);

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to generate SSH keypair'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;
