import { spawn, exec, execSync } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { SecureClient } from './client';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

const execAsync = promisify(exec);

// Agent server port - read from ARIANA_PORT environment variable
// This should be set at application entry point
if (!process.env.ARIANA_PORT) {
  console.warn('ARIANA_PORT not set, using default 8911. Set ARIANA_PORT to override.');
}
const AGENT_PORT = process.env.ARIANA_PORT || '8911';

// Error classification for retry logic
export enum ErrorType {
  TRANSIENT,    // Temporary errors that should be retried
  PERMANENT,    // Permanent errors that won't benefit from retry
  RATE_LIMITED  // Rate limit errors that need longer backoff
}

export interface ClassifiedError {
  type: ErrorType;
  message: string;
  originalError: Error;
}

function classifyError(error: Error): ClassifiedError {
  const errorMessage = error.message.toLowerCase();

  // Rate limit errors - need special handling with longer backoff
  if (errorMessage.includes('rate limit') ||
      errorMessage.includes('rate_limit_exceeded') ||
      errorMessage.includes('limit of') && errorMessage.includes('requests per hour')) {
    return {
      type: ErrorType.RATE_LIMITED,
      message: 'Rate limit exceeded, using extended backoff',
      originalError: error
    };
  }

  // Permanent errors
  if (errorMessage.includes('not found') ||
      errorMessage.includes('invalid') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('unauthorized') ||
      errorMessage.includes('forbidden') ||
      errorMessage.includes('quota exceeded') ||
      errorMessage.includes('limit reached')) {
    return {
      type: ErrorType.PERMANENT,
      message: 'Permanent configuration or quota error',
      originalError: error
    };
  }

  // Transient errors from Hetzner Cloud API
  if (errorMessage.includes('internal server error') ||
      errorMessage.includes('internal_server_error') ||
      errorMessage.includes('service unavailable') ||
      errorMessage.includes('gateway timeout') ||
      errorMessage.includes('connection refused') ||
      errorMessage.includes('connection reset') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('etimedout')) {
    return {
      type: ErrorType.TRANSIENT,
      message: 'Transient cloud provider error',
      originalError: error
    };
  }

  // Default to transient for unknown errors (be optimistic about retry)
  return {
    type: ErrorType.TRANSIENT,
    message: 'Unknown error, treating as transient',
    originalError: error
  };
}

export interface MachineInfo {
  name: string;
  ipv4: string;
  serverUrl: string; // http://<ip>:8911 or https URL if registered with cert-gateway
  url: string | null; // HTTPS URL via cert-gateway (e.g., https://abc123.a.ariana.dev)
  desktopUrl: string | null; // HTTPS URL for moonlight-web desktop streaming (e.g., https://abc123-desktop.a.ariana.dev)
  sharedKey: string; // Pre-generated key, server already running and healthy
  streamingToken: string | null; // Moonlight-web session token for iframe auth
  streamingHostId: string | null; // Moonlight-web host ID
  streamingAppId: string | null; // Moonlight-web app ID (desktop app)
}

export type MachineType = 'cx43';

export class MachineSDK {
  private scriptsDir: string;
  private creatorId: string | null = null;

  // Cache the resolved download URL to avoid hitting GitHub API for every machine creation.
  // Without this, every concurrent createMachine call fetches all releases from GitHub,
  // quickly exhausting the 60 req/hr unauthenticated rate limit.
  private cachedDownloadUrl: string | null = null;
  private cachedDownloadUrlTimestamp: number = 0;
  private static readonly DOWNLOAD_URL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private downloadUrlResolutionPromise: Promise<string> | null = null;

  constructor(scriptsDir?: string) {
    // Default to agents-server directory relative to this file
    this.scriptsDir = scriptsDir || join(__dirname, '..');

    // Get creator ID
    this.creatorId = this.getCreatorId();

    // Debug environment on startup
    console.log('MachineSDK initialized with environment:');
    console.log('  HOME:', process.env.HOME);
    console.log('  USER:', process.env.USER);
    console.log('  SSH keys present:', !!process.env.SSH_PUBLIC_KEY && !!process.env.SSH_PRIVATE_KEY);
  }

  private getCreatorId(): string {
    try {
      const creatorIdScript = join(this.scriptsDir, 'scripts/utilities/get-creator-id.sh');
      const result = execSync(`bash "${creatorIdScript}"`, { encoding: 'utf8' });
      return result.trim();
    } catch (error) {
      console.error('Failed to get creator ID:', error);
      return 'unknown';
    }
  }

  private generateSharedKey(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Resolve the agent-server binary download URL, with caching.
   * The GitHub API is called at most once per DOWNLOAD_URL_CACHE_TTL_MS.
   * Concurrent calls share the same in-flight promise to avoid duplicate requests.
   */
  private async resolveDownloadUrl(): Promise<string> {
    const GITHUB_REPO = 'ariana-dot-dev/agent-server';
    const PLATFORM = 'linux-x64';
    const BINARY_NAME = `ariana-agents-server-${PLATFORM}`;
    const CHANNEL = process.env.AGENTS_SERVER_CHANNEL;

    if (!CHANNEL) {
      return `https://github.com/${GITHUB_REPO}/releases/latest/download/${BINARY_NAME}`;
    }

    const now = Date.now();
    if (this.cachedDownloadUrl && (now - this.cachedDownloadUrlTimestamp) < MachineSDK.DOWNLOAD_URL_CACHE_TTL_MS) {
      return this.cachedDownloadUrl;
    }

    // If another call is already resolving, wait for it instead of making a duplicate request
    if (this.downloadUrlResolutionPromise) {
      return this.downloadUrlResolutionPromise;
    }

    this.downloadUrlResolutionPromise = (async () => {
      try {
        console.log(`Resolving download URL for channel: ${CHANNEL}`);
        let allReleases: { tag_name: string }[] = [];
        let page = 1;
        while (true) {
          const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100&page=${page}`);
          if (!res.ok) {
            throw new Error(`GitHub API returned ${res.status}: ${await res.text().catch(() => 'unknown')}`);
          }
          const releases = await res.json() as { tag_name: string }[];
          if (releases.length === 0) break;
          allReleases = allReleases.concat(releases);
          if (releases.length < 100) break;
          page++;
        }
        const matches = allReleases
          .filter(r => r.tag_name.includes(`-${CHANNEL}`))
          .sort((a, b) => {
            const numA = parseInt(a.tag_name.match(new RegExp(`-${CHANNEL}(\\d+)`))?.[1] || '0');
            const numB = parseInt(b.tag_name.match(new RegExp(`-${CHANNEL}(\\d+)`))?.[1] || '0');
            return numB - numA;
          });
        const match = matches[0];
        if (!match) throw new Error(`No release found for channel: ${CHANNEL}`);
        const url = `https://github.com/${GITHUB_REPO}/releases/download/${match.tag_name}/${BINARY_NAME}`;
        console.log(`Resolved download URL: ${url} (tag: ${match.tag_name})`);

        this.cachedDownloadUrl = url;
        this.cachedDownloadUrlTimestamp = Date.now();
        return url;
      } finally {
        this.downloadUrlResolutionPromise = null;
      }
    })();

    return this.downloadUrlResolutionPromise;
  }

  private isOwnMachine(machineName: string): boolean {
    return machineName.includes(`-${this.creatorId}-`) ||
      machineName.startsWith(`agents-server-${this.creatorId}-`);
  }

  private async runScript(scriptName: string, options: {
    args?: string[], timeout?: number, env?: Record<string, string>
  }): Promise<string> {
    console.log('Running script:', scriptName, 'with args:', options.args, 'and env:', options.env);

    if (!options.args) options.args = [];
    if (!options.timeout) options.timeout = 300000; // Default 5 min
    if (!options.env) options.env = {};

    const scriptPath = join(this.scriptsDir, scriptName);

    if (!existsSync(scriptPath)) {
      throw new Error(`Script not found: ${scriptPath}`);
    }

    // Debug environment
    console.log('DEBUG: Current process.env.HOME =', process.env.HOME);
    console.log('DEBUG: Current process.env.USER =', process.env.USER);
    console.log('DEBUG: Has SSH_PUBLIC_KEY =', !!process.env.SSH_PUBLIC_KEY);
    console.log('DEBUG: Has SSH_PRIVATE_KEY =', !!process.env.SSH_PRIVATE_KEY);

    return new Promise((resolve, reject) => {
      const mergedEnv = { ...process.env, ...options.env };
      console.log('DEBUG: Merged env HOME =', mergedEnv.HOME);

      const childProcess = spawn('bash', [scriptPath, ...options.args!], {
        cwd: this.scriptsDir,
        env: mergedEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data: Buffer) => {
        console.log('script stdout:', data.toString());
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        console.log('script stderr:', data.toString());
        stderr += data.toString();
      });

      const timeoutId = setTimeout(() => {
        childProcess.kill('SIGTERM');
        console.error(`Script ${scriptName} timed out after ${options.timeout}ms`);
        reject(new Error(`Script timeout after ${options.timeout!}ms`));
      }, options.timeout!);

      childProcess.on('exit', (code: number | null) => {
        console.log(`Script ${scriptName} exited with code ${code}`);
        clearTimeout(timeoutId);

        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Script failed with code ${code}: ${stderr || stdout}`));
        }
      });

      childProcess.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  private parseMachineInfo(name: string, ip: string, url: string | null = null, desktopUrl: string | null = null, sharedKey: string, streamingCredentials?: { token: string | null; hostId: string | null; appId: string | null }): MachineInfo {
    return {
      name,
      ipv4: ip,
      serverUrl: url || `http://${ip}:${AGENT_PORT}`,
      url,
      desktopUrl,
      sharedKey,
      streamingToken: streamingCredentials?.token || null,
      streamingHostId: streamingCredentials?.hostId || null,
      streamingAppId: streamingCredentials?.appId || null
    };
  }


  async createMachine(
    type: MachineType = 'cx43',
    maxRetries: number = 3
  ): Promise<MachineInfo | null> {
    const baseDelay = 2000; // Start with 2 seconds for transient errors
    const rateLimitBaseDelay = 5 * 60 * 1000; // Start with 5 minutes for rate limits

    // Pre-resolve the download URL before creating any Hetzner machines.
    // This is the step most likely to fail (GitHub API rate limits), and failing here
    // is free — no Hetzner machine has been created yet.
    try {
      await this.resolveDownloadUrl();
    } catch (error) {
      console.error(`Failed to resolve download URL, cannot create machine: ${(error as Error).message}`);
      return null;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let machineName: string | null = null;
      try {
        console.log(`Creating machine of type ${type} (attempt ${attempt}/${maxRetries})`);

        // Use create script to create machine (no server launch)
        const output = await this.runScript('scripts/utilities/create.sh', {
          timeout: 1000 * 60 * 10,
          env: { SERVER_TYPE: type }
        }); // 10 min timeout

        // Parse output to extract machine name, IP, and URL
        const ipMatch = output.match(/IP: ([\d.]+)/);
        const nameMatch = output.match(/Name: (.+)/);
        const urlMatch = output.match(/URL: (https:\/\/[^\s]+)/);
        const desktopUrlMatch = output.match(/DESKTOP_URL: (https:\/\/[^\s]+)/);

        if (!ipMatch || !nameMatch) {
          throw new Error('Could not extract IP and name from create output');
        }

        const ip = ipMatch[1];
        machineName = nameMatch[1].trim();
        const machineUrl = urlMatch ? urlMatch[1] : null;
        const desktopUrl = desktopUrlMatch ? desktopUrlMatch[1] : null;

        console.log(`[DESKTOP_URL_TRACE] create.sh output desktopUrlMatch: ${JSON.stringify(desktopUrlMatch)}, desktopUrl: ${desktopUrl}`);
        console.log(`Created machine ${machineName} at ${ip}${machineUrl ? ` (URL: ${machineUrl})` : ''} desktopUrl: ${desktopUrl || 'none'}`);

        // Prepare machine with all agent server dependencies
        console.log(`Preparing agent server dependencies on ${machineName}...`);
        await this.prepareAgentServerDependencies(ip);

        // Generate shared key and launch the server during parking
        // This moves all slow operations out of the claim path
        console.log(`Launching agent server on ${machineName}...`);
        const sharedKey = this.generateSharedKey();
        const streamingCredentials = await this.launchAgentServerForParking(ip, sharedKey, machineName, machineUrl);

        const machineInfo = this.parseMachineInfo(machineName, ip, machineUrl, desktopUrl, sharedKey, streamingCredentials);
        console.log(`[DESKTOP_URL_TRACE] machineInfo.desktopUrl: ${machineInfo.desktopUrl}, streamingToken: ${!!machineInfo.streamingToken}, hostId: ${machineInfo.streamingHostId}, appId: ${machineInfo.streamingAppId}`);
        console.log(`✅ Machine ${machineName} is fully prepared with server running`);

        return machineInfo;
      } catch (error) {
        const classifiedError = classifyError(error as Error);
        console.error(`Machine creation attempt ${attempt}/${maxRetries} failed:`, {
          errorType: ErrorType[classifiedError.type],
          message: classifiedError.message,
          details: (error as Error).message
        });

        // If a Hetzner machine was created but post-creation steps failed,
        // delete it immediately to prevent orphaned machines.
        if (machineName) {
          console.log(`Cleaning up failed machine ${machineName} from Hetzner...`);
          try {
            await this.deleteMachine(machineName);
            console.log(`Cleaned up failed machine ${machineName}`);
          } catch (cleanupError) {
            console.error(`Failed to clean up machine ${machineName}: ${(cleanupError as Error).message}`);
          }
        }

        // If it's a permanent error, don't retry
        if (classifiedError.type === ErrorType.PERMANENT) {
          console.error('Permanent error detected, stopping retries');
          return null;
        }

        // If this was the last attempt, give up
        if (attempt === maxRetries) {
          console.error('All retry attempts exhausted');
          return null;
        }

        // Calculate exponential backoff delay
        let delay: number;
        if (classifiedError.type === ErrorType.RATE_LIMITED) {
          // For rate limits: 5min, 10min, 20min, etc.
          delay = rateLimitBaseDelay * Math.pow(2, attempt - 1);
          console.log(`Rate limit hit. Waiting ${delay / 1000 / 60} minutes before retry...`);
        } else {
          // For transient errors: 2s, 4s, 8s, etc.
          delay = baseDelay * Math.pow(2, attempt - 1);
          console.log(`Waiting ${delay}ms before retry...`);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return null;
  }

  /**
   * Launch agent server during parking phase.
   * Uses static environment variables since we don't know the agent yet.
   * The MACHINE_ID is known from the create script output.
   */
  private async launchAgentServerForParking(ipv4: string, sharedKey: string, machineId: string, machineUrl: string | null = null): Promise<{ token: string | null; hostId: string | null; appId: string | null }> {
    const serverIP = ipv4;
    const INSTALL_DIR = '/opt/ariana-agent';

    console.log(`Launching agent server on ${serverIP} for parking...`);

    // Extract subdomain from machineUrl (e.g., https://frazil-pneuma-rallye.on.ariana.dev -> frazil-pneuma-rallye)
    const machineSubdomain = machineUrl
      ? machineUrl.replace(/^https?:\/\//, '').replace(/\.[^.]+\.ariana\.dev.*$/, '')
      : '';

    // SECURITY: CERT_GATEWAY_KEY is NO LONGER written to agent machines.
    // Port domain registration now proxies through backend API using agent's JWT.
    // This prevents key exposure to agents/users with sudo access.

    // Create .env file with static configuration (known at parking time)
    const envVars: Record<string, string> = {
      MACHINE_ID: machineId,
      SHARED_KEY: sharedKey,
      WORK_DIR: '/home/ariana',
      BACKEND_URL: process.env.API_URL || 'https://ariana.dev',
      ARIANA_PORT: AGENT_PORT,
      CLAUDE_PATH: '/usr/local/bin/claude',
      IS_SANDBOX: '1',
      // Machine metadata (needed for frontend display, not security-sensitive)
      ...(machineSubdomain && { MACHINE_SUBDOMAIN: machineSubdomain }),
      MACHINE_IP: ipv4,
    };

    const envContent = Object.entries(envVars)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    await this.runSSHCommand(serverIP, `
      cat > ${INSTALL_DIR}/.env << 'EOF'
${envContent}
EOF
      chmod 600 ${INSTALL_DIR}/.env
    `);

    // Create base image timestamp marker and capture base packages
    console.log('Creating base image timestamp marker and capturing base packages...');
    await this.runSSHCommand(serverIP, `
      touch /home/ariana/.base-image-timestamp
      chown ariana:ariana /home/ariana/.base-image-timestamp

      # Capture the list of apt packages in the base image
      dpkg --get-selections | grep -v deinstall | cut -f1 | sort > /home/ariana/.base-apt-packages.txt
      chown ariana:ariana /home/ariana/.base-apt-packages.txt

      # Capture the list of snap packages in the base image (if snapd is installed)
      if which snap >/dev/null 2>&1; then
        snap list | tail -n +2 | awk '{print $1}' | sort > /home/ariana/.base-snap-packages.txt
        chown ariana:ariana /home/ariana/.base-snap-packages.txt
      fi
    `);

    // Enable and start the service
    console.log('Starting agent server service...');
    await this.runSSHCommand(serverIP, `
      set -e
      systemctl enable ariana-agent
      systemctl restart ariana-agent
      echo "Service started"
    `);

    // Initialize desktop environment and moonlight streaming
    console.log('Initializing desktop environment and moonlight streaming...');
    await this.runSSHCommand(serverIP, `
      set -e

      # === Start lightdm desktop session ===
      systemctl restart lightdm
      sleep 5

      # === Fix X11 auth (copy Xauthority from lightdm to ariana) ===
      XAUTH_FILE=\$(find /var/run/lightdm -name "*:0" 2>/dev/null | head -1)
      if [ -n "\$XAUTH_FILE" ]; then
        cp "\$XAUTH_FILE" /home/ariana/.Xauthority
        chown ariana:ariana /home/ariana/.Xauthority
        chmod 600 /home/ariana/.Xauthority
      fi

      # === Disable screensavers and screen lock ===
      pkill -9 gnome-screensaver 2>/dev/null || true
      pkill -f light-locker 2>/dev/null || true
      loginctl unlock-sessions 2>/dev/null || true
      sudo -u ariana DISPLAY=:0 xset s off 2>/dev/null || true
      sudo -u ariana DISPLAY=:0 xset -dpms 2>/dev/null || true
      sudo -u ariana DISPLAY=:0 xset s noblank 2>/dev/null || true

      # === Start PulseAudio ===
      sudo -u ariana DISPLAY=:0 pulseaudio --start --exit-idle-time=-1 2>/dev/null || true
      sleep 1

      # === Generate Sunshine SSL certs + set credentials ===
      mkdir -p /home/ariana/.config/sunshine
      if [ ! -f /home/ariana/.config/sunshine/sunshine.key ]; then
        openssl req -x509 -newkey rsa:4096 -keyout /home/ariana/.config/sunshine/sunshine.key \\
          -out /home/ariana/.config/sunshine/sunshine.cert -days 3650 -nodes \\
          -subj "/CN=sunshine" 2>/dev/null
      fi
      chown -R ariana:ariana /home/ariana/.config/sunshine
      chmod 600 /home/ariana/.config/sunshine/*.key 2>/dev/null || true
      sudo -u ariana HOME=/home/ariana sunshine --creds ariana ariana 2>&1 || true

      # === Configure coturn with machine's public IP ===
      PUBLIC_IP=\$(curl -4 -s --connect-timeout 3 ifconfig.me 2>/dev/null || \\
                  curl -4 -s --connect-timeout 3 icanhazip.com 2>/dev/null || \\
                  curl -4 -s --connect-timeout 3 api.ipify.org 2>/dev/null)
      TURN_PASSWORD=\$(openssl rand -base64 18 | tr -dc 'a-zA-Z0-9')

      cat > /etc/turnserver.conf << TURNCONF
listening-port=3478
fingerprint
lt-cred-mech
user=moonlight:\$TURN_PASSWORD
realm=moonlight
external-ip=\$PUBLIC_IP
min-port=49152
max-port=65535
no-tls
no-dtls
no-cli
verbose
TURNCONF

      echo "\$TURN_PASSWORD" > /opt/moonlight-web/turn.password
      systemctl restart coturn
      systemctl enable coturn

      # === Write moonlight-web config with public IP + TURN ===
      MOONLIGHT_DIR="/opt/moonlight-web"
      ADMIN_PASSWORD=\$(openssl rand -hex 16)

      cat > "\$MOONLIGHT_DIR/server/config.json" << MLCONF
{
    "data_storage": {
        "type": "json",
        "path": "\$MOONLIGHT_DIR/server/data.json",
        "session_expiration_check_interval": {"secs": 300, "nanos": 0}
    },
    "web_server": {
        "bind_address": "0.0.0.0:8090",
        "first_login_create_admin": true,
        "first_login_assign_global_hosts": true,
        "session_cookie_expiration": {"secs": 31536000, "nanos": 0}
    },
    "webrtc": {
        "ice_servers": [
            {"urls": ["stun:stun.l.google.com:19302"]},
            {"urls": ["turn:\$PUBLIC_IP:3478"], "username": "moonlight", "credential": "\$TURN_PASSWORD"}
        ],
        "port_range": {"min": 49152, "max": 65535},
        "nat_1to1": {
            "ips": ["\$PUBLIC_IP"],
            "ice_candidate_type": "host"
        },
        "include_loopback_candidates": false
    },
    "moonlight": {"default_http_port": 47989},
    "streamer_path": "\$MOONLIGHT_DIR/streamer"
}
MLCONF

      cat > "\$MOONLIGHT_DIR/server/data.json" << 'STORCONF'
{"version": "2", "users": {}, "hosts": {}}
STORCONF

      # === Start Sunshine ===
      pkill -f sunshine 2>/dev/null || true
      sleep 2
      for i in 1 2 3 4 5 6 7 8 9 10; do
        if DISPLAY=:0 xset q > /dev/null 2>&1; then break; fi
        sleep 1
      done
      sudo -u ariana HOME=/home/ariana DISPLAY=:0 XAUTHORITY=/home/ariana/.Xauthority \\
        nohup sunshine > /tmp/sunshine.log 2>&1 &
      sleep 5

      # === Start moonlight-web and xdotool-server ===
      systemctl daemon-reload
      systemctl enable moonlight-web xdotool-server
      systemctl restart moonlight-web xdotool-server
      sleep 3

      # Wait for moonlight-web to be ready
      for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        if curl -s http://127.0.0.1:8090/ > /dev/null 2>&1; then break; fi
        sleep 1
      done

      # === Create admin session and perform pairing ===
      LOGIN_RESPONSE=\$(curl -s -i -X POST "http://127.0.0.1:8090/api/login" \\
        -H "Content-Type: application/json" \\
        -d "{\\"name\\":\\"admin\\",\\"password\\":\\"\$ADMIN_PASSWORD\\"}" 2>&1)

      SESSION_TOKEN=\$(echo "\$LOGIN_RESPONSE" | grep -i 'set-cookie.*mlSession' | sed 's/.*mlSession=\\([^;]*\\).*/\\1/' | tr -d '\\r\\n')

      # Wait for Sunshine API
      for i in 1 2 3 4 5 6 7 8 9 10; do
        if curl -s -k -u "ariana:ariana" "https://127.0.0.1:47990/api/apps" --connect-timeout 2 2>&1 | grep -q "apps\\|env"; then break; fi
        sleep 2
      done

      # Add Sunshine as host
      ADD_RESPONSE=\$(curl -s -X POST "http://127.0.0.1:8090/api/host" \\
        -H "Content-Type: application/json" \\
        -H "Cookie: mlSession=\$SESSION_TOKEN" \\
        -d '{"address":"127.0.0.1","http_port":47989}' 2>&1)

      HOST_ID=\$(echo "\$ADD_RESPONSE" | grep -o '"host_id":[0-9]*' | head -1 | cut -d: -f2)

      # Pair moonlight-web with Sunshine
      PAIRING_SUCCESS=false
      if [ -n "\$HOST_ID" ]; then
        for PAIR_ATTEMPT in 1 2 3; do
          PAIR_OUTPUT="/tmp/moonlight-pair-\$\$"
          rm -f "\$PAIR_OUTPUT"

          curl -s -N -X POST "http://127.0.0.1:8090/api/pair" \\
            -H "Content-Type: application/json" \\
            -H "Cookie: mlSession=\$SESSION_TOKEN" \\
            -d "{\\"host_id\\":\$HOST_ID}" > "\$PAIR_OUTPUT" 2>&1 &
          CURL_PID=\$!

          PIN=""
          for i in \$(seq 1 30); do
            if [ -f "\$PAIR_OUTPUT" ] && [ -s "\$PAIR_OUTPUT" ]; then
              FIRST_LINE=\$(head -1 "\$PAIR_OUTPUT" 2>/dev/null)
              if [ -n "\$FIRST_LINE" ]; then
                PIN=\$(echo "\$FIRST_LINE" | grep -oE '"Pin":"[0-9]+"' | cut -d'"' -f4)
                [ -z "\$PIN" ] && PIN=\$(echo "\$FIRST_LINE" | grep -oE '[0-9]{4}' | head -1)
                [ -n "\$PIN" ] && break
              fi
            fi
            sleep 0.5
          done

          if [ -z "\$PIN" ]; then
            kill \$CURL_PID 2>/dev/null || true
            sleep 2
            continue
          fi

          curl -s -k -u "ariana:ariana" -X POST "https://127.0.0.1:47990/api/pin" \\
            -H "Content-Type: application/json" \\
            -d "{\\"pin\\":\\"\$PIN\\",\\"name\\":\\"moonlight-web\\"}" \\
            --connect-timeout 5 --max-time 10 > /dev/null 2>&1

          for i in \$(seq 1 20); do
            kill -0 \$CURL_PID 2>/dev/null || break
            sleep 0.5
          done
          kill \$CURL_PID 2>/dev/null || true
          wait \$CURL_PID 2>/dev/null || true

          PAIR_RESULT=\$(cat "\$PAIR_OUTPUT" 2>/dev/null)
          if echo "\$PAIR_RESULT" | grep -q "Paired"; then
            PAIRING_SUCCESS=true
            break
          fi

          sleep 1
          HOST_STATUS=\$(curl -s "http://127.0.0.1:8090/api/host?host_id=\$HOST_ID" \\
            -H "Cookie: mlSession=\$SESSION_TOKEN" 2>&1)
          if echo "\$HOST_STATUS" | grep -q '"paired":"Paired"'; then
            PAIRING_SUCCESS=true
            break
          fi
          sleep 2
        done
        rm -f "\$PAIR_OUTPUT"
      fi

      # Get app list
      APP_ID=""
      if [ -n "\$HOST_ID" ]; then
        APPS_RESPONSE=\$(curl -s "http://127.0.0.1:8090/api/apps?host_id=\$HOST_ID" \\
          -H "Cookie: mlSession=\$SESSION_TOKEN" 2>&1)
        APP_ID=\$(echo "\$APPS_RESPONSE" | grep -o '"app_id":[0-9]*' | head -1 | cut -d: -f2)
        [ -z "\$APP_ID" ] && APP_ID="881448767"
      fi

      # Save streaming credentials (read back by machineSDK after setup completes)
      cat > /opt/moonlight-web/server/streaming-credentials.json << CREDEOF
{
  "hostId": \${HOST_ID:-0},
  "appId": \${APP_ID:-881448767},
  "token": "\$SESSION_TOKEN",
  "xdotoolPort": 9091
}
CREDEOF

      echo "\$SESSION_TOKEN" > /opt/moonlight-web/session.token
      echo "\$ADMIN_PASSWORD" > /opt/moonlight-web/admin.password
      echo "\$HOST_ID" > /opt/moonlight-web/host.id
      echo "\$APP_ID" > /opt/moonlight-web/app.id
      chmod 600 /opt/moonlight-web/session.token /opt/moonlight-web/admin.password

      # Final screensaver cleanup
      pkill -f gnome-screensaver 2>/dev/null || true
      loginctl unlock-sessions 2>/dev/null || true

      echo "Moonlight streaming setup complete (pairing: \$PAIRING_SUCCESS)"
    `);

    // Wait for server to become healthy
    console.log('Waiting for server to become healthy...');
    await this.waitForServerHealth(serverIP);

    // Read streaming credentials saved by the moonlight setup script
    console.log('Reading streaming credentials from machine...');
    let streamingCredentials: { token: string | null; hostId: string | null; appId: string | null } = { token: null, hostId: null, appId: null };
    try {
      const credOutput = await this.execSSHCommand(serverIP, 'cat /opt/moonlight-web/server/streaming-credentials.json 2>/dev/null || echo "{}"', 'root');
      const creds = JSON.parse(credOutput.trim());
      streamingCredentials = {
        token: creds.token || null,
        hostId: creds.hostId != null ? String(creds.hostId) : null,
        appId: creds.appId != null ? String(creds.appId) : null
      };
      console.log(`Streaming credentials read: hostId=${streamingCredentials.hostId}, appId=${streamingCredentials.appId}, hasToken=${!!streamingCredentials.token}`);
    } catch (err) {
      console.error('Failed to read streaming credentials (non-fatal):', err);
    }

    console.log(`Agent server launched and healthy on ${serverIP}`);
    return streamingCredentials;
  }

  async deleteMachine(name: string): Promise<void> {
    try {
      await this.runScript('scripts/utilities/delete-machine.sh', { args: [name] });
    } catch (error) {
      throw new Error(`Failed to delete machine ${name}: ${error}`);
    }
  }

  async deleteAllMachines(): Promise<void> {
    try {
      // Use expect to automatically confirm deletion
      console.log('Deleting all machines...');
      const childProcess = spawn('bash', ['-c', `echo "y" | ${join(this.scriptsDir, 'scripts/delete-all.sh')}`], {
        cwd: this.scriptsDir,
        stdio: 'inherit'
      });

      return new Promise((resolve, reject) => {
        childProcess.on('exit', (code: number | null) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Delete all failed with code ${code}`));
          }
        });

        childProcess.on('error', (error: Error) => reject(error));
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete all machines: ${errorMessage}`);
    }
  }


  /**
   * Send encrypted request to a machine.
   * @param target - Either a URL (https://...) or an IPv4 address
   * @param sharedKey - Encryption key for the machine
   * @param endpoint - API endpoint to call
   * @param data - Request body
   * @param timeoutMs - Optional timeout in milliseconds
   */
  async sendToMachine(target: string, sharedKey: string, endpoint: string, data: unknown, timeoutMs?: number): Promise<{ ok: boolean; data?: unknown }> {
    try {
      // If target is a URL, use it directly; otherwise construct from IP
      const serverUrl = target.startsWith('http') ? target : `http://${target}:${AGENT_PORT}`;

      // Use provided timeout or default to 4 minutes
      const timeout = timeoutMs || 240000;

      // Create secure client and send request
      const client = new SecureClient(sharedKey, serverUrl);

      try {
        const response = await client.sendSecureRequestWithTimeout(endpoint, data, timeout);
        return { ok: true, data: response };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        let dataStr = '<no data>'
        try {
          dataStr = JSON.stringify(data, null, 2)
        } catch (error) {
          dataStr = 'Error stringifying data'
        }
        console.error(`Failed to send to machine ${target}:`, errorMessage, '\non: ', endpoint, '\ndata: ', dataStr);
        return { ok: false, data: { error: errorMessage } };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error in sendToMachine for ${target}:`, errorMessage);
      return { ok: false, data: { error: errorMessage } };
    }
  }

  /**
   * Health check a machine (no encryption needed).
   * @param target - Either a URL (https://...) or an IPv4 address
   */
  async healthCheck(target: string): Promise<{ ok: boolean; data?: unknown }> {
    try {
      // If target is a URL, use it directly; otherwise construct from IP
      const serverUrl = target.startsWith('http') ? target : `http://${target}:${AGENT_PORT}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${serverUrl}/health`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return { ok: true, data };
      } else {
        return { ok: false, data: { error: `HTTP ${response.status}` } };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, data: { error: errorMessage } };
    }
  }

  /**
   * Prepare machine with agents-server binary and systemd service
   * This runs during pool creation, NOT during agent launch
   * Base image already has: Node.js, npm, GitHub CLI, Claude CLI, firewall
   * This only installs: agents-server binary, systemd service
   */
  private async prepareAgentServerDependencies(ipv4: string): Promise<void> {
    const serverIP = ipv4;
    const INSTALL_DIR = '/opt/ariana-agent';
    const DOWNLOAD_URL = await this.resolveDownloadUrl();

    console.log(`Preparing agent server on ${serverIP}...`);

    await this.runSSHCommand(serverIP, `
      set -e

      echo "=== Step 1: Downloading agents-server binary ==="
      echo "Download URL: ${DOWNLOAD_URL}"
      mkdir -p ${INSTALL_DIR}
      curl -L --fail --progress-bar "${DOWNLOAD_URL}" -o ${INSTALL_DIR}/ariana-agents-server || { echo "ERROR: Failed to download binary"; exit 1; }
      chmod +x ${INSTALL_DIR}/ariana-agents-server
      echo "✅ Binary downloaded and made executable"

      echo "=== Step 2: Setting up systemd service ==="
      # Give ariana ownership of install dir so it can read .env
      chown -R ariana:ariana ${INSTALL_DIR}

      # Ensure ariana has .ssh directory (may be missing from older snapshots)
      mkdir -p /home/ariana/.ssh
      chmod 700 /home/ariana/.ssh
      chown ariana:ariana /home/ariana/.ssh

      # Allow ariana to manage ariana-readonly's authorized_keys without password
      echo 'ariana ALL=(ariana-readonly) NOPASSWD: /bin/bash -c grep*' > /etc/sudoers.d/ariana-sshkey
      chmod 440 /etc/sudoers.d/ariana-sshkey

      cat > /etc/systemd/system/ariana-agent.service << 'SERVICEEOF'
[Unit]
Description=Ariana Agent Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ariana
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${INSTALL_DIR}/ariana-agents-server
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SERVICEEOF

      systemctl daemon-reload
      echo "✅ Systemd service created"

      echo "=== Step 3: Setting up bash prompt ==="
      echo 'git_prompt() { local branch=$(git branch 2>/dev/null | grep "*" | sed "s/* //"); [ -n "$branch" ] && echo "[$branch]"; }' >> /home/ariana/.bashrc
      echo "PS1='\\[\\e[32m\\]\\$(git_prompt)\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ '" >> /home/ariana/.bashrc
      echo "✅ Bash prompt configured"

      echo "=== Step 4: Fixing desktop environment permissions ==="
      # Ensure all ariana home directories have correct ownership
      # This is critical for GUI apps, theme settings, and file operations
      mkdir -p /home/ariana/Desktop /home/ariana/Downloads /home/ariana/Documents
      mkdir -p /home/ariana/.config/dconf /home/ariana/.config/gtk-3.0 /home/ariana/.config/gtk-4.0
      mkdir -p /home/ariana/.local/share/applications /home/ariana/.local/share/backgrounds
      mkdir -p /home/ariana/.cache
      touch /home/ariana/.Xauthority
      chown -R ariana:ariana /home/ariana
      echo "✅ Desktop environment permissions fixed"

      echo "=== Step 5: Giving ariana full ownership of dev tools ==="
      # ariana must have unlimited access to all dev tool directories
      # This covers Rust, Go, Gradle, Kotlin, Scala, CMake, and any future tools
      chown -R ariana:ariana /usr/local /opt 2>/dev/null || true
      echo "✅ Dev tools ownership fixed"

      echo "=== Step 6: Setting up Moonlight-web streaming ==="
      MOONLIGHT_DIR="/opt/moonlight-web"

      # Create moonlight-web config.json
      cat > "\$MOONLIGHT_DIR/server/config.json" << 'MLCONFIG'
{
  "data_storage": {
    "type": "json",
    "path": "/opt/moonlight-web/server/data.json",
    "session_expiration_check_interval": {"secs": 300, "nanos": 0}
  },
  "web_server": {
    "bind_address": "0.0.0.0:8090",
    "first_login_create_admin": true,
    "first_login_assign_global_hosts": true
  },
  "webrtc": {
    "ice_servers": [{"urls": ["stun:stun.l.google.com:19302"]}],
    "port_range": {"min": 49152, "max": 65535},
    "include_loopback_candidates": true
  },
  "moonlight": {"default_http_port": 47989},
  "streamer_path": "/opt/moonlight-web/streamer"
}
MLCONFIG

      # Create empty data.json (first login creates admin)
      cat > "\$MOONLIGHT_DIR/server/data.json" << 'MLDATA'
{"version": "2", "users": {}, "hosts": {}}
MLDATA

      echo "✅ Moonlight-web config created"

      echo "=== Step 6: Setting up xdotool HTTP server ==="
      # Create xdotool HTTP server for keyboard input (layout-independent)
      cat > "\$MOONLIGHT_DIR/xdotool-server.py" << 'XDOTOOLPY'
#!/usr/bin/env python3
"""
xdotool HTTP Server - Keyboard input and clipboard for moonlight-web streaming

Endpoints:
  POST /type      - Type text: {"text": "hello"}
  POST /key       - Send key combo: {"keys": "ctrl+c"}
  GET  /clipboard - Read remote clipboard (returns JSON: {"text": "..."})
  POST /clipboard - Write to remote clipboard: {"text": "..."}
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import subprocess
import json
import os

os.environ['DISPLAY'] = ':0'
os.environ['XAUTHORITY'] = '/home/ariana/.Xauthority'

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        try:
            if self.path == '/clipboard':
                result = subprocess.run(
                    ['xclip', '-selection', 'clipboard', '-o'],
                    env=os.environ, capture_output=True, timeout=5
                )
                text = result.stdout.decode('utf-8', errors='replace')

                self.send_response(200)
                self.send_cors_headers()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'text': text}).encode())
            else:
                self.send_response(404)
                self.send_cors_headers()
                self.end_headers()
        except Exception as e:
            self.send_response(500)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length)) if length else {}

            if self.path == '/type':
                text = data.get('text', '')
                if text:
                    subprocess.run(['xdotool', 'type', '--clearmodifiers', '--', text],
                        env=os.environ, timeout=5)
            elif self.path == '/key':
                keys = data.get('keys', '')
                if keys:
                    subprocess.run(['xdotool', 'key', '--clearmodifiers', keys],
                        env=os.environ, timeout=5)
            elif self.path == '/clipboard':
                text = data.get('text', '')
                proc = subprocess.Popen(
                    ['xclip', '-selection', 'clipboard'],
                    stdin=subprocess.PIPE, env=os.environ
                )
                proc.communicate(input=text.encode('utf-8'), timeout=5)

            self.send_response(200)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b'ok')
        except Exception as e:
            self.send_response(500)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(str(e).encode())

if __name__ == '__main__':
    print('xdotool-server listening on :9091')
    HTTPServer(('0.0.0.0', 9091), Handler).serve_forever()
XDOTOOLPY
      chmod +x "\$MOONLIGHT_DIR/xdotool-server.py"
      echo "✅ xdotool server created"

      echo "=== Step 7: Creating streaming systemd services ==="
      # Moonlight-web service
      cat > /etc/systemd/system/moonlight-web.service << 'MLSERVICE'
[Unit]
Description=Moonlight Web Streaming Server
After=network.target sunshine.service
Wants=sunshine.service

[Service]
Type=simple
WorkingDirectory=/opt/moonlight-web
ExecStart=/opt/moonlight-web/web-server --config-path /opt/moonlight-web/server/config.json
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
MLSERVICE

      # xdotool server service
      cat > /etc/systemd/system/xdotool-server.service << 'XDSERVICE'
[Unit]
Description=XDoTool HTTP Server
After=lightdm.service
Wants=lightdm.service

[Service]
Type=simple
Environment=DISPLAY=:0
Environment=PORT=9091
ExecStart=/usr/bin/python3 /opt/moonlight-web/xdotool-server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
XDSERVICE

      # Sunshine config for X11 capture
      mkdir -p /home/ariana/.config/sunshine
      cat > /home/ariana/.config/sunshine/sunshine.conf << 'SUNCONF'
capture = x11
encoder = software
min_threads = 4
SUNCONF
      chown -R ariana:ariana /home/ariana/.config/sunshine

      systemctl daemon-reload
      systemctl enable moonlight-web xdotool-server
      echo "✅ Streaming services configured"

      echo ""
      echo "=========================================="
      echo "✅ Agent server prepared successfully"
      echo "=========================================="
    `);

    console.log(`✅ Agent server prepared on ${serverIP}`);
  }

  /**
   * Launch agent server on a prepared machine
   * This runs when user creates an agent - should be FAST
   * Only creates machine-specific .env and starts the service
   */
  private async launchAgentServer(ipv4: string, sharedKey: string, environment: Record<string, string>): Promise<void> {
    const serverIP = ipv4;
    const INSTALL_DIR = '/opt/ariana-agent';

    console.log(`Launching agent server on ${serverIP}...`);

    // Step 1: Create .env file with machine-specific configuration
    console.log('Creating machine-specific .env file...');
    const envVars = {
      MACHINE_ID: environment.MACHINE_ID,
      SHARED_KEY: sharedKey,
      WORK_DIR: environment.WORK_DIR || '/root',
      ARIANA_PORT: AGENT_PORT,
      CLAUDE_PATH: '/usr/local/bin/claude',
      IS_SANDBOX: '1'
    };

    const envContent = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    await this.runSSHCommand(serverIP, `
      cat > ${INSTALL_DIR}/.env << 'EOF'
${envContent}
EOF
      chmod 600 ${INSTALL_DIR}/.env
    `);

    // Step 2: Create base image timestamp marker and capture base packages
    // This marks when the machine was provisioned from the base image
    // Used by snapshot system to only backup files changed since provision
    console.log('Creating base image timestamp marker and capturing base packages...');
    await this.runSSHCommand(serverIP, `
      touch /home/ariana/.base-image-timestamp
      chown ariana:ariana /home/ariana/.base-image-timestamp

      # Capture the list of apt packages in the base image
      # This is used by snapshot to detect user-installed packages
      dpkg --get-selections | grep -v deinstall | cut -f1 | sort > /home/ariana/.base-apt-packages.txt
      chown ariana:ariana /home/ariana/.base-apt-packages.txt

      # Capture the list of snap packages in the base image (if snapd is installed)
      if which snap >/dev/null 2>&1; then
        snap list | tail -n +2 | awk '{print $1}' | sort > /home/ariana/.base-snap-packages.txt
        chown ariana:ariana /home/ariana/.base-snap-packages.txt
      fi
    `);

    // Step 3: Enable and start the service
    console.log('Starting agent server service...');
    await this.runSSHCommand(serverIP, `
      set -e
      systemctl enable ariana-agent
      systemctl restart ariana-agent
      echo "Service started"
    `);

    // Step 4: Initialize desktop environment and streaming services
    console.log('Initializing desktop environment and streaming...');
    await this.runSSHCommand(serverIP, `
      set -e
      # Start lightdm for desktop session
      systemctl restart lightdm
      sleep 3

      # Fix X11 auth for Sunshine (copy lightdm's Xauthority to ariana)
      XAUTH_FILE=\$(find /var/run/lightdm -name "*:0" 2>/dev/null | head -1)
      if [ -n "\$XAUTH_FILE" ]; then
        cp "\$XAUTH_FILE" /home/ariana/.Xauthority
        chown ariana:ariana /home/ariana/.Xauthority
      fi

      # Start streaming services
      systemctl restart sunshine
      sleep 2
      systemctl restart moonlight-web
      systemctl restart xdotool-server
    `);

    // Step 5: Wait for server to become healthy
    console.log('Waiting for server to become healthy...');
    await this.waitForServerHealth(serverIP);

    console.log(`✅ Agent server launched on ${serverIP}`);
  }

  private async scpFile(serverIP: string, localPath: string, remotePath: string): Promise<void> {
    const scpCommand = `scp -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "${localPath}" root@${serverIP}:"${remotePath}"`;

    console.log(`SCP file: ${localPath} -> ${serverIP}:${remotePath}`);

    return new Promise((resolve, reject) => {
      const childProcess = spawn('bash', ['-c', scpCommand], {
        cwd: this.scriptsDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SCP failed with code ${code}: ${stderr}`));
        }
      });

      childProcess.on('error', (err) => {
        reject(new Error(`SCP process error: ${err.message}`));
      });
    });
  }

  private async runSSHCommand(serverIP: string, command: string): Promise<void> {
    // Use stdin to pass the script to avoid command-line parsing issues
    // This is more reliable for complex multi-line scripts with quotes, heredocs, etc.
    const sshCommand = `ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${serverIP} 'bash -s'`;

    console.log(`Running SSH command: ${sshCommand}`);
    console.log(`Script preview (first 200 chars): ${command.substring(0, 200)}...`);

    const childProcess = spawn('bash', ['-c', sshCommand], {
      cwd: this.scriptsDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Write the script to stdin
    childProcess.stdin?.write(command);
    childProcess.stdin?.end();

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        console.log(`SSH stdout: ${output}`);
        stdout += output;
      });

      childProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        console.log(`SSH stderr: ${output}`);
        stderr += output;
      });

      childProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SSH command failed with code ${code}. Stdout: ${stdout}. Stderr: ${stderr}`));
        }
      });

      childProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Execute an SSH command on a server and return the output
   * SSHs as root, then runs command as specified user via sudo
   */
  async execSSHCommand(serverIP: string, command: string, user: string = 'ariana'): Promise<string> {
    // SSH as root, run command as specified user
    const wrappedCommand = user === 'root' ? command : `sudo -u ${user} bash -c '${command.replace(/'/g, "'\\''")}'`;
    const sshCommand = `ssh -i "$HOME/.ssh/id_ed25519" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${serverIP} 'bash -s'`;

    const childProcess = spawn('bash', ['-c', sshCommand], {
      cwd: this.scriptsDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    childProcess.stdin?.write(wrappedCommand);
    childProcess.stdin?.end();

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('exit', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`SSH command failed with code ${code}. Stdout: ${stdout}. Stderr: ${stderr}`));
        }
      });

      childProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  private async waitForServerHealth(serverIP: string): Promise<void> {
    console.log('Waiting for service to start...');

    for (let i = 1; i <= 30; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        const response = await fetch(`http://${serverIP}:${AGENT_PORT}/health`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          console.log(`✅ Service is healthy on http://${serverIP}:${AGENT_PORT}`);
          return;
        }
      } catch (error) {
        // Health check failed, continue waiting
        if (i % 5 === 0) {
          console.log(`Health check error: ${error instanceof Error ? error.message : 'unknown'}`);
        }
      }

      if (i === 30) {
        // Get logs for debugging
        try {
          await this.runSSHCommand(serverIP, 'journalctl -u ariana-agent -n 50 --no-pager');
        } catch (logError) {
          console.error('Failed to get logs:', logError);
        }
        throw new Error('Service failed to start within 30 seconds');
      }

      console.log(`Attempt ${i}/30: Waiting for service...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  async ensureSSHKey(): Promise<void> {
    try {
      console.log('Ensuring SSH key is set up...');
      await this.runScript('scripts/utilities/ensure-ssh-key.sh', {});
      console.log('SSH key setup completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to ensure SSH key: ${errorMessage}`);
    }
  }
}

// Export singleton instance
export const machineSDK = new MachineSDK();