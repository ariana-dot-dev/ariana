import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import start from './handlers/start'
import claudeState from './handlers/claudeState';
import conversations from './handlers/conversations';
import prompt from './handlers/prompt';
import interrupt from './handlers/interrupt';
import reset from './handlers/reset';
import gitState from './handlers/gitState';
import gitStatus from './handlers/gitStatus';
import gitCommit from './handlers/gitCommit';
import gitReset from './handlers/gitReset';
import gitPush from './handlers/gitPush';
import sshkey from './handlers/sshkey';
import uploadProjectChunk from './handlers/uploadProjectChunk';
import uploadProjectFinalize from './handlers/uploadProjectFinalize';
import ports from './handlers/ports';
import portVisibility from './handlers/portVisibility';
import gitHistory from './handlers/gitHistory';
import getClaudeDir from './handlers/getClaudeDir';
import generateCommitName from './handlers/generateCommitName';
import generateBranchName from './handlers/generateBranchName';
import generateTaskSummary from './handlers/generateTaskSummary';
import renameBranchFromPrompt from './handlers/renameBranchFromPrompt';
import updateCredentials from './handlers/updateCredentials';
import updateSecrets from './handlers/updateSecrets';
import updateEnvironment from './handlers/updateEnvironment';
import updateGithubToken from './handlers/updateGithubToken';
import generateSshKeypair from './handlers/generateSshKeypair';
import authorizeSshKey from './handlers/authorizeSshKey';
import deploySshIdentityKeys from './handlers/deploySshIdentityKeys';
import reportAutomationEvent from './handlers/reportAutomationEvent';
import pollAutomationEvents from './handlers/pollAutomationEvents';
import pollAutomationActions from './handlers/pollAutomationActions';
import pollContextEvents from './handlers/pollContextEvents';
import triggerManualAutomation from './handlers/triggerManualAutomation';
import executeAutomations from './handlers/executeAutomations';
import stopAutomation from './handlers/stopAutomation';
import writeAutomationLogs from './handlers/writeAutomationLogs';
import createSnapshot from './handlers/createSnapshot';
import restoreSnapshot from './handlers/restoreSnapshot';
import desktop from './handlers/desktop';
import updateArianaToken from './handlers/updateArianaToken';
import ralphModeSetup from './handlers/ralphModeSetup';
import ralphModeCheckLock from './handlers/ralphModeCheckLock';
import servicePreview from './handlers/servicePreview';
import { startPortMonitor, stopPortMonitor } from './portMonitor';
import { metricsCollector } from './metricsCollector';
import { globalState } from './agentsState';
import { ClaudeService, type SDKMessage } from './claudeService';
import { existsSync, readFileSync } from 'fs';
import { getDefaultProjectDir } from './utils/paths';

// Conversation state file path (same as in createSnapshot.ts)
const CONVERSATION_STATE_FILE = '/home/ariana/.ariana/conversation-state.json';

/**
 * Auto-restore Claude service after service restart.
 * This handles the case where systemd restarts the service but /start is never called again.
 * Without this, the agent would be stuck with "Claude service not initialized".
 */
async function autoRestoreClaudeServiceIfNeeded(): Promise<void> {
  // Only try to restore if we haven't been initialized yet
  if (globalState.claudeService !== null) {
    console.log('[AUTO-RESTORE] Claude service already initialized, skipping');
    return;
  }

  // Check if conversation state file exists (indicates previous session)
  if (!existsSync(CONVERSATION_STATE_FILE)) {
    console.log('[AUTO-RESTORE] No conversation state file found, skipping auto-restore');
    return;
  }

  // Check if project directory exists
  const projectDir = getDefaultProjectDir();
  if (!existsSync(projectDir)) {
    console.log('[AUTO-RESTORE] Project directory does not exist, skipping auto-restore');
    return;
  }

  console.log('[AUTO-RESTORE] Found conversation state file, auto-restoring Claude service...');

  try {
    // Read and parse the conversation state
    const stateContent = readFileSync(CONVERSATION_STATE_FILE, 'utf-8');
    const state = JSON.parse(stateContent) as {
      messages: Array<{ uuid: string; data: SDKMessage }>;
      pastConversations: SDKMessage[];
      initialInstructions: string;
      sessionId?: string | null;
    };

    // Initialize ClaudeService and restore state
    globalState.claudeService = new ClaudeService();
    globalState.claudeService.restoreState(state);
    globalState.projectDir = projectDir;
    globalState.claudeReadyForPrompt = true;

    console.log(`[AUTO-RESTORE] Claude service restored successfully with ${state.messages.length} messages`);
    console.log(`[AUTO-RESTORE] Project directory: ${projectDir}`);

    // Note: We don't delete the state file here - it should be preserved for subsequent restarts
    // The file will be updated on next snapshot

  } catch (error) {
    console.error('[AUTO-RESTORE] Failed to restore Claude service:', error);
    // Don't crash - the backend will eventually notice and handle the error state
  }
}

// Validate required environment variables at startup
const requiredEnvVars = ['MACHINE_ID', 'SHARED_KEY', 'WORK_DIR'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingEnvVars.join(', ')}`);
  console.error('Please ensure these are set in your service configuration.');
  process.exit(1);
}

console.log(`AGENT_ID= ${process.env.MACHINE_ID}`);
console.log(`SHARED_KEY= ${process.env.SHARED_KEY?.substring(0, 3)}... (length: ${process.env.SHARED_KEY?.length})`);
console.log(`WORK_DIR= ${process.env.WORK_DIR}`);

const isLocal = process.argv.length >= 2 ? process.argv[1] == '--local' : false;

const app = new Hono()

// Middleware — custom logger that skips high-frequency polling endpoints to prevent journal bloat
const QUIET_PATHS = new Set([
  '/claude-state', '/conversations', '/poll-automation-events',
  '/poll-context-events', '/poll-automation-actions', '/ports',
  '/health',
]);
app.use('*', async (c, next) => {
  const path = c.req.path;
  if (QUIET_PATHS.has(path)) {
    await next();
    return;
  }
  // Log non-polling requests using hono logger
  return logger()(c, next);
})
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 3600,
  credentials: true
}))

// Track endpoint calls for metrics
app.use('*', async (c, next) => {
  const startTime = Date.now();
  const method = c.req.method;
  const path = c.req.path;

  await next();

  const endTime = Date.now();
  const statusCode = c.res.status;
  const endpoint = `${method} ${path}`;

  metricsCollector.trackEndpointCall(endpoint, startTime, endTime, statusCode);
})

app.route('/start', start)
app.route('/claude-state', claudeState);
app.route('/conversations', conversations);
app.route('/prompt', prompt);
app.route('/interrupt', interrupt);
app.route('/reset', reset);
app.route('/git-state', gitState);
app.route('/git-status', gitStatus);
app.route('/git-commit-and-return', gitCommit);
app.route('/git-reset', gitReset);
app.route('/git-push', gitPush);
app.route('/git-history', gitHistory);

if (!isLocal) {
  app.route('/sshkey', sshkey);
  app.route('/upload-project-chunk', uploadProjectChunk);
  app.route('/upload-project-finalize', uploadProjectFinalize);
  app.route('/ports', ports);
  app.route('/port-visibility', portVisibility);
  app.route('/get-claude-dir', getClaudeDir);
  app.route('/generate-commit-name', generateCommitName);
  app.route('/generate-branch-name', generateBranchName);
  app.route('/generate-task-summary', generateTaskSummary);
  app.route('/rename-branch-from-prompt', renameBranchFromPrompt);
  app.route('/update-credentials', updateCredentials);
  app.route('/update-secrets', updateSecrets);
  app.route('/update-environment', updateEnvironment);
  app.route('/update-github-token', updateGithubToken);
  app.route('/generate-ssh-keypair', generateSshKeypair);
  app.route('/authorize-ssh-key', authorizeSshKey);
  app.route('/deploy-ssh-identity', deploySshIdentityKeys);
  app.route('/report-automation-event', reportAutomationEvent);
  app.route('/poll-automation-events', pollAutomationEvents);
  app.route('/poll-automation-actions', pollAutomationActions);
  app.route('/poll-context-events', pollContextEvents);
  app.route('/trigger-manual-automation', triggerManualAutomation);
  app.route('/execute-automations', executeAutomations);
  app.route('/stop-automation', stopAutomation);
  app.route('/write-automation-logs', writeAutomationLogs);
  app.route('/create-snapshot', createSnapshot);
  app.route('/restore-snapshot', restoreSnapshot);
  app.route('/desktop', desktop);
  app.route('/update-ariana-token', updateArianaToken);
  app.route('/ralph-mode-setup', ralphModeSetup);
  app.route('/ralph-mode-check-lock', ralphModeCheckLock);
}

// Public service preview endpoint (outside isLocal check)
app.route('/service-preview', servicePreview);

app.get('/health', (c) => {
  return c.json({ 
    status: 'ok', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  })
})

// Error handling
app.onError((err, c) => {
  console.error(`[Error] ${err.message}`)
  console.error(err.stack)
  
  if (process.env.NODE_ENV === 'production') {
    return c.json({
      error: {
        message: 'Internal Server Error',
        id: crypto.randomUUID()
      }
    }, 500)
  }

  return c.json({
    error: {
      message: err.message,
      stack: err.stack
    }
  }, 500)
})

// 404 handler
app.notFound((c) => {
  return c.json({
    status: 404,
    message: 'Not Found'
  }, 404)
})

// Start port monitor
startPortMonitor();

// Start metrics collector
metricsCollector.start();

// Auto-restore Claude service if we're restarting after a crash
// This is async but we don't await it - let the server start while restoration happens
autoRestoreClaudeServiceIfNeeded().catch(err => {
  console.error('[AUTO-RESTORE] Error during auto-restore:', err);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  metricsCollector.stop();
  stopPortMonitor();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  metricsCollector.stop();
  stopPortMonitor();
  process.exit(0);
});

// Set default port if not provided (single fallback at entry point)
if (!process.env.ARIANA_PORT) {
  console.warn('ARIANA_PORT not set, using default 8911. Set ARIANA_PORT environment variable to override.');
  process.env.ARIANA_PORT = '8911';
}

export default {
  port: parseInt(process.env.ARIANA_PORT, 10),
  hostname: "0.0.0.0",
  fetch: app.fetch
};