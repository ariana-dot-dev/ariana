import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import type { AgentProviderConfig } from '../../../shared/types';

const app = new Hono()

// Store the config for future use (e.g., some auth methods might need it)
let storedAgentProviderConfig: AgentProviderConfig | null = null;

export function getStoredAgentProviderConfig(): AgentProviderConfig | null {
    return storedAgentProviderConfig;
}

interface UpdateCredentialsConfig {
    environment?: Record<string, string>;
    agentProviderConfig?: AgentProviderConfig;
}

app.post('/', async (c) => {
    console.log('[UPDATE-CREDENTIALS] Request received');
    const body = await c.req.json();

    const { valid, data, error } = await encryption.decryptAndValidate<UpdateCredentialsConfig>(body);

    if (!valid) {
        console.log('[UPDATE-CREDENTIALS] Invalid data:', error);
        return c.json({ error }, 400);
    }

    const { environment = {}, agentProviderConfig } = data!;

    try {
        // Update environment variables
        if (Object.keys(environment).length > 0) {
            console.log('[UPDATE-CREDENTIALS] Updating environment variables:', Object.keys(environment).join(', '));
            for (const [key, value] of Object.entries(environment)) {
                process.env[key] = value;
                console.log(`[UPDATE-CREDENTIALS] Updated ${key}=${value ? value.substring(0, 10) + '...' : 'undefined'}`);
            }
        }

        // Store the provider config for future use
        if (agentProviderConfig) {
            storedAgentProviderConfig = agentProviderConfig;
            const authMethod = agentProviderConfig.claudeCode.activeAuthMethod;
            const apiProvider = agentProviderConfig.claudeCode.apiKey.activeProvider;
            console.log(`[UPDATE-CREDENTIALS] Stored agent provider config: ${authMethod === 'subscription' ? 'subscription' : `api-key (${apiProvider})`}`);
        }

        const response = {
            status: 'success',
            message: 'Credentials updated successfully'
        };

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('[UPDATE-CREDENTIALS] Failed to update credentials:', error);
        return c.json({
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
})

export default app;
