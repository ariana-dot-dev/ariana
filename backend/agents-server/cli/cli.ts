#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { platform } from 'os';

const VERSION = '1.0.0';
const INSTALL_DIR = '/opt/ariana-agent';
const SERVICE_NAME_LINUX = 'ariana-agent';
const SERVICE_NAME_DARWIN = 'com.ariana.agent';

// Colors for output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function printError(message: string): void {
  console.error(`${colors.red}❌ Error: ${message}${colors.reset}`);
}

function printSuccess(message: string): void {
  console.log(`${colors.green}✅ ${message}${colors.reset}`);
}

function printInfo(message: string): void {
  console.log(`${colors.blue}ℹ️  ${message}${colors.reset}`);
}

function printWarning(message: string): void {
  console.log(`${colors.yellow}⚠️  ${message}${colors.reset}`);
}

function isRoot(): boolean {
  if (!process.getuid) {
    throw new Error('process.getuid is not available - this platform is not supported');
  }
  return process.getuid() === 0;
}

function requireRoot(command: string): void {
  if (!isRoot()) {
    printError(`The '${command}' command requires root privileges`);
    console.log(`Please run with sudo: sudo ariana ${command}`);
    process.exit(1);
  }
}

function getOS(): 'linux' | 'darwin' | 'unsupported' {
  const os = platform();
  if (os === 'linux') return 'linux';
  if (os === 'darwin') return 'darwin';
  return 'unsupported';
}

function checkServiceExists(): boolean {
  const os = getOS();

  try {
    if (os === 'linux') {
      execSync('systemctl list-unit-files ariana-agent.service', { stdio: 'pipe' });
      return true;
    } else if (os === 'darwin') {
      const result = execSync('launchctl list', { encoding: 'utf-8' });
      return result.includes(SERVICE_NAME_DARWIN);
    }
  } catch {
    return false;
  }

  return false;
}

function installNodeJs(): void {
  printInfo('Checking Node.js/npm installation...');

  // Check if npm is already installed
  try {
    execSync('npm --version', { stdio: 'pipe' });
    const nodeVersion = execSync('node --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    printSuccess(`Node.js/npm already installed (${nodeVersion})`);
    return;
  } catch {
    // npm not installed, proceed with installation
  }

  printInfo('Installing Node.js/npm...');

  const os = getOS();

  if (os === 'linux') {
    // Detect Linux distribution
    let distro = 'unknown';
    try {
      const osRelease = readFileSync('/etc/os-release', 'utf-8');
      const idMatch = osRelease.match(/^ID=(.+)$/m);
      if (idMatch) {
        distro = idMatch[1].replace(/"/g, '').trim();
      }
    } catch {
      printWarning('Cannot detect Linux distribution - skipping Node.js installation');
      printWarning('Please install Node.js manually: https://nodejs.org/');
      return;
    }

    if (distro === 'ubuntu' || distro === 'debian') {
      printInfo('Installing Node.js via apt...');
      try {
        execSync('curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -', { stdio: 'inherit' });
        execSync('apt-get install -y nodejs', { stdio: 'inherit' });
      } catch (error) {
        printError('Failed to install Node.js');
        printWarning('Please install manually: https://nodejs.org/');
        return;
      }
    } else if (distro === 'centos' || distro === 'rhel' || distro === 'fedora') {
      printInfo('Installing Node.js via yum/dnf...');
      try {
        execSync('curl -fsSL https://rpm.nodesource.com/setup_lts.x | bash -', { stdio: 'inherit' });
        try {
          execSync('yum install -y nodejs', { stdio: 'inherit' });
        } catch {
          execSync('dnf install -y nodejs', { stdio: 'inherit' });
        }
      } catch (error) {
        printError('Failed to install Node.js');
        printWarning('Please install manually: https://nodejs.org/');
        return;
      }
    } else {
      printWarning(`Unsupported Linux distribution: ${distro}`);
      printWarning('Please install Node.js manually: https://nodejs.org/');
      return;
    }
  } else if (os === 'darwin') {
    try {
      execSync('brew --version', { stdio: 'pipe' });
      printInfo('Installing Node.js via Homebrew...');
      execSync('brew install node', { stdio: 'inherit' });
    } catch {
      printWarning('Homebrew not found');
      printWarning('Please install Node.js manually: https://nodejs.org/');
      return;
    }
  }

  // Verify installation
  try {
    execSync('npm --version', { stdio: 'pipe' });
    const nodeVersion = execSync('node --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    printSuccess(`Node.js/npm installed (${nodeVersion})`);
  } catch {
    printWarning('Node.js/npm installation may have failed');
    printWarning('Please install manually: https://nodejs.org/');
  }
}

function installGit(): void {
  printInfo('Checking git installation...');

  // Check if git is already installed
  try {
    execSync('git --version', { stdio: 'pipe' });
    const gitVersion = execSync('git --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    printSuccess(`Git already installed (${gitVersion})`);
    return;
  } catch {
    // git not installed, proceed with installation
  }

  printInfo('Installing git...');

  const os = getOS();

  if (os === 'linux') {
    // Detect Linux distribution
    let distro = 'unknown';
    try {
      const osRelease = readFileSync('/etc/os-release', 'utf-8');
      const idMatch = osRelease.match(/^ID=(.+)$/m);
      if (idMatch) {
        distro = idMatch[1].replace(/"/g, '').trim();
      }
    } catch {
      printWarning('Cannot detect Linux distribution - skipping git installation');
      printWarning('Please install git manually: https://git-scm.com/');
      return;
    }

    if (distro === 'ubuntu' || distro === 'debian') {
      printInfo('Installing git via apt...');
      try {
        execSync('apt-get update -qq', { stdio: 'pipe' });
        execSync('apt-get install -y -qq git', { stdio: 'pipe' });
      } catch (error) {
        printError('Failed to install git');
        printWarning('Please install manually: https://git-scm.com/');
        return;
      }
    } else if (distro === 'centos' || distro === 'rhel' || distro === 'fedora') {
      printInfo('Installing git via yum...');
      try {
        execSync('yum install -y -q git', { stdio: 'pipe' });
      } catch (error) {
        printError('Failed to install git');
        printWarning('Please install manually: https://git-scm.com/');
        return;
      }
    } else {
      printWarning(`Unsupported Linux distribution: ${distro}`);
      printWarning('Please install git manually: https://git-scm.com/');
      return;
    }
  } else if (os === 'darwin') {
    try {
      execSync('brew --version', { stdio: 'pipe' });
      printInfo('Installing git via Homebrew...');
      execSync('brew install git', { stdio: 'inherit' });
    } catch {
      printWarning('Homebrew not found');
      printWarning('Please install git manually: https://git-scm.com/');
      return;
    }
  }

  // Verify installation
  try {
    execSync('git --version', { stdio: 'pipe' });
    const gitVersion = execSync('git --version', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    printSuccess(`Git installed (${gitVersion})`);
  } catch {
    printWarning('Git installation may have failed');
    printWarning('Please install manually: https://git-scm.com/');
  }
}

function installClaudeCode(): string {
  printInfo('Checking Claude Code CLI installation...');

  // Check if already installed
  try {
    execSync('claude --version', { stdio: 'pipe' });
    const claudePath = execSync('which claude', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    printSuccess(`Claude Code CLI already installed`);
    printInfo(`Claude path: ${claudePath}`);

    // Create symlink at /usr/local/bin/claude if not already there
    if (claudePath !== '/usr/local/bin/claude' && !existsSync('/usr/local/bin/claude')) {
      try {
        printInfo('Creating symlink: /usr/local/bin/claude -> ' + claudePath);
        execSync(`ln -sf "${claudePath}" /usr/local/bin/claude`, { stdio: 'pipe' });
        return '/usr/local/bin/claude';
      } catch {
        // Symlink creation failed, use original path
        return claudePath;
      }
    }
    return claudePath;
  } catch {
    // Claude not installed, proceed with installation
  }

  // Check for npm (should be installed by installNodeJs)
  try {
    execSync('npm --version', { stdio: 'pipe' });
  } catch {
    printWarning('npm not found - cannot install Claude Code CLI automatically');
    printWarning('Please install Node.js/npm first, then run: npm install -g @anthropic-ai/claude-code');
    return '/usr/local/bin/claude'; // Return default path
  }

  printInfo('Installing Claude Code CLI via npm...');
  try {
    execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' });
  } catch (error) {
    printWarning('Claude Code CLI installation may have failed');
    printWarning('Please install manually: npm install -g @anthropic-ai/claude-code');
    return '/usr/local/bin/claude'; // Return default path
  }

  try {
    const claudePath = execSync('which claude', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    printSuccess(`Claude Code CLI installed at: ${claudePath}`);

    // Create symlink at /usr/local/bin/claude if not already there
    if (claudePath !== '/usr/local/bin/claude' && !existsSync('/usr/local/bin/claude')) {
      try {
        printInfo('Creating symlink: /usr/local/bin/claude -> ' + claudePath);
        execSync(`ln -sf "${claudePath}" /usr/local/bin/claude`, { stdio: 'pipe' });
        return '/usr/local/bin/claude';
      } catch {
        // Symlink creation failed, use original path
        return claudePath;
      }
    }
    return claudePath;
  } catch {
    printWarning('Claude Code CLI installation may have failed');
    return '/usr/local/bin/claude'; // Return default path
  }
}

async function installAgentServerBinary(): Promise<void> {
  printInfo('Installing Ariana Agent Server binary...');

  const os = getOS();
  if (os === 'unsupported') {
    printError('Unsupported operating system');
    process.exit(1);
  }

  // Detect architecture
  let arch: string;
  try {
    arch = execSync('uname -m', { encoding: 'utf-8' }).trim();
  } catch {
    printError('Failed to detect system architecture');
    process.exit(1);
  }

  let platform: string;
  if (os === 'linux' && arch === 'x86_64') {
    platform = 'linux-x64';
  } else if (os === 'linux' && (arch === 'aarch64' || arch === 'arm64')) {
    platform = 'linux-arm64';
  } else if (os === 'darwin' && arch === 'x86_64') {
    platform = 'darwin-x64';
  } else if (os === 'darwin' && arch === 'arm64') {
    platform = 'darwin-arm64';
  } else {
    printError(`Unsupported platform: ${os}-${arch}`);
    process.exit(1);
  }

  const binaryName = `ariana-agents-server-${platform}`;
  const downloadUrl = `https://github.com/ariana-dot-dev/agent-server/releases/latest/download/${binaryName}`;

  printInfo(`Downloading ${binaryName}...`);

  // Create install directory
  try {
    execSync(`mkdir -p ${INSTALL_DIR}`, { stdio: 'pipe' });
  } catch (error) {
    printError('Failed to create installation directory');
    process.exit(1);
  }

  // Download binary
  try {
    execSync(`curl -L --fail --progress-bar "${downloadUrl}" -o ${INSTALL_DIR}/ariana-agents-server`, { stdio: 'inherit' });
    execSync(`chmod +x ${INSTALL_DIR}/ariana-agents-server`, { stdio: 'pipe' });
    printSuccess('Agent server binary downloaded');
  } catch (error) {
    printError('Failed to download agent server binary');
    process.exit(1);
  }

  // Create systemd service or launchd plist
  if (os === 'linux') {
    printInfo('Creating systemd service...');
    const serviceContent = `[Unit]
Description=Ariana Agent Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${INSTALL_DIR}/ariana-agents-server
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

    try {

      writeFileSync(`/etc/systemd/system/${SERVICE_NAME_LINUX}.service`, serviceContent, 'utf-8');
      execSync('systemctl daemon-reload', { stdio: 'pipe' });
      execSync(`systemctl enable ${SERVICE_NAME_LINUX}`, { stdio: 'pipe' });
      printSuccess('Systemd service created');
    } catch (error) {
      printError('Failed to create systemd service');
      process.exit(1);
    }
  } else if (os === 'darwin') {
    printInfo('Creating launchd service...');

    // Create wrapper script to load .env file
    const wrapperScript = `#!/bin/bash
set -a
source ${INSTALL_DIR}/.env
set +a
exec ${INSTALL_DIR}/ariana-agents-server
`;

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME_DARWIN}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${INSTALL_DIR}/start.sh</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>StandardOutPath</key>
    <string>/var/log/ariana-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/var/log/ariana-agent.log</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
`;

    try {

      writeFileSync(`${INSTALL_DIR}/start.sh`, wrapperScript, 'utf-8');
      execSync(`chmod +x ${INSTALL_DIR}/start.sh`, { stdio: 'pipe' });
      writeFileSync(`/Library/LaunchDaemons/${SERVICE_NAME_DARWIN}.plist`, plistContent, 'utf-8');
      printSuccess('Launchd service created');
    } catch (error) {
      printError('Failed to create launchd service');
      process.exit(1);
    }
  }

  printSuccess('Agent server binary installed');
}

async function updateAgentServer(): Promise<void> {
  requireRoot('update');

  printInfo('Updating Ariana Agent Server...');

  if (!checkServiceExists()) {
    printError('Agent server is not installed');
    console.log('Please install the agent server first with: ariana connect --token <your-token>');
    process.exit(1);
  }

  const os = getOS();

  // Check if service is running
  let wasRunning = false;
  try {
    if (os === 'linux') {
      const status = execSync(`systemctl is-active ${SERVICE_NAME_LINUX}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
      wasRunning = status === 'active';
    } else if (os === 'darwin') {
      const list = execSync(`launchctl list ${SERVICE_NAME_DARWIN}`, { encoding: 'utf-8', stdio: 'pipe' });
      wasRunning = list.includes(SERVICE_NAME_DARWIN);
    }
  } catch {
    wasRunning = false;
  }

  // Stop service if running
  if (wasRunning) {
    printInfo('Stopping agent server...');
    try {
      if (os === 'linux') {
        execSync(`systemctl stop ${SERVICE_NAME_LINUX}`, { stdio: 'pipe' });
      } else if (os === 'darwin') {
        execSync(`launchctl stop ${SERVICE_NAME_DARWIN}`, { stdio: 'pipe' });
      }
      printSuccess('Agent server stopped');
    } catch (error) {
      printWarning('Failed to stop service, continuing anyway...');
    }
  }

  // Detect architecture
  let arch: string;
  try {
    arch = execSync('uname -m', { encoding: 'utf-8' }).trim();
  } catch {
    printError('Failed to detect system architecture');
    process.exit(1);
  }

  let platform: string;
  if (os === 'linux' && arch === 'x86_64') {
    platform = 'linux-x64';
  } else if (os === 'linux' && (arch === 'aarch64' || arch === 'arm64')) {
    platform = 'linux-arm64';
  } else if (os === 'darwin' && arch === 'x86_64') {
    platform = 'darwin-x64';
  } else if (os === 'darwin' && arch === 'arm64') {
    platform = 'darwin-arm64';
  } else {
    printError(`Unsupported platform: ${os}-${arch}`);
    process.exit(1);
  }

  const binaryName = `ariana-agents-server-${platform}`;
  const downloadUrl = `https://github.com/ariana-dot-dev/agent-server/releases/latest/download/${binaryName}`;

  printInfo(`Downloading latest version...`);

  // Download binary
  try {
    execSync(`curl -L --fail --progress-bar "${downloadUrl}" -o ${INSTALL_DIR}/ariana-agents-server`, { stdio: 'inherit' });
    execSync(`chmod +x ${INSTALL_DIR}/ariana-agents-server`, { stdio: 'pipe' });
    printSuccess('Agent server updated');
  } catch (error) {
    printError('Failed to download new version');
    process.exit(1);
  }

  // Restart service if it was running
  if (wasRunning) {
    printInfo('Restarting agent server...');
    try {
      if (os === 'linux') {
        execSync(`systemctl start ${SERVICE_NAME_LINUX}`, { stdio: 'pipe' });
      } else if (os === 'darwin') {
        execSync(`launchctl start ${SERVICE_NAME_DARWIN}`, { stdio: 'pipe' });
      }
      printSuccess('Agent server restarted');
    } catch (error) {
      printWarning('Failed to restart service, please start manually');
    }
  }

  printSuccess('Update complete!');
}

function startService(): void {
  requireRoot('start');

  const os = getOS();

  if (!checkServiceExists()) {
    printError('Agent server is not installed');
    console.log('Please install the agent server first');
    process.exit(1);
  }

  try {
    if (os === 'linux') {
      execSync(`systemctl start ${SERVICE_NAME_LINUX}`, { stdio: 'inherit' });
      printSuccess('Agent server started');
    } else if (os === 'darwin') {
      execSync(`launchctl start ${SERVICE_NAME_DARWIN}`, { stdio: 'inherit' });
      printSuccess('Agent server started');
    }
  } catch (error) {
    printError('Failed to start agent server');
    process.exit(1);
  }
}

function stopService(): void {
  requireRoot('stop');

  const os = getOS();

  if (!checkServiceExists()) {
    printError('Agent server is not installed');
    process.exit(1);
  }

  try {
    if (os === 'linux') {
      execSync(`systemctl stop ${SERVICE_NAME_LINUX}`, { stdio: 'inherit' });
      printSuccess('Agent server stopped');
    } else if (os === 'darwin') {
      execSync(`launchctl stop ${SERVICE_NAME_DARWIN}`, { stdio: 'inherit' });
      printSuccess('Agent server stopped');
    }
  } catch (error) {
    printError('Failed to stop agent server');
    process.exit(1);
  }
}

function restartService(): void {
  requireRoot('restart');

  const os = getOS();

  if (!checkServiceExists()) {
    printError('Agent server is not installed');
    console.log('Please install the agent server first');
    process.exit(1);
  }

  try {
    if (os === 'linux') {
      execSync(`systemctl restart ${SERVICE_NAME_LINUX}`, { stdio: 'inherit' });
      printSuccess('Agent server restarted');
    } else if (os === 'darwin') {
      execSync(`launchctl kickstart -k system/${SERVICE_NAME_DARWIN}`, { stdio: 'inherit' });
      printSuccess('Agent server restarted');
    }
  } catch (error) {
    printError('Failed to restart agent server');
    process.exit(1);
  }
}

function showLogs(lines?: number): void {
  const os = getOS();

  if (!checkServiceExists()) {
    printError('Agent server is not installed');
    process.exit(1);
  }

  try {
    if (os === 'linux') {
      const lineArg = lines ? `-n ${lines}` : '';
      execSync(`journalctl -u ${SERVICE_NAME_LINUX} ${lineArg} --no-pager`, { stdio: 'inherit' });
    } else if (os === 'darwin') {
      const logFile = '/var/log/ariana-agent.log';
      if (existsSync(logFile)) {
        const lineArg = lines ? `-n ${lines}` : '';
        execSync(`tail ${lineArg} ${logFile}`, { stdio: 'inherit' });
      } else {
        printWarning('Log file not found');
      }
    }
  } catch (error) {
    printError('Failed to read logs');
    process.exit(1);
  }
}

function followLogs(): void {
  const os = getOS();

  if (!checkServiceExists()) {
    printError('Agent server is not installed');
    process.exit(1);
  }

  printInfo('Following logs (press Ctrl+C to stop)...');

  try {
    if (os === 'linux') {
      execSync(`journalctl -u ${SERVICE_NAME_LINUX} -f`, { stdio: 'inherit' });
    } else if (os === 'darwin') {
      const logFile = '/var/log/ariana-agent.log';
      if (existsSync(logFile)) {
        execSync(`tail -f ${logFile}`, { stdio: 'inherit' });
      } else {
        printWarning('Log file not found');
      }
    }
  } catch (error) {
    // User pressed Ctrl+C or other interruption
    console.log('');
  }
}

async function checkHealth(): Promise<void> {
  printInfo('Checking agent server health...');

  // Read port from .env file
  const envPath = `${INSTALL_DIR}/.env`;
  let port = '8911'; // default

  if (existsSync(envPath)) {
    try {
      const envContent = readFileSync(envPath, 'utf-8');
      const portMatch = envContent.match(/ARIANA_PORT=(\d+)/);
      if (portMatch) {
        port = portMatch[1];
      }
    } catch {
      // Use default port
    }
  }

  try {
    const response = await fetch(`http://localhost:${port}/health`);

    if (response.ok) {
      const data = await response.json();
      printSuccess('Agent server is healthy');
      console.log(`  Status: ${data.status}`);
      console.log(`  Uptime: ${Math.floor(data.uptime / 60)} minutes`);
      console.log(`  Port: ${port}`);
    } else {
      printError(`Health check failed (HTTP ${response.status})`);
      process.exit(1);
    }
  } catch (error) {
    printError('Agent server is not responding');
    console.log(`  Make sure the service is running on port ${port}`);
    process.exit(1);
  }
}

function showStatus(): void {
  const os = getOS();

  if (!checkServiceExists()) {
    printInfo('Agent server is not installed');
    console.log('Please install the agent server first');
    return;
  }

  try {
    if (os === 'linux') {
      execSync(`systemctl status ${SERVICE_NAME_LINUX}`, { stdio: 'inherit' });
    } else if (os === 'darwin') {
      const result = execSync(`launchctl list ${SERVICE_NAME_DARWIN}`, { encoding: 'utf-8' });
      console.log(result);
    }
  } catch (error) {
    printWarning('Service status unavailable');
  }
}

function showEnv(): void {
  if (!checkServiceExists()) {
    printError('Agent server is not installed');
    console.log('Please install the agent server first');
    process.exit(1);
  }

  const envPath = `${INSTALL_DIR}/.env`;

  if (!existsSync(envPath)) {
    printError('Environment file not found');
    console.log(`Expected location: ${envPath}`);
    process.exit(1);
  }

  try {
    const envContent = readFileSync(envPath, 'utf-8');
    const lines = envContent.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));

    printInfo('Agent Server Environment Variables:');
    console.log('');

    if (lines.length === 0) {
      printWarning('No environment variables found');
      return;
    }

    lines.forEach(line => {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=');

      if (key && value !== undefined) {
        // Mask sensitive values
        let displayValue = value;
        if (key === 'SHARED_KEY' || key === 'MACHINE_TOKEN') {
          displayValue = value.substring(0, 8) + '***';
        }

        console.log(`  ${colors.blue}${key}${colors.reset}=${displayValue}`);
      }
    });

    console.log('');
    console.log(`Environment file: ${envPath}`);
  } catch (error) {
    printError('Failed to read environment file');
    process.exit(1);
  }
}

async function connectAgent(token: string): Promise<void> {
  requireRoot('connect');

  printInfo('Connecting agent server to Ariana...');

  // Install dependencies first
  printInfo('Installing dependencies...');

  // Install git (required for git operations)
  installGit();

  // Install Node.js/npm (required for Claude Code CLI)
  installNodeJs();

  // Install Claude Code CLI
  const claudePath = installClaudeCode();

  // Check if agent server is installed, if not, install it first
  if (!checkServiceExists()) {
    printInfo('Agent server not found, installing...');
    await installAgentServerBinary();
  }

  const envPath = `${INSTALL_DIR}/.env`;

  // Read current environment to get machine specs
  let currentEnv: Record<string, string> = {};
  if (existsSync(envPath)) {
    try {
      const envContent = readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          currentEnv[key.trim()] = valueParts.join('=').trim();
        }
      });
    } catch (error) {
      // If we can't read the env file, we'll continue with detection
    }
  }

  // Detect machine specs
  const os = getOS();
  let hostname: string;
  let cpuCount: number;
  let memoryGB: number;
  let osVersion: string;
  let arch: string;
  let publicIP: string;

  try {
    hostname = execSync('hostname', { encoding: 'utf-8' }).trim();

    if (os === 'darwin') {
      cpuCount = parseInt(execSync('sysctl -n hw.ncpu', { encoding: 'utf-8' }).trim(), 10);
      const memoryBytes = parseInt(execSync('sysctl -n hw.memsize', { encoding: 'utf-8' }).trim(), 10);
      memoryGB = Math.floor(memoryBytes / 1024 / 1024 / 1024);
      osVersion = `macOS ${execSync('sw_vers -productVersion', { encoding: 'utf-8' }).trim()}`;
      arch = execSync('uname -m', { encoding: 'utf-8' }).trim();
    } else {
      cpuCount = parseInt(execSync('nproc', { encoding: 'utf-8' }).trim(), 10);
      memoryGB = parseInt(execSync('free -g | awk \'/^Mem:/{print $2}\'', { encoding: 'utf-8', shell: '/bin/bash' }).trim(), 10);
      osVersion = execSync('cat /etc/os-release | grep PRETTY_NAME | cut -d\'"\' -f2', { encoding: 'utf-8', shell: '/bin/bash' }).trim();
      arch = execSync('uname -m', { encoding: 'utf-8' }).trim();
    }

    // Try to get public IP
    try {
      publicIP = execSync('curl -4 -s --max-time 5 ifconfig.me', { encoding: 'utf-8' }).trim();
    } catch {
      publicIP = 'unknown';
    }
  } catch (error) {
    printError('Failed to detect machine specs');
    process.exit(1);
  }

  const port = currentEnv['ARIANA_PORT'] || '8911';
  const apiUrl = process.env.API_URL || 'https://ariana.dev';

  // Register machine
  printInfo('Registering machine with Ariana API...');

  const registrationData = {
    registrationToken: token,
    machineInfo: {
      name: hostname,
      os: osVersion,
      arch: arch,
      cpuCount: cpuCount,
      memoryGB: memoryGB,
      publicIP: publicIP,
      port: parseInt(port, 10)
    }
  };

  try {
    const response = await fetch(`${apiUrl}/api/machines/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(registrationData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      printError(`Registration failed (HTTP ${response.status})`);
      console.log(`Response: ${errorText}`);
      process.exit(1);
    }

    const data = await response.json();
    const machineId = data.machineId;
    const sharedKey = data.sharedKey;

    if (!machineId || !sharedKey) {
      printError('Invalid response from API - missing machineId or sharedKey');
      process.exit(1);
    }

    printSuccess(`Machine registered: ${machineId}`);

    // Update .env file
    printInfo('Updating environment configuration...');

    const workDir = currentEnv['WORK_DIR'] || process.env.HOME || '/root';

    const newEnvContent = `MACHINE_ID=${machineId}
SHARED_KEY=${sharedKey}
ARIANA_PORT=${port}
WORK_DIR=${workDir}
CLAUDE_PATH=${claudePath}
IS_SANDBOX=1
`;

    try {

      writeFileSync(envPath, newEnvContent, 'utf-8');
      printSuccess('Configuration updated');
    } catch (error) {
      printError('Failed to update environment file');
      process.exit(1);
    }

    // Restart service to pick up new configuration
    printInfo('Restarting agent server...');
    try {
      if (os === 'linux') {
        execSync(`systemctl restart ${SERVICE_NAME_LINUX}`, { stdio: 'inherit' });
      } else if (os === 'darwin') {
        execSync(`launchctl kickstart -k system/${SERVICE_NAME_DARWIN}`, { stdio: 'inherit' });
      }
      printSuccess('Agent server restarted with new configuration');
    } catch (error) {
      printWarning('Failed to restart service - please restart manually');
    }

    console.log('');
    printSuccess('Connection complete!');
    console.log(`Machine ID: ${machineId}`);
    console.log(`The machine should now appear in your Ariana app`);

  } catch (error) {
    printError('Failed to connect to Ariana API');
    if (error instanceof Error) {
      console.log(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

function showHelp(): void {
  console.log(`
Ariana Agent Server CLI - v${VERSION}

USAGE:
  ariana <command> [options]

COMMANDS:
  connect --token <token>       Install (if needed) and connect agent server to Ariana
  start                         Start the agent server service
  stop                          Stop the agent server service
  restart                       Restart the agent server service
  update                        Update agent server to the latest version
  status                        Show service status
  env                           Show environment variables
  health                        Check if the agent server is responding
  logs [-n <lines>]            Show recent logs (default: all)
  follow-logs                   Follow logs in real-time
  version                       Show CLI version
  help                          Show this help message

ENVIRONMENT VARIABLES:
  MACHINE_ID          Machine ID assigned during registration (auto-set)
  SHARED_KEY          Shared authentication key (auto-set)
  ARIANA_PORT         Port for the agent server (default: 8911)
  WORK_DIR            Directory for cloning repos and running agents
  CLAUDE_PATH         Path to Claude CLI executable
  API_URL             Ariana API URL (default: https://ariana.dev)
`);
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  showHelp();
  process.exit(0);
}

const command = args[0];

(async () => {
  switch (command) {
    case 'start':
      startService();
      break;

    case 'stop':
      stopService();
      break;

    case 'restart':
      restartService();
      break;

    case 'update':
      await updateAgentServer();
      break;

    case 'connect': {
      const tokenIndex = args.indexOf('--token');
      if (tokenIndex === -1 || !args[tokenIndex + 1]) {
        printError('Token is required for connect command');
        console.log('Usage: ariana connect --token <your-token>');
        console.log('\nGet your token from: https://app.ariana.dev/settings/machines');
        process.exit(1);
      }
      const token = args[tokenIndex + 1];
      await connectAgent(token);
      break;
    }

    case 'status':
      showStatus();
      break;

    case 'env':
      showEnv();
      break;

    case 'health':
      await checkHealth();
      break;

    case 'logs': {
      const nIndex = args.indexOf('-n');
      const lines = nIndex !== -1 && args[nIndex + 1] ? parseInt(args[nIndex + 1], 10) : undefined;
      showLogs(lines);
      break;
    }

    case 'follow-logs':
      followLogs();
      break;

    case 'version':
      console.log(`Ariana CLI v${VERSION}`);
      break;

    case 'help':
    case '-h':
    case '--help':
      showHelp();
      break;

    default:
      printError(`Unknown command: ${command}`);
      console.log('Run "ariana help" to see available commands');
      process.exit(1);
  }
})();
