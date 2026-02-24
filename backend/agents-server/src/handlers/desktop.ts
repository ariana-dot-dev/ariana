import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const app = new Hono()

const MOONLIGHT_DIR = '/opt/moonlight-web';
const MOONLIGHT_API = 'http://localhost:8090/api';
const STREAMING_PASSWORD = 'ariana-desktop-streaming';

interface StreamingCredentials {
    hostId: number;
    appId: number;
    token: string;
    xdotoolPort: number;
}

// Cache file path for storing credentials after pairing
const CREDENTIALS_FILE = `${MOONLIGHT_DIR}/server/streaming-credentials.json`;

/**
 * Get or create streaming credentials.
 * On first call, performs the moonlight-web pairing with Sunshine.
 * Subsequent calls return cached credentials.
 */
async function getOrCreateCredentials(T: () => string): Promise<StreamingCredentials> {
    console.log(`${T()} getOrCreateCredentials() called`);

    // Check if we already have valid credentials
    const fileExists = existsSync(CREDENTIALS_FILE);
    console.log(`${T()} Credentials file exists=${fileExists}`);

    if (fileExists) {
        try {
            const cached = JSON.parse(readFileSync(CREDENTIALS_FILE, 'utf-8'));
            // Verify moonlight-web is still running and credentials are valid
            const verifyStart = Date.now();
            console.log(`${T()} Verifying cached credentials: GET ${MOONLIGHT_API}/apps?host_id=${cached.hostId}`);
            const testResponse = await fetch(`${MOONLIGHT_API}/apps?host_id=${cached.hostId}`, {
                headers: { 'Cookie': `mlSession=${cached.token}` }
            });
            console.log(`${T()} Verification response: ok=${testResponse.ok}, status=${testResponse.status} (took ${Date.now() - verifyStart}ms)`);
            if (testResponse.ok) {
                console.log(`${T()} getOrCreateCredentials() complete (path=cached, took ${Date.now() - verifyStart}ms)`);
                return cached;
            }
        } catch (e) {
            console.log(`${T()} Cached credentials invalid: ${e}`);
        }
    }

    console.log(`${T()} Cache miss, starting full pairing flow`);
    const pairingStart = Date.now();

    // Step 1: Login to moonlight-web (creates user on first login)
    const step1Start = Date.now();
    console.log(`${T()} Step 1: POST ${MOONLIGHT_API}/login`);
    const loginResponse = await fetch(`${MOONLIGHT_API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ariana', password: STREAMING_PASSWORD })
    });
    console.log(`${T()} Step 1: POST /api/login done (took ${Date.now() - step1Start}ms, status=${loginResponse.status})`);

    if (!loginResponse.ok) {
        throw new Error(`Moonlight login failed: ${loginResponse.status}`);
    }

    // Extract session token from Set-Cookie header
    const cookies = loginResponse.headers.get('set-cookie') || '';
    const tokenMatch = cookies.match(/mlSession=([^;]+)/);
    if (!tokenMatch) {
        throw new Error('No session token in login response');
    }
    const token = tokenMatch[1];

    // Step 2: Add host (localhost:47989 is Sunshine)
    const step2Start = Date.now();
    console.log(`${T()} Step 2: POST ${MOONLIGHT_API}/host`);
    const addHostResponse = await fetch(`${MOONLIGHT_API}/host`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': `mlSession=${token}`
        },
        body: JSON.stringify({ address: 'localhost', port: 47989 })
    });
    console.log(`${T()} Step 2: POST /api/host done (took ${Date.now() - step2Start}ms, status=${addHostResponse.status})`);

    if (!addHostResponse.ok) {
        throw new Error(`Add host failed: ${addHostResponse.status}`);
    }

    const hostResult = await addHostResponse.json() as { host_id?: number };
    const hostId = hostResult.host_id;

    if (!hostId) {
        throw new Error('No host_id in add host response');
    }
    console.log(`${T()} Host added with ID: ${hostId}`);

    // Step 3: Start pairing (this is async - moonlight-web waits for PIN)
    console.log(`${T()} Step 3: POST ${MOONLIGHT_API}/pair (async)`);
    const pairPromise = fetch(`${MOONLIGHT_API}/pair`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': `mlSession=${token}`
        },
        body: JSON.stringify({ host_id: hostId })
    });

    // Wait a bit for PIN to be generated
    console.log(`${T()} Step 3: Sleeping 3000ms for PIN generation...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log(`${T()} Step 3: Sleep complete`);

    // Step 4: Extract PIN from moonlight-web's streaming response
    // The pair endpoint streams JSON objects, we need to parse the PIN
    const pairController = new AbortController();
    setTimeout(() => pairController.abort(), 30000); // 30s timeout

    let pin = '';
    const step4Start = Date.now();
    console.log(`${T()} Step 4: Extracting PIN from pair response (5s timeout)...`);
    try {
        // Read the pair response stream
        const pairResponse = await Promise.race([
            pairPromise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Pair timeout')), 5000))
        ]);

        const pairText = await pairResponse.text();
        const pinMatch = pairText.match(/"Pin":"(\d+)"/);
        if (pinMatch) {
            pin = pinMatch[1];
        }
        console.log(`${T()} Step 4: PIN extraction done (took ${Date.now() - step4Start}ms, pin=${pin ? 'found' : 'not_found'})`);
    } catch (e) {
        console.log(`${T()} Step 4: PIN extraction failed/timed out (took ${Date.now() - step4Start}ms), waiting 2s more...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (!pin) {
        throw new Error('Could not extract PIN from pairing response');
    }

    // Step 5: Submit PIN to Sunshine
    const step5Start = Date.now();
    console.log(`${T()} Step 5: POST https://localhost:47990/api/pin (pin=${pin})`);
    const sunshineResponse = await fetch('https://localhost:47990/api/pin', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`ariana:${STREAMING_PASSWORD}`).toString('base64')
        },
        body: JSON.stringify({ pin })
    });
    console.log(`${T()} Step 5: POST sunshine pin done (took ${Date.now() - step5Start}ms, status=${sunshineResponse.status})`);

    if (!sunshineResponse.ok) {
        console.log(`${T()} Step 5: Sunshine PIN response body:`, await sunshineResponse.text());
    }

    // Wait for pairing to complete
    console.log(`${T()} Step 6: Sleeping 5000ms for pairing completion...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log(`${T()} Step 6: Sleep complete`);

    // Step 7: Get app ID (Desktop app)
    const step7Start = Date.now();
    console.log(`${T()} Step 7: GET ${MOONLIGHT_API}/apps?host_id=${hostId}`);
    const appsResponse = await fetch(`${MOONLIGHT_API}/apps?host_id=${hostId}`, {
        headers: { 'Cookie': `mlSession=${token}` }
    });
    console.log(`${T()} Step 7: GET /api/apps done (took ${Date.now() - step7Start}ms, status=${appsResponse.status})`);

    if (!appsResponse.ok) {
        throw new Error(`Get apps failed: ${appsResponse.status}`);
    }

    const appsResult = await appsResponse.json() as { apps?: Array<{ app_id: number; title: string }> };
    const desktopApp = appsResult.apps?.find(a => a.title === 'Desktop');

    if (!desktopApp) {
        throw new Error('Desktop app not found in Sunshine');
    }

    const credentials: StreamingCredentials = {
        hostId,
        appId: desktopApp.app_id,
        token,
        xdotoolPort: 9091
    };

    // Cache credentials for future use
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));

    console.log(`${T()} getOrCreateCredentials() complete (path=paired, total pairing took ${Date.now() - pairingStart}ms)`);

    return credentials;
}

app.post('/', async (c) => {
    const t0 = Date.now();
    const T = () => `[Desktop-AS T+${Date.now() - t0}ms]`;
    console.log(`${T()} /desktop handler called`);

    const body = await c.req.json();
    const { valid, error } = await encryption.decryptAndValidate<{}>(body);

    if (!valid) {
        console.log('Invalid data in ' + c.req.path, "\nbody: ", body, "\nerror: ", error)
        return c.json({ error }, 400);
    }

    try {
        // Ensure all streaming services are running (start only if not active).
        // Don't restart — restarting causes race conditions with the
        // frontend trying to connect before services are fully ready.
        let anyStarted = false;
        const svcStart = Date.now();
        try {
            const services = ['moonlight-web', 'xdotool-server', 'sunshine', 'coturn'];
            for (const svc of services) {
                const svcCheckStart = Date.now();
                try {
                    execSync(`systemctl is-active --quiet ${svc}`, { encoding: 'utf8' });
                    console.log(`${T()} Service ${svc}=active (${Date.now() - svcCheckStart}ms)`);
                } catch {
                    console.log(`${T()} Service ${svc}=starting... (checked in ${Date.now() - svcCheckStart}ms)`);
                    execSync(`sudo systemctl start ${svc}`, { encoding: 'utf8' });
                    console.log(`${T()} Service ${svc} started (${Date.now() - svcCheckStart}ms total)`);
                    anyStarted = true;
                }
            }
        } catch (e) {
            console.log(`${T()} Service start warning:`, e);
        }
        console.log(`${T()} Services checked/started (total ${Date.now() - svcStart}ms, anyStarted=${anyStarted})`);

        // Only wait if we actually had to start something
        if (anyStarted) {
            console.log(`${T()} Sleeping 1000ms for service startup...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log(`${T()} Service startup sleep complete`);
        }

        // Get or create credentials
        const credentials = await getOrCreateCredentials(T);

        // Get server IP for the streaming URL
        const ipStart = Date.now();
        const serverIP = execSync("hostname -I | awk '{print $1}'", { encoding: 'utf8' }).trim();
        console.log(`${T()} hostname -I: ${serverIP} (took ${Date.now() - ipStart}ms)`);

        const response = {
            success: true,
            streamUrl: `http://${serverIP}:8090/stream.html?hostId=${credentials.hostId}&appId=${credentials.appId}&token=${credentials.token}`,
            hostId: credentials.hostId,
            appId: credentials.appId,
            token: credentials.token,
            xdotoolUrl: `http://${serverIP}:${credentials.xdotoolPort}`
        };

        console.log(`${T()} /desktop handler complete (total ${Date.now() - t0}ms)`);

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error(`${T()} Error:`, error);

        const errorResponse = {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to start desktop streaming'
        };

        const encryptedResponse = encryption.encrypt(errorResponse);
        return c.json({ encrypted: encryptedResponse });
    }
})

export default app;
