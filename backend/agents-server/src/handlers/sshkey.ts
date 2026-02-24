import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { execSync } from 'child_process';

const app = new Hono()

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{
        key: string;
        accessLevel: 'read' | 'write';
    }>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    const { key, accessLevel } = data!;

    try {
        // Route SSH key to appropriate user based on access level
        // READ users -> ariana-readonly (port forwarding only)
        // WRITE users -> ariana (full access)
        const targetUser = accessLevel === 'write' ? 'ariana' : 'ariana-readonly';

        console.log(`Adding SSH key for ${targetUser} user (access level: ${accessLevel})`);

        // For ariana user (write access), write to own authorized_keys (no sudo needed)
        if (targetUser === 'ariana') {
            execSync(`grep -qxF "${key}" ~/.ssh/authorized_keys 2>/dev/null || echo "${key}" >> ~/.ssh/authorized_keys`, { encoding: 'utf8' });
        } else {
            // For ariana-readonly user, run command as that user
            execSync(`sudo -u ariana-readonly bash -c 'grep -qxF "${key}" ~/.ssh/authorized_keys 2>/dev/null || echo "${key}" >> ~/.ssh/authorized_keys'`, { encoding: 'utf8' });
        }

        const response = { success: true, user: targetUser };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('Error setting SSH key:', error);

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to add SSH key'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;