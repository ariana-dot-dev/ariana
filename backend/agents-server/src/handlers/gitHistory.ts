import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { globalState } from '../agentsState';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

const app = new Hono();

// Per-file diff size limit: files with diffs larger than this get replaced with a summary header
const MAX_FILE_DIFF_BYTES = 50 * 1024; // 50KB

interface GitHistoryRequest {
  agentId: string;
  gitHistoryLastPushedCommitSha: string | null;
  agentCreatedAt?: number; // Unix timestamp, only if gitHistoryLastPushedCommitSha is null
  startCommitSha?: string | null; // For calculating totalDiff
}

interface GitCommit {
  sha: string;
  title: string;
  branchName: string;
  timestamp: number;
  isPushed: boolean;
  patch: string;
}

interface GitHistoryResponse {
  success: boolean;
  commits: GitCommit[];
  uncommittedChanges: {
    branchName: string;
    patch: string;
  } | null;
  totalDiff: string;
  currentBranchName: string;
  error?: string;
}

/**
 * Trim large per-file diffs from a unified diff string.
 * Splits on "diff --git" boundaries. Files whose diff chunk exceeds
 * MAX_FILE_DIFF_BYTES get replaced with just the header + a stats summary.
 * Small file diffs are kept in full.
 */
function trimLargeFileDiffs(diff: string): string {
  if (!diff || diff.length <= MAX_FILE_DIFF_BYTES) return diff;

  // Split into per-file chunks. Each chunk starts with "diff --git ..."
  const chunks: string[] = [];
  const lines = diff.split('\n');
  let currentChunk: string[] = [];

  for (const line of lines) {
    if (line.startsWith('diff --git ') && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
      currentChunk = [];
    }
    currentChunk.push(line);
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }

  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_FILE_DIFF_BYTES) {
      result.push(chunk);
    } else {
      // Count additions/deletions in this file
      let additions = 0;
      let deletions = 0;
      const chunkLines = chunk.split('\n');
      for (const cl of chunkLines) {
        if (cl.startsWith('+') && !cl.startsWith('+++')) additions++;
        else if (cl.startsWith('-') && !cl.startsWith('---')) deletions++;
      }
      // Keep just the header lines (everything before first @@ hunk)
      const headerLines: string[] = [];
      for (const cl of chunkLines) {
        if (cl.startsWith('@@')) break;
        headerLines.push(cl);
      }
      headerLines.push(`[large diff omitted: +${additions} -${deletions} lines, ${Math.round(chunk.length / 1024)}KB]`);
      result.push(headerLines.join('\n'));
    }
  }

  return result.join('\n');
}

async function execGitCommand(args: string[], cwd: string): Promise<string> {
  const process = spawn('git', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';

  process.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  process.stderr?.on('data', (data) => {
    stderr += data.toString();
  });

  const exitCode = await new Promise<number>((resolve) => {
    process.on('exit', resolve);
  });

  if (exitCode !== 0 && stderr) {
    throw new Error(stderr);
  }

  return stdout;
}

app.post('/', async (c) => {
  const body = await c.req.json();
  const { valid, data, error } = await encryption.decryptAndValidate<GitHistoryRequest>(body);

  if (!valid) {
    console.error('[gitHistory] Invalid data:', error);
    return c.json({ error }, 400);
  }

  const { gitHistoryLastPushedCommitSha, agentCreatedAt, startCommitSha } = data!;

  if (!globalState.projectDir) {
    const response: GitHistoryResponse = {
      success: false,
      commits: [],
      uncommittedChanges: null,
      totalDiff: '',
      currentBranchName: '',
      error: 'Project directory not set'
    };
    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
  }

  try {
    const projectDir = globalState.projectDir;

    // Get current branch
    const currentBranch = await execGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], projectDir).then(s => s.trim());

    // Get list of commits
    let commitShas: string[];
    if (gitHistoryLastPushedCommitSha) {
      // Get all commits since gitHistoryLastPushedCommitSha
      const range = `${gitHistoryLastPushedCommitSha}..HEAD`;
      const commitsOutput = await execGitCommand(['rev-list', range], projectDir);
      commitShas = commitsOutput.trim().split('\n').filter(s => s.length > 0).reverse();
    } else if (agentCreatedAt) {
      // Get all commits since timestamp
      const sinceDate = new Date(agentCreatedAt).toISOString();
      const commitsOutput = await execGitCommand(['rev-list', '--since=' + sinceDate, 'HEAD'], projectDir);
      commitShas = commitsOutput.trim().split('\n').filter(s => s.length > 0).reverse();
    } else {
      // No filter - get all commits
      const commitsOutput = await execGitCommand(['rev-list', 'HEAD'], projectDir);
      commitShas = commitsOutput.trim().split('\n').filter(s => s.length > 0).reverse();
    }

    // Check if there's a remote
    let hasRemote = false;
    try {
      const remoteOutput = await execGitCommand(['remote'], projectDir);
      hasRemote = remoteOutput.trim().length > 0;
    } catch (error) {
      hasRemote = false;
    }

    // Fetch from remote to update remote-tracking branches
    if (hasRemote) {
      try {
        await execGitCommand(['fetch', '--quiet'], projectDir);
      } catch (error) {
        // Continue with stale remote-tracking branch info
      }
    }

    // Filter out commits currently being renamed (git commit --amend in progress).
    // This prevents polling from storing the pre-amend SHA as a duplicate.
    const filteredShas = commitShas.filter(sha => !globalState.pendingRenames.has(sha));

    // Process each commit
    const commits: GitCommit[] = [];
    for (const sha of filteredShas) {
      try {
        const title = await execGitCommand(['show', '-s', '--format=%s', sha], projectDir).then(s => s.trim());

        // Get commit timestamp (use author timestamp, not committer timestamp)
        // This ensures forked/restored commits preserve their original timestamps
        const timestampStr = await execGitCommand(['show', '-s', '--format=%at', sha], projectDir).then(s => s.trim());
        const timestamp = parseInt(timestampStr, 10) * 1000; // Convert to milliseconds

        // Check if pushed (exists on remote)
        let isPushed = false;
        if (hasRemote) {
          try {
            const remoteBranches = await execGitCommand(['branch', '-r', '--contains', sha], projectDir);
            isPushed = remoteBranches.trim().length > 0;
          } catch (error) {
            isPushed = false;
          }
        }

        // Generate patch (plain diff, not format-patch)
        const rawPatch = await execGitCommand(['diff', `${sha}~1`, sha], projectDir);

        commits.push({
          sha,
          title,
          branchName: currentBranch,
          timestamp,
          isPushed,
          patch: trimLargeFileDiffs(rawPatch)
        });
      } catch (error) {
        console.error(`Failed to process commit ${sha}:`, error);
        // Skip this commit
      }
    }

    // Get uncommitted changes
    let uncommittedChanges: { branchName: string; patch: string } | null = null;
    try {
      // Get tracked changes
      const trackedDiff = await execGitCommand(['diff', 'HEAD'], projectDir);

      // Get untracked files
      const untrackedFiles = await execGitCommand(['ls-files', '--others', '--exclude-standard'], projectDir);
      const untrackedFilesList = untrackedFiles.trim().split('\n').filter(f => f.length > 0);

      // Generate diffs for untracked files
      let untrackedDiffs = '';
      for (const file of untrackedFilesList) {
        try {
          const filePath = path.join(projectDir, file);
          const content = await fs.readFile(filePath, 'utf-8');

          const lines = content.split('\n');
          untrackedDiffs += `diff --git a/${file} b/${file}\n`;
          untrackedDiffs += `new file mode 100644\n`;
          untrackedDiffs += `index 0000000..0000000\n`;
          untrackedDiffs += `--- /dev/null\n`;
          untrackedDiffs += `+++ b/${file}\n`;
          untrackedDiffs += `@@ -0,0 +1,${lines.length} @@\n`;
          for (const line of lines) {
            untrackedDiffs += `+${line}\n`;
          }
        } catch (error) {
          console.error(`Failed to read untracked file ${file}:`, error);
        }
      }

      const combinedPatch = trackedDiff + untrackedDiffs;
      if (combinedPatch.trim().length > 0) {
        uncommittedChanges = {
          branchName: currentBranch,
          patch: trimLargeFileDiffs(combinedPatch)
        };
      }
    } catch (error) {
      console.error('Failed to get uncommitted changes:', error);
    }

    // Generate totalDiff
    let totalDiff = '';
    try {
      if (startCommitSha) {
        // Diff from startCommitSha to HEAD
        totalDiff = await execGitCommand(['diff', startCommitSha + '..HEAD'], projectDir);
      } else {
        // No startCommitSha - use diff from first commit to HEAD
        try {
          const firstCommit = await execGitCommand(['rev-list', '--max-parents=0', 'HEAD'], projectDir).then(s => s.trim().split('\n')[0]);
          totalDiff = await execGitCommand(['diff', firstCommit + '..HEAD'], projectDir);
        } catch (error) {
          // If that fails, just show all files as new
          totalDiff = await execGitCommand(['diff', '--no-index', '/dev/null', '.'], projectDir).catch(() => '');
        }
      }

      // Append uncommitted changes to totalDiff
      if (uncommittedChanges) {
        totalDiff += '\n' + uncommittedChanges.patch;
      }

      totalDiff = trimLargeFileDiffs(totalDiff);
    } catch (error) {
      console.error('Failed to generate totalDiff:', error);
      totalDiff = '';
    }

    const response: GitHistoryResponse = {
      success: true,
      commits,
      uncommittedChanges,
      totalDiff,
      currentBranchName: currentBranch
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
  } catch (error) {
    console.error('Failed to get git history:', error);
    const response: GitHistoryResponse = {
      success: false,
      commits: [],
      uncommittedChanges: null,
      totalDiff: '',
      currentBranchName: '',
      error: error instanceof Error ? error.message : 'Unknown git history error'
    };
    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
  }
});

export default app;
