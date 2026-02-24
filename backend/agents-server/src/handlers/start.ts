import { Hono } from 'hono'
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { spawn, exec, execSync } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'fs';
import { ClaudeService, SDKMessage } from '../claudeService';
import * as fsp from 'fs/promises';
import { generateInitialInstructions, type InstructionsContext } from '../initialInstructions';
import { toHttpsCloneUrl, extractGitHubRepository } from '../utils/githubUrl';
import { automationService } from '../automationService';
import { initializeAutomationEventReporter } from '../automationEventReporter';
import { getBashrcPath, getBaseDir, getDefaultProjectDir, getHomeDir, getClaudeDir } from '../utils/paths';

// File where conversation state is stored for fork/resume
function getConversationStateFile(): string {
    return `${getHomeDir()}/.ariana/conversation-state.json`;
}

const isLocal = process.argv.length >= 2 ? process.argv[1] == '--local' : false;

const execAsync = promisify(exec);

/**
 * Persist GitHub token to gh CLI config so SSH sessions can use it.
 * The GITHUB_TOKEN env var only works for processes spawned by agent-server,
 * but SSH sessions don't inherit it. This stores the token in ~/.config/gh/hosts.yml.
 */
async function persistGhAuth(token: string): Promise<void> {
    try {
        // gh auth login won't work if GITHUB_TOKEN is set, so we need to
        // temporarily run it without that env var
        await execAsync(`bash -c 'unset GITHUB_TOKEN; echo "${token}" | gh auth login --with-token'`, {
            env: { ...process.env, GITHUB_TOKEN: undefined }
        });
        console.log('[START] Persisted GitHub token to gh CLI config for SSH sessions');
    } catch (error) {
        // Non-fatal - gh might not be installed or token might already be stored
        console.log('[START] Could not persist gh auth (non-fatal):', error instanceof Error ? error.message : error);
    }
}

// Track which environment variables came from PersonalEnvironment
export const customEnvironmentVariables = new Set<string>();


const app = new Hono()

interface LocalSetup {
    type: 'local';
    path: string;
}

interface GitCloneSetup {
    type: 'git-clone';
    repository: string;
    baseBranch: string;
    token: string;
    targetBranch: string;
}

interface GitClonePublicSetup {
    type: 'git-clone-public';
    cloneUrl: string;
    branch: string;
    targetBranch: string;
}

interface ZipLocalSetup {
    type: 'zip-local';
    zipPath: string;
    githubToken?: string | null;
    repository?: string;
    targetBranch: string;
}

interface ExistingProjectSetup {
    type: 'existing';
    targetBranch: string;
    githubToken?: string | null;
    repository?: string | null;
}

interface AutomationData {
    id: string;
    name: string;
    trigger: any;
    scriptLanguage: 'bash' | 'javascript' | 'python';
    scriptContent: string;
    blocking: boolean;
    feedOutput: boolean;
}

interface StartConfig {
    setup: GitCloneSetup | GitClonePublicSetup | ZipLocalSetup | ExistingProjectSetup | LocalSetup;
    gitUserName: string;
    gitUserEmail: string;
    credentials?: Record<string, string>;
    environment?: Record<string, string>;
    automations?: AutomationData[];
    dontSendInitialMessage?: boolean;
    // Ariana CLI token for agent orchestration
    arianaToken?: string;  // JWT token for backend API access
    // Agent identity
    agentId?: string;
    projectId?: string;
    projectName?: string;
}

app.post('/', async (c) => {
    console.log('/start request received');
    const body = await c.req.json();

    const { valid, data, error } = await encryption.decryptAndValidate<StartConfig>(body);

    if (!valid) {
        console.log('Invalid data in /start', "\nerror: ", error);
        return c.json({ error }, 400);
    }

    let { setup, gitUserName, gitUserEmail, credentials = {}, environment = {}, automations = [], dontSendInitialMessage, arianaToken, agentId, projectId, projectName } = data!;

    if (isLocal && setup.type != 'local') {
        throw new Error("can't use other setup type than local when local");
    }
    if (isLocal) {
        environment = {};
    }

    try {
        // Set environment variables if provided
        if (!isLocal && Object.keys(environment).length > 0) {
            console.log('[START] Setting environment variables:', Object.keys(environment).join(', '));

            // Set in process.env for Claude Code SDK
            for (const [key, value] of Object.entries(environment)) {
                process.env[key] = value;
                customEnvironmentVariables.add(key);  // Track custom variables
                console.log(`[START] Set ${key}=${value ? value.substring(0, 10) + '...' : 'undefined'}`);
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

                console.log(`[START] Environment variables written to ${bashrcPath}`);
            } catch (error) {
                console.error('[START] Failed to write environment variables to .bashrc:', error);
            }
        }
        let projectDir;
        if (isLocal && setup.type === 'local') {
            console.log('Local setup')
            globalState.projectDir = setup.path;
        }
        if (setup.type === 'git-clone') {
            console.log('Setting up via git clone (OAuth)');
            projectDir = await setupGitClone(setup);
            // Store git info for push operations
            globalState.githubToken = setup.token;
            globalState.githubRepository = setup.repository;
            // Set GITHUB_TOKEN environment variable for gh CLI and user scripts
            process.env.GITHUB_TOKEN = setup.token;
            console.log('[START] Set GITHUB_TOKEN environment variable');
            // Persist to gh CLI config so SSH sessions can use it
            await persistGhAuth(setup.token);
        } else if (setup.type === 'git-clone-public') {
            console.log('Setting up via public git clone (no auth)');
            projectDir = await setupGitClonePublic(setup);
            // No GitHub token/repository for public clones
        } else if (setup.type === 'zip-local') {
            console.log('Setting up via local zip file');
            projectDir = await setupZipLocal(setup);
            // Store git info for push operations if available
            if (setup.githubToken) {
                globalState.githubToken = setup.githubToken;
                // Set GITHUB_TOKEN environment variable for gh CLI and user scripts
                process.env.GITHUB_TOKEN = setup.githubToken;
                console.log('[START] Set GITHUB_TOKEN environment variable');
                // Persist to gh CLI config so SSH sessions can use it
                await persistGhAuth(setup.githubToken);
            }
            if (setup.repository) {
                globalState.githubRepository = setup.repository;
            }
        } else if (setup.type === 'existing') {
            console.log('Setting up from existing project directory');
            // Use same path pattern as other setup types: baseDir/project
            projectDir = getDefaultProjectDir();
            globalState.projectDir = projectDir;
            // Set GitHub credentials for push operations (passed from backend during resume)
            if (setup.githubToken) {
                globalState.githubToken = setup.githubToken;
                process.env.GITHUB_TOKEN = setup.githubToken;
                console.log('[START] Set GITHUB_TOKEN for resumed agent');
                // Persist to gh CLI config so SSH sessions can use it
                await persistGhAuth(setup.githubToken);
            }
            if (setup.repository) {
                globalState.githubRepository = setup.repository;
                console.log(`[START] Set githubRepository: ${setup.repository}`);
            }
        } else {
            throw new Error(`Unknown setup type: ${(setup as any).type}`);
        }

        if (!projectDir) {
            throw new Error('Project directory not found');
        }

        if (!isLocal) {
            console.log('Configuring git user');
            await setupGitConfig(gitUserName, gitUserEmail);
        }

        if (setup.type === 'zip-local' || setup.type === 'existing') {
            // Check if repo is empty (no HEAD) to use orphan branch
            let isEmptyRepo = false;
            try {
                execSync('git rev-parse HEAD', { cwd: projectDir, stdio: 'pipe' });
            } catch {
                isEmptyRepo = true;
                console.log('[START] Repository is empty (no commits)');
            }
            await checkoutToBranch(projectDir, setup.targetBranch, isEmptyRepo);
        }

        // Save startCommitSha and find gitHistoryLastPushedCommitSha & baseBranch
        const gitInfo = await captureGitInfo(projectDir);

        // Initialize automation event reporter (ALWAYS, even if no automations at start)
        console.log(`[START] Initializing automation event reporter`);
        initializeAutomationEventReporter();

        // Load automations
        if (automations && automations.length > 0) {
            console.log(`[START] Loading ${automations.length} automation(s)`);
            globalState.automations = automations.map(a => ({
                id: a.id,
                name: a.name,
                trigger: a.trigger,
                scriptLanguage: a.scriptLanguage,
                scriptContent: a.scriptContent,
                blocking: a.blocking,
                feedOutput: a.feedOutput
            }));

            automationService.loadAutomations(globalState.automations);
        }

        console.log('Starting Claude service');
        await startClaudeService(dontSendInitialMessage || false, arianaToken, {
            setup,
            projectName,
            agentId,
            projectId,
            environment,
            automations,
        });

        // NOTE: on_agent_ready automations are now triggered by backend, not here

        // Build response based on gitInfo status (3-state: has_commits, empty_repo, error)
        const response: {
            status: string;
            message: string;
            gitInfoStatus: 'has_commits' | 'empty_repo' | 'error';
            startCommitSha?: string;
            gitHistoryLastPushedCommitSha?: string | null;
            gitInfoError?: string;
        } = {
            status: 'success',
            message: 'Agent initialized',
            gitInfoStatus: gitInfo.status
        };

        if (gitInfo.status === 'has_commits') {
            response.startCommitSha = gitInfo.startCommitSha;
            response.gitHistoryLastPushedCommitSha = gitInfo.gitHistoryLastPushedCommitSha;
        } else if (gitInfo.status === 'error') {
            response.gitInfoError = gitInfo.message;
        }

        const encryptedResponse = encryption.encrypt(response);
        return c.json({ encrypted: encryptedResponse });

    } catch (error) {
        console.error('Failed to start agent:', error);
        return c.json({
            error: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
    }
})

async function checkoutToBranch(projectDir: string, branchName: string, isEmptyRepo: boolean = false) {
    // For empty repos, use orphan branch since there's no HEAD to branch from
    const checkoutCommand = isEmptyRepo
        ? `git checkout --orphan ${branchName}`
        : `git checkout -B ${branchName}`;

    console.log(`Checking out to branch ${branchName}${isEmptyRepo ? ' (orphan branch for empty repo)' : ''}`);
    const proc = spawn('bash', ['-c', checkoutCommand], { cwd: projectDir });

    await new Promise((resolve, reject) => {
        proc.on('exit', code => {
            if (code === 0) {
                console.log('Git checkout successful');
                resolve(void 0);
            } else {
                reject(new Error(`Git checkout failed with code ${code}`));
            }
        });

        proc.stderr.on('data', (data) => {
            console.error(`Git checkout stderr: ${data}`);
        });
    });
}

async function setupGitClone(config: GitCloneSetup): Promise<string> {
    const projectName = 'project';
    const baseDir = process.env.WORK_DIR!;
    const projectDir = `${baseDir}/${projectName}`;
    globalState.projectDir = projectDir;

    // Clean up existing project directory
    if (existsSync(projectDir)) {
        console.log(`Removing existing project directory: ${projectDir}`);
        rmSync(projectDir, { recursive: true, force: true });
    }

    const repoUrl = `https://${config.token}@github.com/${config.repository}.git`;

    // Try cloning with the specified branch
    const cloneWithBranch = async (branch: string): Promise<boolean> => {
        const cloneCommand = `git clone -b ${branch} "${repoUrl}" "${projectDir}" 2>&1`;
        console.log(`Cloning repository to ${projectDir} with branch ${branch}`);
        console.log(`Clone command: git clone -b ${branch} [REDACTED] "${projectDir}"`);
        const proc = spawn('bash', ['-c', cloneCommand]);

        proc.stdout.on('data', (data) => {
            console.log(`Git clone output: ${data}`);
        });

        return new Promise((resolve, reject) => {
            proc.on('exit', code => {
                if (code === 0) {
                    console.log('Git clone successful');
                    resolve(true);
                } else {
                    reject(new Error(`Git clone failed with code ${code}`));
                }
            });

            proc.stderr.on('data', (data) => {
                console.error(`Git clone stderr: ${data}`);
            });
        });
    };

    // Clone without branch flag (for empty repos that have no branches yet)
    const cloneWithoutBranch = async (): Promise<void> => {
        const cloneCommand = `git clone "${repoUrl}" "${projectDir}" 2>&1`;
        console.log(`Cloning repository to ${projectDir} (no branch - empty repo)`);
        console.log(`Clone command: git clone [REDACTED] "${projectDir}"`);
        const proc = spawn('bash', ['-c', cloneCommand]);

        proc.stdout.on('data', (data) => {
            console.log(`Git clone output: ${data}`);
        });

        return new Promise((resolve, reject) => {
            proc.on('exit', code => {
                if (code === 0) {
                    console.log('Git clone successful (empty repo)');
                    resolve(void 0);
                } else {
                    reject(new Error(`Git clone failed with code ${code}`));
                }
            });

            proc.stderr.on('data', (data) => {
                console.error(`Git clone stderr: ${data}`);
            });
        });
    };

    let isEmptyRepo = false;
    try {
        await cloneWithBranch(config.baseBranch);
    } catch (error) {
        // If the initial branch was "main" and clone failed, retry with "master"
        if (config.baseBranch === 'main') {
            console.log('Clone with "main" branch failed, retrying with "master" branch');
            try {
                await cloneWithBranch('master');
            } catch (retryError) {
                // Third fallback: try cloning without branch (for empty repos)
                console.log('Clone with "master" branch failed, trying without branch (empty repo)');
                try {
                    await cloneWithoutBranch();
                    isEmptyRepo = true;
                } catch (emptyRepoError) {
                    throw new Error(`Git clone failed - could not clone with main, master, or as empty repo`);
                }
            }
        } else {
            throw error;
        }
    }

    // Create new branch for agent to work on
    await checkoutToBranch(projectDir, config.targetBranch, isEmptyRepo);

    return projectDir;
}

async function setupGitClonePublic(config: GitClonePublicSetup): Promise<string> {
    const projectName = 'project';
    const baseDir = process.env.WORK_DIR!;
    const projectDir = `${baseDir}/${projectName}`;
    globalState.projectDir = projectDir;

    // Clean up existing project directory
    if (existsSync(projectDir)) {
        console.log(`Removing existing project directory: ${projectDir}`);
        rmSync(projectDir, { recursive: true, force: true });
    }

    // Clone public repository with a specific branch
    const cloneWithBranch = async (branch: string): Promise<void> => {
        const cloneCommand = `git clone --depth 10 --branch ${branch} --single-branch "${config.cloneUrl}" "${projectDir}"`;
        console.log(`Cloning public repository to ${projectDir} from ${config.cloneUrl} (branch: ${branch})`);
        const proc = spawn('bash', ['-c', cloneCommand]);

        // Timeout after 5 minutes (prevents hanging on large repos)
        const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
        let timeoutId: NodeJS.Timeout | null = null;

        return new Promise((resolve, reject) => {
            // Set timeout
            timeoutId = setTimeout(() => {
                console.error('Git clone timed out after 5 minutes');
                proc.kill('SIGTERM');
                reject(new Error('Git clone timed out - repository may be too large or network is slow'));
            }, CLONE_TIMEOUT_MS);

            proc.on('exit', code => {
                if (timeoutId) clearTimeout(timeoutId);
                if (code === 0) {
                    console.log('Git clone successful');
                    resolve(void 0);
                } else {
                    reject(new Error(`Git clone failed with code ${code}`));
                }
            });

            proc.stderr.on('data', (data) => {
                console.error(`Git clone stderr: ${data}`);
            });

            proc.stdout.on('data', (data) => {
                console.log(`Git clone stdout: ${data}`);
            });

            proc.on('error', (error) => {
                if (timeoutId) clearTimeout(timeoutId);
                console.error(`Git clone process error: ${error}`);
                reject(new Error(`Git clone process failed: ${error.message}`));
            });
        });
    };

    // Clone without branch flag (for empty repos that have no branches yet)
    const cloneWithoutBranch = async (): Promise<void> => {
        const cloneCommand = `git clone "${config.cloneUrl}" "${projectDir}"`;
        console.log(`Cloning public repository to ${projectDir} from ${config.cloneUrl} (no branch - empty repo)`);
        const proc = spawn('bash', ['-c', cloneCommand]);

        const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
        let timeoutId: NodeJS.Timeout | null = null;

        return new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                console.error('Git clone timed out after 5 minutes');
                proc.kill('SIGTERM');
                reject(new Error('Git clone timed out - repository may be too large or network is slow'));
            }, CLONE_TIMEOUT_MS);

            proc.on('exit', code => {
                if (timeoutId) clearTimeout(timeoutId);
                if (code === 0) {
                    console.log('Git clone successful (empty repo)');
                    resolve(void 0);
                } else {
                    reject(new Error(`Git clone failed with code ${code}`));
                }
            });

            proc.stderr.on('data', (data) => {
                console.error(`Git clone stderr: ${data}`);
            });

            proc.stdout.on('data', (data) => {
                console.log(`Git clone stdout: ${data}`);
            });

            proc.on('error', (error) => {
                if (timeoutId) clearTimeout(timeoutId);
                console.error(`Git clone process error: ${error}`);
                reject(new Error(`Git clone process failed: ${error.message}`));
            });
        });
    };

    let isEmptyRepo = false;
    try {
        await cloneWithBranch(config.branch);
    } catch (error) {
        // If the initial branch was "main" and clone failed, retry with "master"
        if (config.branch === 'main') {
            console.log('Clone with "main" branch failed, retrying with "master" branch');
            try {
                await cloneWithBranch('master');
            } catch (retryError) {
                // Third fallback: try cloning without branch (for empty repos)
                console.log('Clone with "master" branch failed, trying without branch (empty repo)');
                try {
                    await cloneWithoutBranch();
                    isEmptyRepo = true;
                } catch (emptyRepoError) {
                    throw new Error(`Git clone failed - could not clone with main, master, or as empty repo`);
                }
            }
        } else {
            throw error;
        }
    }

    // Create new branch for agent to work on
    await checkoutToBranch(projectDir, config.targetBranch, isEmptyRepo);

    return projectDir;
}

async function setupZipLocal(config: ZipLocalSetup): Promise<string> {
    const projectName = 'project';
    const baseDir = process.env.WORK_DIR!;
    const projectDir = `${baseDir}/${projectName}`;
    globalState.projectDir = projectDir;

    // Clean up existing project directory
    if (existsSync(projectDir)) {
        console.log(`Removing existing project directory: ${projectDir}`);
        rmSync(projectDir, { recursive: true, force: true });
    }

    const bundlePath = '/tmp/project.bundle';
    const patchPath = '/tmp/project.patch';
    const metadataPath = '/tmp/bundle-metadata.json';

    console.log(`Setting up project from git bundle and patch`);

    // Check if bundle and patch exist
    const [bundleExists, patchExists, metadataExists] = await Promise.all([
        fsp.stat(bundlePath).then(() => true).catch(() => false),
        fsp.stat(patchPath).then(() => true).catch(() => false),
        fsp.stat(metadataPath).then(() => true).catch(() => false)
    ]);

    if (!bundleExists || !patchExists) {
        throw new Error(`Bundle or patch file not found at /tmp/`);
    }

    // Check for incremental bundle metadata
    let isIncremental = false;
    let baseCommitSha: string | undefined;
    let remoteUrl: string | undefined;

    if (metadataExists) {
        try {
            const metadataContent = await fsp.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);
            isIncremental = metadata.isIncremental || false;
            baseCommitSha = metadata.baseCommitSha;
            remoteUrl = metadata.remoteUrl;
            console.log(`Found incremental bundle metadata - base: ${baseCommitSha}, remote: ${remoteUrl}`);

            // Extract and set GitHub repository info from remote URL if available
            if (remoteUrl) {
                const repositoryFullName = extractGitHubRepository(remoteUrl);
                if (repositoryFullName) {
                    globalState.githubRepository = repositoryFullName;
                    console.log(`Extracted GitHub repository from remote URL: ${repositoryFullName}`);
                }
            }
        } catch (error) {
            console.warn('Failed to parse metadata file, falling back to full bundle:', error);
        }
    }

    // Check if bundle is empty (0 bytes)
    const bundleStats = await fsp.stat(bundlePath);
    const bundleIsEmpty = bundleStats.size === 0;

    if (bundleIsEmpty && !isIncremental) {
        // Repository has no commits at all - initialize empty git repo
        console.log('Bundle is empty (no commits) - initializing new git repository');
        await fsp.mkdir(projectDir, { recursive: true });

        const initProc = spawn('git', ['init'], { cwd: projectDir });
        await new Promise((resolve, reject) => {
            initProc.on('exit', (code) => {
                if (code === 0) {
                    console.log('Git init successful');
                    resolve(void 0);
                } else {
                    reject(new Error(`Git init failed with code ${code}`));
                }
            });

            initProc.stderr.on('data', (data) => {
                console.error(`Git init stderr: ${data}`);
            });
        });
    } else if (isIncremental && baseCommitSha && remoteUrl) {
        // Incremental bundle - clone from remote at base commit, then apply incremental bundle
        console.log(`[INCREMENTAL] Cloning from ${remoteUrl} at base commit ${baseCommitSha}`);

        // Convert to HTTPS clone URL (GitHub only, with or without token)
        let cloneUrl: string;
        if (remoteUrl.includes('github.com')) {
            // Convert SSH to HTTPS (public or authenticated)
            cloneUrl = toHttpsCloneUrl(remoteUrl, config.githubToken || undefined);
            const displayUrl = config.githubToken
                ? cloneUrl.replace(/ghp_[^@]+/, 'TOKEN')
                : cloneUrl;
            console.log(`GitHub clone URL: ${displayUrl}`);
        } else {
            // Non-GitHub - use as-is
            cloneUrl = remoteUrl;
            console.log(`Non-GitHub clone URL: ${cloneUrl}`);
        }

        // Shallow clone from remote
        console.log(`Cloning from remote (shallow)...`);
        const cloneCommand = `git clone --depth 1 "${cloneUrl}" "${projectDir}"`;
        const cloneProc = spawn('bash', ['-c', cloneCommand]);

        // Set timeout to prevent hanging on credential prompts
        const CLONE_TIMEOUT_MS = 30000;
        let timeoutId: NodeJS.Timeout | null = null;

        await new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                console.error('Git clone timed out - likely authentication failure');
                cloneProc.kill('SIGTERM');
                reject(new Error('Repository clone timed out. This usually means authentication failed. Please ensure you have access to the repository and are signed in with GitHub.'));
            }, CLONE_TIMEOUT_MS);

            cloneProc.on('exit', (code) => {
                if (timeoutId) clearTimeout(timeoutId);
                if (code === 0) {
                    console.log('Remote clone successful');
                    resolve(void 0);
                } else {
                    reject(new Error(`Repository clone failed (exit code ${code}). Please ensure you have access to the repository and are signed in with GitHub.`));
                }
            });

            cloneProc.stderr.on('data', (data) => {
                console.error(`Git clone stderr: ${data}`);
            });

            cloneProc.on('error', (error) => {
                if (timeoutId) clearTimeout(timeoutId);
                console.error(`Git clone process error: ${error}`);
                reject(new Error(`Repository clone failed: ${error.message}`));
            });
        });

        // Fetch the specific base commit
        console.log(`Fetching base commit ${baseCommitSha}...`);
        const fetchCommand = `git fetch --depth 1 origin ${baseCommitSha}`;
        const fetchProc = spawn('bash', ['-c', fetchCommand], { cwd: projectDir });

        await new Promise((resolve, reject) => {
            fetchProc.on('exit', (code) => {
                if (code === 0) {
                    console.log('Base commit fetched');
                    resolve(void 0);
                } else {
                    console.warn('Fetch failed, will try to apply bundle anyway');
                    resolve(void 0);
                }
            });

            fetchProc.stderr.on('data', (data) => {
                console.error(`Git fetch stderr: ${data}`);
            });
        });

        // Apply incremental bundle (skip if empty - HEAD is at merge-base)
        if (bundleIsEmpty) {
            console.log('Bundle is empty (HEAD at merge-base) - checking out to base commit');

            // Checkout to the base commit to match client's state
            const checkoutCommand = `git checkout ${baseCommitSha}`;
            const checkoutProc = spawn('bash', ['-c', checkoutCommand], { cwd: projectDir });

            await new Promise((resolve, reject) => {
                checkoutProc.on('exit', (code) => {
                    if (code === 0) {
                        console.log(`Checked out to base commit ${baseCommitSha}`);
                        resolve(void 0);
                    } else {
                        reject(new Error(`Checkout to base commit failed with code ${code}`));
                    }
                });

                checkoutProc.stderr.on('data', (data) => {
                    console.error(`Git checkout stderr: ${data}`);
                });
            });
        } else {
            console.log(`Applying incremental bundle...`);
            const bundleCommand = `git pull ${bundlePath}`;
            const bundleProc = spawn('bash', ['-c', bundleCommand], { cwd: projectDir });

            await new Promise((resolve, reject) => {
                bundleProc.on('exit', (code) => {
                    if (code === 0) {
                        console.log('Incremental bundle applied successfully');
                        resolve(void 0);
                    } else {
                        reject(new Error(`Bundle apply failed with code ${code}`));
                    }
                });

                bundleProc.stderr.on('data', (data) => {
                    console.error(`Git pull bundle stderr: ${data}`);
                });

                bundleProc.stdout.on('data', (data) => {
                    console.log(`Git pull bundle stdout: ${data}`);
                });
            });
        }

        // Clean up metadata file
        try {
            await fsp.unlink(metadataPath);
            console.log('Cleaned up metadata file');
        } catch (error) {
            console.warn('Failed to cleanup metadata file:', error);
        }
    } else if (bundleIsEmpty) {
        // Bundle is empty (no commits) - initialize empty git repo
        console.log('Bundle is empty (no commits) - initializing new git repository');
        await fsp.mkdir(projectDir, { recursive: true });

        const initProc = spawn('git', ['init'], { cwd: projectDir });
        await new Promise((resolve, reject) => {
            initProc.on('exit', (code) => {
                if (code === 0) {
                    console.log('Git init successful');
                    resolve(void 0);
                } else {
                    reject(new Error(`Git init failed with code ${code}`));
                }
            });

            initProc.stderr.on('data', (data) => {
                console.error(`Git init stderr: ${data}`);
            });
        });
    } else {
        // Full bundle - clone from bundle file
        console.log(`Cloning from full bundle: ${bundlePath}`);
        const cloneCommand = `git clone ${bundlePath} ${projectDir}`;
        const cloneProc = spawn('bash', ['-c', cloneCommand]);

        await new Promise((resolve, reject) => {
            cloneProc.on('exit', (code) => {
                if (code === 0) {
                    console.log('Git clone from bundle successful');
                    resolve(void 0);
                } else {
                    reject(new Error(`Git clone from bundle failed with code ${code}`));
                }
            });

            cloneProc.stderr.on('data', (data) => {
                console.error(`Git clone stderr: ${data}`);
            });
        });
    }

    // Apply patch (uncommitted changes) - skip if empty
    const patchStats = await fsp.stat(patchPath);
    const patchIsEmpty = patchStats.size === 0;

    if (patchIsEmpty) {
        console.log('Patch is empty (no uncommitted changes) - skipping patch application');
    } else {
        console.log(`Applying patch: ${patchPath}`);
        const applyCommand = `git apply ${patchPath}`;
        const patchProc = spawn('bash', ['-c', applyCommand], { cwd: projectDir });

        await new Promise((resolve, reject) => {
            patchProc.on('exit', (code) => {
                if (code === 0) {
                    console.log('Patch applied successfully');
                    resolve(void 0);
                } else {
                    // Patch might be empty if there are no uncommitted changes
                    console.log('Patch apply failed or was empty - continuing');
                    resolve(void 0);
                }
            });

            patchProc.stderr.on('data', (data) => {
                console.error(`Git apply stderr: ${data}`);
            });
        });
    }

    // If we don't have repository info yet, try to get it from git remote
    if (!globalState.githubRepository) {
        console.log('Attempting to extract GitHub repository from git remote');
        try {
            const getRemoteProc = spawn('git', ['remote', 'get-url', 'origin'], { cwd: projectDir });

            let remoteUrlFromGit = '';
            getRemoteProc.stdout.on('data', (data) => {
                remoteUrlFromGit += data.toString();
            });

            await new Promise((resolve) => {
                getRemoteProc.on('exit', (code) => {
                    if (code === 0 && remoteUrlFromGit.trim()) {
                        const repositoryFullName = extractGitHubRepository(remoteUrlFromGit.trim());
                        if (repositoryFullName) {
                            globalState.githubRepository = repositoryFullName;
                            console.log(`Extracted GitHub repository from git remote: ${repositoryFullName}`);
                        }
                    }
                    resolve(void 0);
                });
            });
        } catch (error) {
            console.log('Failed to get git remote URL:', error);
        }
    }

    return projectDir;
}

async function setupGitConfig(userName: string, userEmail: string): Promise<void> {
    // Use project-local config instead of global (global may fail when running as service)
    const projectDir = globalState.projectDir;
    if (!projectDir) {
        throw new Error('Project directory not set - cannot configure git');
    }

    const configCommand = `git config user.name "${userName}" && git config user.email "${userEmail}"`;
    const proc = spawn('bash', ['-c', configCommand], { cwd: projectDir });

    await new Promise((resolve, reject) => {
        proc.on('exit', (code) => {
            if (code === 0) {
                console.log('Git config successful');
                resolve(void 0);
            } else {
                reject(new Error(`Git config failed with code ${code}`));
            }
        });
    });
}

async function setupCredentials(credentials: Record<string, string>): Promise<void> {
    const workDir = process.env.WORK_DIR!;

    // Create .claude directory in work dir
    const claudeDirPath = join(workDir, '.claude');
    mkdirSync(claudeDirPath, {recursive: true});
}


// Ariana CLI paths (computed from home dir to work on both Hetzner and custom machines)
function getArianaCLIDir(): string {
    return `${getHomeDir()}/.ariana`;
}
function getArianaCLIPath(): string {
    return `${getArianaCLIDir()}/ariana`;
}
function getArianaSkillDir(): string {
    return `${getClaudeDir()}/skills/ariana`;
}
function getArianaSkillPath(): string {
    return `${getArianaSkillDir()}/SKILL.md`;
}

// LUX CLI paths (same pattern as ariana)
function getLuxSkillDir(): string {
    return `${getClaudeDir()}/skills/lux`;
}
function getLuxSkillPath(): string {
    return `${getLuxSkillDir()}/SKILL.md`;
}

// Import the CLI and skill source code (embedded at build time)
import ARIANA_CLI_SOURCE from '../ariana-cli/index.ts' with { type: 'text' };
import ARIANA_SKILL_SOURCE from '../ariana-skill/SKILL.md' with { type: 'text' };
import LUX_CLI_SOURCE from '../lux-cli/index.ts' with { type: 'text' };
import LUX_SKILL_SOURCE from '../lux-skill/SKILL.md' with { type: 'text' };

/**
 * Deploy the Ariana CLI and skill to disk.
 * Called on startup to make the CLI available to agents.
 */
function deployArianaCli(): void {

    const cliDir = getArianaCLIDir();
    const cliSourcePath = `${cliDir}/ariana.ts`;  // TypeScript source
    const cliWrapperPath = `${cliDir}/ariana`;     // Shell wrapper script
    const skillDir = getArianaSkillDir();
    const skillPath = getArianaSkillPath();

    // Deploy CLI - write TypeScript source to ariana.ts
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(cliSourcePath, ARIANA_CLI_SOURCE, { mode: 0o644 });
    console.log('[Ariana] Deployed CLI source to', cliSourcePath);

    // Create shell wrapper script that invokes bun
    // This works in non-interactive shells (unlike aliases)
    const wrapperScript = `#!/bin/bash
exec bun run "${cliSourcePath}" "$@"
`;
    writeFileSync(cliWrapperPath, wrapperScript, { mode: 0o755 });
    console.log('[Ariana] Deployed CLI wrapper to', cliWrapperPath);

    // Deploy skill
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, ARIANA_SKILL_SOURCE, { mode: 0o644 });
    console.log('[Ariana] Deployed skill to', skillPath);

    // Add CLI to process.env.PATH so SDK passes it to child processes
    if (!process.env.PATH?.includes(cliDir)) {
        process.env.PATH = `${cliDir}:${process.env.PATH || ''}`;
        console.log('[Ariana] Added CLI dir to process.env.PATH');
    }

    // Also add to bashrc for SSH sessions
    const bashrcPath = getBashrcPath();
    try {
        const bashrc = readFileSync(bashrcPath, 'utf-8');
        if (!bashrc.includes('ARIANA CLI PATH')) {
            const pathExport = `\n# ARIANA CLI PATH\nexport PATH="${cliDir}:$PATH"\n`;
            appendFileSync(bashrcPath, pathExport);
            console.log('[Ariana] Added CLI to PATH in', bashrcPath);
        }
    } catch (e) {
        console.warn('[Ariana] Could not update bashrc:', e);
    }
}

/**
 * Deploy the LUX CLI and skill to disk.
 * Called on startup to make the CLI available to agents for computer-use.
 */
function deployLuxCli(): void {

    const cliDir = getArianaCLIDir();  // Use same dir as ariana CLI
    const cliSourcePath = `${cliDir}/lux.ts`;  // TypeScript source
    const cliWrapperPath = `${cliDir}/lux`;     // Shell wrapper script
    const skillDir = getLuxSkillDir();
    const skillPath = getLuxSkillPath();

    // Deploy CLI - write TypeScript source to lux.ts
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(cliSourcePath, LUX_CLI_SOURCE, { mode: 0o644 });
    console.log('[LUX] Deployed CLI source to', cliSourcePath);

    // Create shell wrapper script that invokes bun
    const wrapperScript = `#!/bin/bash
exec bun run "${cliSourcePath}" "$@"
`;
    writeFileSync(cliWrapperPath, wrapperScript, { mode: 0o755 });
    console.log('[LUX] Deployed CLI wrapper to', cliWrapperPath);

    // Deploy skill
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillPath, LUX_SKILL_SOURCE, { mode: 0o644 });
    console.log('[LUX] Deployed skill to', skillPath);
}

interface StartClaudeServiceContext {
    setup: GitCloneSetup | GitClonePublicSetup | ZipLocalSetup | ExistingProjectSetup | LocalSetup;
    projectName?: string;
    agentId?: string;
    projectId?: string;
    environment: Record<string, string>;
    automations: AutomationData[];
}

async function startClaudeService(
    dontSendInitialMessage: boolean,
    arianaToken: string | undefined,
    context: StartClaudeServiceContext
): Promise<void> {
    const { setup, projectName, agentId, projectId, environment, automations } = context;
    try {
        console.log("Starting Claude Code SDK");

        // Set up Ariana CLI if token is provided
        if (arianaToken) {
            console.log('[START] Setting up Ariana CLI');

            // Deploy CLI and skill to disk
            deployArianaCli();

            // Deploy LUX CLI and skill (computer-use)
            console.log('[START] Setting up LUX CLI');
            deployLuxCli();

            // Set ARIANA_TOKEN environment variable (like GITHUB_TOKEN)
            process.env.ARIANA_TOKEN = arianaToken;
            process.env.ARIANA_BACKEND_URL = process.env.BACKEND_URL || 'https://ariana.dev';

            // Also write to bashrc for SSH sessions
            const bashrcPath = getBashrcPath();
            try {
            
                const bashrc = readFileSync(bashrcPath, 'utf-8');
                // Remove old ARIANA_TOKEN block if exists
                const cleanedBashrc = bashrc.replace(/\n# ARIANA TOKEN START[\s\S]*?# ARIANA TOKEN END\n?/g, '');
                const tokenBlock = `\n# ARIANA TOKEN START\nexport ARIANA_TOKEN="${arianaToken}"\nexport ARIANA_BACKEND_URL="${process.env.ARIANA_BACKEND_URL}"\n# ARIANA TOKEN END\n`;
                writeFileSync(bashrcPath, cleanedBashrc + tokenBlock);
                console.log('[START] ARIANA_TOKEN written to bashrc');
            } catch (e) {
                console.warn('[START] Could not write ARIANA_TOKEN to bashrc:', e);
            }

            // Track as custom environment variable so it's passed to Claude SDK
            customEnvironmentVariables.add('ARIANA_TOKEN');
            customEnvironmentVariables.add('ARIANA_BACKEND_URL');
            console.log('[START] Ariana CLI configured with token');
        }

        globalState.claudeService = new ClaudeService();

        if (dontSendInitialMessage) {
            console.log("Skipping initial instructions (dontSendInitialMessage=true)");

            // Try to restore conversation state from snapshot (fork/resume case)
            try {
                const stateFileExists = existsSync(getConversationStateFile());
                if (stateFileExists) {
                    console.log("[START] Found conversation state file, restoring...");
                    const stateContent = await fsp.readFile(getConversationStateFile(), 'utf-8');
                    const state = JSON.parse(stateContent) as {
                        messages: Array<{ uuid: string; data: SDKMessage }>;
                        pastConversations: SDKMessage[];
                        initialInstructions: string;
                        sessionId?: string | null;
                    };
                    globalState.claudeService.restoreState(state);
                    console.log("[START] Conversation state restored successfully");

                    // Clean up the state file after restoration
                    await fsp.unlink(getConversationStateFile()).catch(() => {});
                } else {
                    console.log("[START] No conversation state file found (fresh fork or new agent)");
                }
            } catch (e) {
                console.error("[START] Failed to restore conversation state:", e);
                // Continue without restored state - not a critical failure
            }

            globalState.claudeReadyForPrompt = true;
            return;
        }

        // Set initial instructions in system prompt (appended to every message)
        const instructionsContext: InstructionsContext = {
            projectDir: globalState.projectDir!,
            branchName: setup.type !== 'local' ? (setup as any).targetBranch : undefined,
            baseBranch: setup.type === 'git-clone' ? setup.baseBranch : undefined,
            repository: globalState.githubRepository || undefined,
            projectName,
            agentId,
            projectId,
            environmentVariableNames: Object.keys(environment),
            automations: automations.map(a => ({
                name: a.name,
                trigger: a.trigger.type
            })),
        };
        const initialInstructions = generateInitialInstructions(instructionsContext);

        globalState.claudeService.setInitialInstructions(initialInstructions);
        console.log("Initial instructions set in system prompt, Claude ready");
        globalState.claudeReadyForPrompt = true;

    } catch (e) {
        console.error("FAILED TO INITIALIZE CLAUDE SERVICE", e);
        globalState.claudeReadyForPrompt = false;
    }
}

// 3-state result: has commits, empty repo, or error
type GitInfoResult =
    | { status: 'has_commits'; startCommitSha: string; gitHistoryLastPushedCommitSha: string | null }
    | { status: 'empty_repo' }
    | { status: 'error'; message: string };

async function captureGitInfo(projectDir: string): Promise<GitInfoResult> {
    try {
        // Get current HEAD sha
        const getHeadProc = spawn('git', ['rev-parse', 'HEAD'], { cwd: projectDir });
        let headSha = '';
        let headStderr = '';
        getHeadProc.stdout.on('data', (data) => {
            headSha += data.toString();
        });
        getHeadProc.stderr.on('data', (data) => {
            headStderr += data.toString();
        });

        const headExitCode = await new Promise<number>((resolve) => {
            getHeadProc.on('exit', (code) => resolve(code ?? 1));
        });

        // Empty repo - no HEAD
        if (headExitCode !== 0) {
            console.log('[START] Repository has no commits (empty repo)');
            globalState.startCommitSha = undefined;
            return { status: 'empty_repo' };
        }

        const startCommitSha = headSha.trim();
        globalState.startCommitSha = startCommitSha;
        console.log(`[START] startCommitSha: ${startCommitSha}`);

        // Find gitHistoryLastPushedCommitSha - check if there's a remote
        let gitHistoryLastPushedCommitSha: string | null = null;
        try {
            const getRemoteProc = spawn('git', ['remote'], { cwd: projectDir });
            let remoteOutput = '';
            getRemoteProc.stdout.on('data', (data) => {
                remoteOutput += data.toString();
            });

            await new Promise((resolve) => {
                getRemoteProc.on('exit', () => {
                    resolve(void 0);
                });
            });

            const hasRemote = remoteOutput.trim().length > 0;
            if (hasRemote) {
                // Get last 200 commits
                const getCommitsProc = spawn('git', ['log', '--format=%H', '-n', '200'], { cwd: projectDir });
                let commitsOutput = '';
                getCommitsProc.stdout.on('data', (data) => {
                    commitsOutput += data.toString();
                });

                await new Promise((resolve) => {
                    getCommitsProc.on('exit', () => {
                        resolve(void 0);
                    });
                });

                const commits = commitsOutput.trim().split('\n').filter(s => s.length > 0);

                // Check each commit in order to find first pushed one
                for (const sha of commits) {
                    try {
                        const checkPushedProc = spawn('git', ['branch', '-r', '--contains', sha], { cwd: projectDir });
                        let remoteBranches = '';
                        checkPushedProc.stdout.on('data', (data) => {
                            remoteBranches += data.toString();
                        });

                        await new Promise((resolve) => {
                            checkPushedProc.on('exit', () => {
                                resolve(void 0);
                            });
                        });

                        if (remoteBranches.trim().length > 0) {
                            gitHistoryLastPushedCommitSha = sha;
                            console.log(`[START] gitHistoryLastPushedCommitSha: ${gitHistoryLastPushedCommitSha}`);
                            break;
                        }
                    } catch (error) {
                        // Continue to next commit
                    }
                }
            }
        } catch (error) {
            console.warn('[START] Failed to find gitHistoryLastPushedCommitSha:', error);
        }

        return {
            status: 'has_commits',
            startCommitSha,
            gitHistoryLastPushedCommitSha
        };
    } catch (error) {
        console.error('[START] Failed to capture git info:', error);
        return {
            status: 'error',
            message: error instanceof Error ? error.message : 'Failed to capture git info'
        };
    }
}

export default app;