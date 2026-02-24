import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const app = new Hono()

const UPLOAD_DIR = '/tmp/agent-upload';

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{
        chunkIndex: number;
        totalChunks: number;
        chunk: string;
    }>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    const { chunkIndex, totalChunks, chunk } = data!;

    try {
        console.log(`Received chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} bytes)`);

        // Create upload directory if needed
        if (!existsSync(UPLOAD_DIR)) {
            await mkdir(UPLOAD_DIR, { recursive: true });
        }

        // Write chunk to filesystem
        const chunkPath = `${UPLOAD_DIR}/chunk-${chunkIndex}`;
        await writeFile(chunkPath, chunk, 'utf8');

        console.log(`Stored chunk ${chunkIndex + 1}/${totalChunks} to ${chunkPath}`);

        const response = { success: true };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('Error storing chunk:', error);

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to store chunk'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;
