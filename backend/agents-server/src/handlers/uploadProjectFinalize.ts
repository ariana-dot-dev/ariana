import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { writeFile, readFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';

const app = new Hono()

const UPLOAD_DIR = '/tmp/agent-upload';

app.post('/', async (c) => {
    const body = await c.req.json();
    const { valid, data, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\ndata: ", data, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    try {
        console.log(`Finalizing upload, reconstructing data from filesystem chunks`);

        // Check if upload directory exists
        if (!existsSync(UPLOAD_DIR)) {
            throw new Error('No upload chunks found');
        }

        // Read all chunk files
        const files = await readdir(UPLOAD_DIR);
        const chunkFiles = files.filter(f => f.startsWith('chunk-')).sort((a, b) => {
            const indexA = parseInt(a.split('-')[1]);
            const indexB = parseInt(b.split('-')[1]);
            return indexA - indexB;
        });

        console.log(`Found ${chunkFiles.length} chunk files`);

        // Read and concatenate chunks
        const chunks = await Promise.all(
            chunkFiles.map(file => readFile(`${UPLOAD_DIR}/${file}`, 'utf8'))
        );
        const combinedData = chunks.join('');
        console.log(`Reconstructed data: ${combinedData.length} bytes`);

        // Parse the JSON to get bundle, patch, and metadata
        const { bundleBase64, patchBase64, isIncremental, baseCommitSha, remoteUrl } = JSON.parse(combinedData);

        // Decode base64 and write files
        const bundleBuffer = Buffer.from(bundleBase64, 'base64');
        const patchBuffer = Buffer.from(patchBase64, 'base64');

        const writePromises = [
            writeFile('/tmp/project.bundle', bundleBuffer),
            writeFile('/tmp/project.patch', patchBuffer)
        ];

        // If incremental, write metadata file for the start handler
        if (isIncremental && baseCommitSha && remoteUrl) {
            console.log(`Writing incremental bundle metadata - base commit: ${baseCommitSha}`);
            const metadata = JSON.stringify({
                isIncremental: true,
                baseCommitSha,
                remoteUrl
            });
            writePromises.push(writeFile('/tmp/bundle-metadata.json', metadata, 'utf8'));
        }

        await Promise.all(writePromises);

        console.log(`Wrote bundle (${bundleBuffer.length} bytes) and patch (${patchBuffer.length} bytes) to /tmp/`);
        if (isIncremental) {
            console.log(`Incremental bundle - will clone from ${remoteUrl} at ${baseCommitSha}`);
        }

        // Clear chunks from filesystem
        await rm(UPLOAD_DIR, { recursive: true, force: true });
        console.log('Cleared upload directory');

        const response = {
            success: true,
            bundleSize: bundleBuffer.length,
            patchSize: patchBuffer.length
        };
        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('Error finalizing upload:', error);

        // Clear chunks on error
        try {
            await rm(UPLOAD_DIR, { recursive: true, force: true });
        } catch (cleanupError) {
            console.error('Failed to cleanup upload directory:', cleanupError);
        }

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to finalize upload'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;
