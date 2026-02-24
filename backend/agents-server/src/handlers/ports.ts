import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { getOpenPorts } from '../portMonitor';

const app = new Hono();

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error);
        return c.json({ error }, 400);
    }

    try {
        const ports = getOpenPorts();

        const response = {
            success: true,
            ports,
            timestamp: new Date().toISOString()
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('Error getting ports:', error);

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get ports'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
});

export default app;
