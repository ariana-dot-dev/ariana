import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { exec } from 'child_process';
import { promisify } from 'util';
import { customEnvironmentVariables } from './start';
import { getBashrcPath } from '../utils/paths';

const execAsync = promisify(exec);

const app = new Hono();

interface UpdateEnvironmentRequest {
  environment: Record<string, string>;
}

app.post('/', async (c) => {
  console.log('[UPDATE-ENVIRONMENT] Request received');
  const body = await c.req.json();

  const { valid, data, error } = await encryption.decryptAndValidate<UpdateEnvironmentRequest>(body);

  if (!valid) {
    console.log('[UPDATE-ENVIRONMENT] Invalid data', '\nerror: ', error);
    return c.json({ error }, 400);
  }

  const { environment } = data!;

  try {
    console.log(`[UPDATE-ENVIRONMENT] Updating ${Object.keys(environment).length} environment variables`);

    // Update process.env with new variables
    for (const [key, value] of Object.entries(environment)) {
      process.env[key] = value;
      customEnvironmentVariables.add(key);  // Track custom variables
      console.log(`[UPDATE-ENVIRONMENT] Set ${key}=${value ? value.substring(0, 10) + '...' : 'undefined'}`);
    }

    // Write to .bashrc for SSH access
    try {
      const bashrcPath = getBashrcPath();

      // Ensure .bashrc exists
      await execAsync(`touch "${bashrcPath}"`);

      const envLines = Object.entries(environment)
        .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
        .join('\n');

      // Remove old environment variables block if it exists
      await execAsync(`sed -i '/# ARIANA ENVIRONMENT VARIABLES START/,/# ARIANA ENVIRONMENT VARIABLES END/d' "${bashrcPath}"`);

      // Append new environment variables
      const envBlock = `\n# ARIANA ENVIRONMENT VARIABLES START\n${envLines}\n# ARIANA ENVIRONMENT VARIABLES END\n`;
      await execAsync(`echo '${envBlock.replace(/'/g, "'\\''")}' >> "${bashrcPath}"`);

      console.log(`[UPDATE-ENVIRONMENT] Environment variables written to ${bashrcPath}`);
    } catch (error) {
      console.error('[UPDATE-ENVIRONMENT] Failed to write environment variables to .bashrc:', error);
    }

    console.log('[UPDATE-ENVIRONMENT] All environment variables updated successfully');

    const response = {
      status: 'success',
      message: `Updated ${Object.keys(environment).length} environment variables`
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });

  } catch (error) {
    console.error('[UPDATE-ENVIRONMENT] Failed to update environment:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;
