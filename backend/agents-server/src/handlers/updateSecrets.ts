import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import * as fs from 'fs/promises';
import { join, dirname } from 'path';

const app = new Hono();

interface SecretFile {
  path: string;
  contents: string;
}

interface UpdateSecretsConfig {
  secretFiles: SecretFile[];
}

app.post('/', async (c) => {
  console.log('[UPDATE-SECRETS] Request received');
  const body = await c.req.json();

  const { valid, data, error } = await encryption.decryptAndValidate<UpdateSecretsConfig>(body);

  if (!valid) {
    console.log('[UPDATE-SECRETS] Invalid data', '\nerror: ', error);
    return c.json({ error }, 400);
  }

  const { secretFiles } = data!;

  if (!globalState.projectDir) {
    console.error('[UPDATE-SECRETS] Project directory not set');
    return c.json({ error: 'Project directory not set' }, 500);
  }

  try {
    console.log(`[UPDATE-SECRETS] Writing ${secretFiles.length} secret files to project`);

    for (const secretFile of secretFiles) {
      const fullPath = join(globalState.projectDir, secretFile.path);
      console.log(`[UPDATE-SECRETS] Writing secret file: ${secretFile.path}`);

      // Create parent directories if they don't exist
      await fs.mkdir(dirname(fullPath), { recursive: true });

      // Write the secret file
      await fs.writeFile(fullPath, secretFile.contents);
    }

    console.log('[UPDATE-SECRETS] All secret files written successfully');

    const response = {
      status: 'success',
      message: `Updated ${secretFiles.length} secret files`
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });

  } catch (error) {
    console.error('[UPDATE-SECRETS] Failed to update secret files:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
