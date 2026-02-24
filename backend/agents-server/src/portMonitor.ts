import { exec } from 'child_process';
import { promisify } from 'util';
import * as certGateway from './certGateway';

const execAsync = promisify(exec);

export interface PortInfo {
  port: number;
  protocol: 'tcp' | 'udp';
  pid: number;
  program: string;
  state: string;
  visibility: 'private' | 'public';
  listenAddress: string; // e.g., "0.0.0.0", "127.0.0.1", "::"
  isDocker: boolean;
  url?: string; // HTTPS URL via cert-gateway (e.g., https://abc-123-8000.on.ariana.dev)
}

let cachedPorts: PortInfo[] = [];
let isScanning = false;
let scanInterval: Timer | null = null;

// Track how many consecutive scans a port has been missing
// Key: "port:protocol:listenAddress"
const portMissCount = new Map<string, number>();
const MISS_THRESHOLD = 3; // Remove port after missing this many consecutive scans

// Track ports that have been registered with cert-gateway
const registeredPorts = new Set<number>();

export function markPortRegistered(port: number): void {
  registeredPorts.add(port);
}

export function markPortUnregistered(port: number): void {
  registeredPorts.delete(port);
}

function getPortKey(port: PortInfo): string {
  return `${port.port}:${port.protocol}:${port.listenAddress}`;
}

async function checkUfwStatus(port: number): Promise<'private' | 'public'> {
  try {
    // Check if port is allowed in ufw
    const { stdout } = await execAsync(`sudo ufw status | grep ${port}`, { timeout: 2000 });

    // If port appears in ufw status, it's public
    if (stdout.trim()) {
      return 'public';
    }
  } catch (error) {
    // No output or error means port is not in ufw rules (private)
  }

  return 'private';
}

interface DockerContainer {
  id: string;
  name: string;
  ports: number[];
}

async function getDockerContainers(): Promise<DockerContainer[]> {
  try {
    const { stdout } = await execAsync(
      'docker ps --format "{{.ID}}|{{.Names}}|{{.Ports}}"',
      { timeout: 3000 }
    );

    const containers: DockerContainer[] = [];
    const lines = stdout.trim().split('\n').filter(l => l);

    for (const line of lines) {
      const [id, name, portsStr] = line.split('|');

      // Parse ports from format like "0.0.0.0:3000->3000/tcp, 0.0.0.0:8080->8080/tcp"
      const portMatches = portsStr.matchAll(/0\.0\.0\.0:(\d+)->/g);
      const ports: number[] = [];
      for (const match of portMatches) {
        ports.push(parseInt(match[1]));
      }

      containers.push({ id, name, ports });
    }

    return containers;
  } catch (error) {
    // Docker might not be installed or no containers running
    return [];
  }
}

function stabilizePorts(newPorts: PortInfo[]): PortInfo[] {
  // Create a map of newly scanned ports by their key
  const newPortsMap = new Map<string, PortInfo>();
  for (const port of newPorts) {
    newPortsMap.set(getPortKey(port), port);
  }

  // Start with existing cached ports
  const stabilized: PortInfo[] = [];
  const seenKeys = new Set<string>();

  // Process all cached ports
  for (const cachedPort of cachedPorts) {
    const key = getPortKey(cachedPort);
    const newPort = newPortsMap.get(key);

    if (newPort) {
      // Port still exists, reset miss count and use new data
      portMissCount.delete(key);
      stabilized.push(newPort);
      seenKeys.add(key);
    } else {
      // Port missing in new scan
      const missCount = (portMissCount.get(key) || 0) + 1;
      portMissCount.set(key, missCount);

      if (missCount < MISS_THRESHOLD) {
        // Keep the port for now
        stabilized.push(cachedPort);
        seenKeys.add(key);
      } else {
        // Port has been missing too long, remove it
        portMissCount.delete(key);
      }
    }
  }

  // Add any new ports that weren't in cache
  newPortsMap.forEach((port, key) => {
    if (!seenKeys.has(key)) {
      stabilized.push(port);
      portMissCount.delete(key);
    }
  });

  return stabilized;
}

async function scanPorts(): Promise<PortInfo[]> {
  try {
    // Get docker containers first
    const dockerContainers = await getDockerContainers();

    // Detect OS and available tools
    let isMacOS = process.platform === 'darwin';
    let hasNetstat = false;

    if (!isMacOS) {
      try {
        const { stdout: unameOutput } = await execAsync('uname -s', { timeout: 1000 });
        isMacOS = unameOutput.trim() === 'Darwin';
      } catch {
        // Can't detect OS, continue
      }
    }

    // Try to find available port scanning tool
    let command: string;
    if (isMacOS) {
      command = 'lsof -i -P -n | grep LISTEN';
    } else {
      // Check if ss is available
      try {
        await execAsync('which ss', { timeout: 1000 });
        command = 'ss -tulpn | grep LISTEN';
      } catch {
        // ss not available, try netstat
        try {
          await execAsync('which netstat', { timeout: 1000 });
          command = 'netstat -tulpn | grep LISTEN';
          hasNetstat = true;
        } catch {
          // Neither ss nor netstat available, return empty
          console.warn('[PortMonitor] Neither ss nor netstat available, port scanning disabled');
          return [];
        }
      }
    }

    const { stdout } = await execAsync(command, { timeout: 3000 });

    const ports: PortInfo[] = [];
    const lines = stdout.trim().split('\n').filter(l => l);

    // Infrastructure ports to filter out (SSH, agent-server, and streaming services)
    const FILTERED_PORTS = [
      22,    // SSH
      631,   // CUPS (printing)
      3478,  // coturn TURN relay
      4369,  // epmd (Erlang port mapper)
      8090,  // moonlight-web
      8911,  // agent-server
      9091,  // xdotool-server
      47984, // Sunshine RTSP
      47989, // Sunshine HTTP API
      47990, // Sunshine HTTPS API
    ];
    // Also filter Sunshine streaming UDP range and TURN relay range
    const FILTERED_RANGES = [
      [47998, 48010],  // Sunshine streaming
      [49152, 65535],  // TURN relay ports
    ];

    for (const line of lines) {
      let protocol: string;
      let listenAddress: string;
      let portNum: number;
      let program: string;
      let pid: number;
      let isDocker = false;

      if (isMacOS) {
        // Parse lsof output: node      1234  user   25u  IPv4  0x...      0t0  TCP *:8080 (LISTEN)
        // or: node      1234  user   25u  IPv6  0x...      0t0  TCP [::1]:8080 (LISTEN)
        // Note: IPv6 addresses are wrapped in brackets like [::1], so we need to handle both formats
        const lsofMatch = line.match(/^(\S+)\s+(\d+)\s+\S+\s+\S+\s+(IPv[46])\s+\S+\s+\S+\s+(\w+)\s+(\[.+?\]|[^:]+):(\d+)\s+\(LISTEN\)/);
        if (!lsofMatch) continue;

        program = lsofMatch[1];
        pid = parseInt(lsofMatch[2]);
        protocol = lsofMatch[4].toLowerCase(); // TCP -> tcp
        listenAddress = lsofMatch[5] === '*' ? '0.0.0.0' : lsofMatch[5];
        portNum = parseInt(lsofMatch[6]);
      } else if (hasNetstat) {
        // Parse netstat output: tcp        0      0 0.0.0.0:8080            0.0.0.0:*               LISTEN      1234/program
        // IPv6 format: tcp6       0      0 :::8080                 :::*                    LISTEN      1234/program
        const netstatMatch = line.match(/^(\w+)\s+\d+\s+\d+\s+(\[.+?\]|[^:]+):(\d+)\s+\S+\s+LISTEN\s+(\d+)\/(.+)/);

        if (!netstatMatch) {
          // Try without PID/program: tcp        0      0 0.0.0.0:8080            0.0.0.0:*               LISTEN
          const simpleMatch = line.match(/^(\w+)\s+\d+\s+\d+\s+(\[.+?\]|[^:]+):(\d+)\s+\S+\s+LISTEN/);
          if (!simpleMatch) continue;

          [, protocol, listenAddress, ] = simpleMatch;
          portNum = parseInt(simpleMatch[3]);
          pid = 0;
          program = 'unknown';
        } else {
          [, protocol, listenAddress, , , program] = netstatMatch;
          portNum = parseInt(netstatMatch[3]);
          pid = parseInt(netstatMatch[4]);
        }
      } else {
        // Parse ss output with users info: tcp   LISTEN 0  128  0.0.0.0:8080  0.0.0.0:*  users:(("bun",pid=1234,fd=3))
        // IPv6 format: tcp   LISTEN 0  511  [::1]:5173  [::]:*  users:(("MainThread",pid=389236,fd=25))
        // Note: IPv6 addresses are wrapped in brackets like [::1], so we use (\[.+?\]|[^:]+) to match either
        const matchWithUsers = line.match(/^(\w+)\s+\w+\s+\d+\s+\d+\s+(\[.+?\]|[^:]+):(\d+)\s+.*users:\(\("([^"]+)",pid=(\d+)/);

        // Parse ss output without users info: tcp   LISTEN 0  4096  0.0.0.0:3000  0.0.0.0:*
        // IPv6 format: tcp   LISTEN 0  4096  [::]:6379  [::]:*
        const matchWithoutUsers = !matchWithUsers ? line.match(/^(\w+)\s+\w+\s+\d+\s+\d+\s+(\[.+?\]|[^:]+):(\d+)/) : null;

        if (matchWithUsers) {
          [, protocol, listenAddress, , program, ] = matchWithUsers;
          portNum = parseInt(matchWithUsers[3]);
          pid = parseInt(matchWithUsers[5]);
        } else if (matchWithoutUsers) {
          [, protocol, listenAddress, ] = matchWithoutUsers;
          portNum = parseInt(matchWithoutUsers[3]);

          // Check if this port is from a Docker container
          const dockerContainer = dockerContainers.find(c => c.ports.includes(portNum));
          if (dockerContainer) {
            program = dockerContainer.name;
            pid = 0;
            isDocker = true;
          } else {
            program = 'server';
            pid = 0;
          }
        } else {
          continue;
        }
      }

      // Check if this port is from a Docker container
      if (!isDocker) {
        const dockerContainer = dockerContainers.find(c => c.ports.includes(portNum));
        if (dockerContainer) {
          isDocker = true;
        }
      }

      // Filter out infrastructure ports
      if (FILTERED_PORTS.includes(portNum) || FILTERED_RANGES.some(([min, max]) => portNum >= min && portNum <= max)) {
        continue;
      }

      const visibility = await checkUfwStatus(portNum);

      ports.push({
        port: portNum,
        protocol: protocol.toLowerCase() as 'tcp' | 'udp',
        pid,
        program,
        state: 'LISTEN',
        visibility,
        listenAddress,
        isDocker
      });
    }

    return ports;
  } catch (error) {
    console.error('[PortMonitor] Scan failed:', error);
    return [];
  }
}

export async function startPortMonitor(): Promise<void> {
  console.log('[PortMonitor] Starting...');

  scanInterval = setInterval(async () => {
    if (isScanning) return;

    isScanning = true;
    try {
      const newPorts = await scanPorts();
      cachedPorts = stabilizePorts(newPorts);
      await syncCertGatewayRegistrations(cachedPorts);
    } finally {
      isScanning = false;
    }
  }, 5000);

  // Initial scan
  const initialPorts = await scanPorts();
  cachedPorts = stabilizePorts(initialPorts);
  await syncCertGatewayRegistrations(cachedPorts);
}

/**
 * Sync cert-gateway registrations with current port state.
 * - Register public ports that aren't registered yet
 * - Unregister ports that disappeared from the list
 */
async function syncCertGatewayRegistrations(ports: PortInfo[]): Promise<void> {
  if (!certGateway.isConfigured()) return;

  const currentPublicPorts = new Set(
    ports
      .filter(p => p.visibility === 'public' && (p.listenAddress === '0.0.0.0' || p.listenAddress === '::'))
      .map(p => p.port)
  );

  // Register new public ports
  for (const port of currentPublicPorts) {
    if (!registeredPorts.has(port)) {
      const ok = await certGateway.registerPortSubdomain(port);
      if (ok) registeredPorts.add(port);
    }
  }

  // Unregister ports that are no longer in the list (service stopped)
  const currentPortNumbers = new Set(ports.map(p => p.port));
  for (const port of registeredPorts) {
    if (!currentPortNumbers.has(port)) {
      const ok = await certGateway.unregisterPortSubdomain(port);
      if (ok) registeredPorts.delete(port);
    }
  }
}

export function stopPortMonitor(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
}

export function getOpenPorts(): PortInfo[] {
  return cachedPorts.map(p => ({
    ...p,
    url: (registeredPorts.has(p.port) && p.visibility === 'public')
      ? certGateway.getPortUrl(p.port) ?? undefined
      : undefined,
  }));
}
