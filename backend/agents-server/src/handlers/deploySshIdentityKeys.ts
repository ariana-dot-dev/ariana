import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import * as path from 'path';
import { getSshDir } from '../utils/paths';

const app = new Hono()

interface DeploySshIdentityKeysRequest {
    publicKey: string;
    privateKey: string;
    keyName: string;
}

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<DeploySshIdentityKeysRequest>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    const { publicKey, privateKey, keyName } = data!;

    try {
        console.log('[DEPLOY-SSH-IDENTITY] Deploying SSH identity key pair');
        console.log('[DEPLOY-SSH-IDENTITY] Key name:', keyName);

        const sshDir = getSshDir();
        const privateKeyPath = path.join(sshDir, keyName);
        const publicKeyPath = path.join(sshDir, `${keyName}.pub`);

        // Ensure .ssh directory exists with correct permissions
        if (!existsSync(sshDir)) {
            mkdirSync(sshDir, { recursive: true, mode: 0o700 });
        }

        // Write private key with 600 permissions (read/write for owner only)
        writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
        console.log('[DEPLOY-SSH-IDENTITY] Private key written to:', privateKeyPath);

        // Write public key with 644 permissions (read for all, write for owner)
        writeFileSync(publicKeyPath, publicKey, { mode: 0o644 });
        console.log('[DEPLOY-SSH-IDENTITY] Public key written to:', publicKeyPath);

        // Ensure .ssh directory has correct permissions
        execSync(`chmod 700 "${sshDir}"`, { encoding: 'utf8' });

        console.log('[DEPLOY-SSH-IDENTITY] SSH identity keys deployed successfully');

        const response = {
            success: true,
            message: 'SSH identity keys deployed successfully',
            privateKeyPath,
            publicKeyPath
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('[DEPLOY-SSH-IDENTITY] Error:', error);

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to deploy SSH identity keys'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;
