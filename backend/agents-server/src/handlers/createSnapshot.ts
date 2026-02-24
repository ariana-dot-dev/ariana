import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import {
  formatDuration,
  runCommand,
} from './snapshotUtils';
import { globalState } from '../agentsState';

const app = new Hono();

const BACKUP_ROOT = '/home/ariana';
const TEMP_FILE_LEGACY = '/tmp/snapshot-upload.tar.gz';
const TEMP_FILE_ZSTD = '/dev/shm/snapshot.tar.zst';
const CHUNK_PREFIX = '/dev/shm/chunk-';
const MAX_PARALLEL_UPLOADS = 4;

// System config files to always include in snapshots (user-changeable settings)
// These are outside /home/ariana but important for user experience
// We use sudo to read these since ariana has NOPASSWD sudo access
const SYSTEM_CONFIG_FILES = [
  '/etc/default/keyboard',              // Keyboard layout (XKB config)
  '/etc/timezone',                      // Timezone setting
  '/etc/default/locale',                // Locale/language settings
];

// File where we store the list of user-installed apt packages
const APT_PACKAGES_FILE = '/home/ariana/.system-config/apt-packages.txt';
// File where we store the base image's apt packages (created at machine provision)
const BASE_APT_PACKAGES_FILE = '/home/ariana/.base-apt-packages.txt';

// File where we store the list of user-installed snap packages
const SNAP_PACKAGES_FILE = '/home/ariana/.system-config/snap-packages.txt';
// File where we store the base image's snap packages (created at machine provision)
const BASE_SNAP_PACKAGES_FILE = '/home/ariana/.base-snap-packages.txt';

// File where we store the conversation state for fork/resume
const CONVERSATION_STATE_FILE = '/home/ariana/.ariana/conversation-state.json';

// Track current snapshot for cancellation
let currentSnapshotId: string | null = null;
let currentProcess: ChildProcess | null = null;
let isCancelled = false;

interface CreateSnapshotConfig {
  // Chunked upload (new)
  presignedUploadUrls?: string[];
  chunkSizeBytes?: number;
  // Legacy single-file upload
  presignedUploadUrl?: string;
  snapshotId: string;
}

// Cancel endpoint
app.post('/cancel', async (c) => {
  console.log('[SNAPSHOT] Cancel requested');

  if (!currentSnapshotId) {
    console.log('[SNAPSHOT] No snapshot in progress to cancel');
    return c.json({ success: true, message: 'No snapshot in progress' });
  }

  isCancelled = true;

  // Kill the current process if running
  if (currentProcess) {
    console.log(`[SNAPSHOT] Killing process for snapshot ${currentSnapshotId}`);
    currentProcess.kill('SIGKILL');
    currentProcess = null;
  }

  // Cleanup temp files (both legacy and chunked)
  await fs.unlink(TEMP_FILE_LEGACY).catch(() => {});
  await fs.unlink(TEMP_FILE_ZSTD).catch(() => {});
  await runCommand(`rm -f ${CHUNK_PREFIX}*`, 5000);

  const cancelledId = currentSnapshotId;
  currentSnapshotId = null;

  console.log(`[SNAPSHOT] Cancelled snapshot ${cancelledId}`);
  return c.json({ success: true, cancelledSnapshotId: cancelledId });
});

app.post('/', async (c) => {
  const startTime = Date.now();
  console.log('[SNAPSHOT] Starting full snapshot...');
  const body = await c.req.json();

  const { valid, data, error } = await encryption.decryptAndValidate<CreateSnapshotConfig>(body);

  if (!valid) {
    console.error('[SNAPSHOT] Invalid request data:', error);
    return c.json({ error }, 400);
  }

  const { presignedUploadUrls, chunkSizeBytes, presignedUploadUrl, snapshotId } = data!;
  const isChunked = Array.isArray(presignedUploadUrls) && presignedUploadUrls.length > 0;

  if (!isChunked && !presignedUploadUrl) {
    console.error('[SNAPSHOT] No presignedUploadUrl or presignedUploadUrls provided');
    return c.json({ error: 'No presignedUploadUrl or presignedUploadUrls provided - possible agent-server/backend version mismatch' }, 400);
  }

  // Reset cancellation flag and set current snapshot
  isCancelled = false;
  currentSnapshotId = snapshotId;

  try {
    const compressor = isChunked ? 'zstd -T8 -3' : 'pigz -p 8';
    const tempFile = isChunked ? TEMP_FILE_ZSTD : TEMP_FILE_LEGACY;
    console.log(`[SNAPSHOT] Using compressor: ${compressor} (${isChunked ? 'chunked' : 'legacy'})`);

    // Check cancellation
    if (isCancelled) throw new Error('Snapshot cancelled');

    // Prepare .system-config directory with system files and package lists
    console.log('[SNAPSHOT] Preparing system config...');
    await runCommand(`mkdir -p "${BACKUP_ROOT}/.system-config"`, 5000);

    // Export conversation state for fork/resume
    console.log('[SNAPSHOT] Exporting conversation state...');
    if (globalState.claudeService) {
      try {
        const conversationState = globalState.claudeService.exportState();
        await runCommand(`mkdir -p "$(dirname ${CONVERSATION_STATE_FILE})"`, 5000);
        await fs.writeFile(CONVERSATION_STATE_FILE, JSON.stringify(conversationState, null, 2));
        console.log(`[SNAPSHOT] Conversation state exported: ${conversationState.messages.length} messages, ${conversationState.pastConversations.length} past conversations, sessionId: ${conversationState.sessionId}`);
      } catch (e) {
        console.error('[SNAPSHOT] Failed to export conversation state:', e);
        // Continue with snapshot even if conversation state export fails
      }
    } else {
      console.log('[SNAPSHOT] No Claude service available, skipping conversation state export');
    }

    // Capture keyboard layout from dconf (where Budgie GUI stores it) and write to system config format
    // This is the SINGLE source of truth for keyboard - we read from runtime dconf and persist to /etc/default/keyboard format
    console.log('[SNAPSHOT] Capturing keyboard layout from dconf...');
    const keyboardResult = await runCommand(
      `dconf read /org/gnome/desktop/input-sources/sources`,
      5000
    );
    // Parse dconf format: [('xkb', 'fr+azerty')] or [('xkb', 'us')]
    const dconfSources = keyboardResult.stdout.trim();
    const layoutMatch = dconfSources.match(/\('xkb',\s*'([^']+)'\)/);
    if (!layoutMatch) {
      throw new Error(`Failed to parse keyboard layout from dconf: ${dconfSources}`);
    }
    const layout = layoutMatch[1]; // e.g., 'fr+azerty' or 'us' or 'fr'
    const [xkbLayout, xkbVariant] = layout.includes('+') ? layout.split('+') : [layout, ''];
    console.log(`[SNAPSHOT] Keyboard layout from dconf: ${xkbLayout}, variant: ${xkbVariant || '(none)'}`);

    // Write keyboard config in /etc/default/keyboard format
    const keyboardConfig = `# KEYBOARD CONFIGURATION FILE
# Captured from dconf during snapshot

XKBMODEL="pc105"
XKBLAYOUT="${xkbLayout}"
XKBVARIANT="${xkbVariant}"
XKBOPTIONS=""

BACKSPACE="guess"
`;
    await runCommand(`cat > "${BACKUP_ROOT}/.system-config/keyboard" << 'KEYBOARDEOF'
${keyboardConfig}
KEYBOARDEOF`, 5000);
    console.log(`[SNAPSHOT] Saved keyboard config: layout=${xkbLayout}, variant=${xkbVariant}`);

    // Copy other system config files (timezone, locale) - NOT keyboard, we handled that above
    const otherSystemFiles = SYSTEM_CONFIG_FILES.filter(f => !f.includes('keyboard'));
    for (const sysFile of otherSystemFiles) {
      const checkResult = await runCommand(
        `sudo test -f "${sysFile}" && sudo cp "${sysFile}" "${BACKUP_ROOT}/.system-config/$(basename ${sysFile})" && sudo chown ariana:ariana "${BACKUP_ROOT}/.system-config/$(basename ${sysFile})" && echo "copied"`,
        5000
      );
      if (checkResult.stdout.includes('copied')) {
        console.log(`[SNAPSHOT] Including system file: ${sysFile}`);
      }
    }

    // Export dconf settings (desktop preferences like wallpaper, theme, etc)
    // We export EVERYTHING except panel-specific UUIDs that break on fork
    console.log('[SNAPSHOT] Exporting dconf settings...');
    await runCommand(
      `dconf dump / > "${BACKUP_ROOT}/.system-config/dconf-settings.txt"`,
      30000
    );
    // Remove panel-specific settings that contain session UUIDs
    // These paths contain UUIDs that are machine-specific and break the panel on fork:
    // - /com/solus-project/budgie-panel/panels/ - panel instance configs with UUIDs
    // - /com/solus-project/budgie-panel/applets/ - applet configs with UUIDs
    await runCommand(
      `sed -i '/^\\[com\\/solus-project\\/budgie-panel\\/panels\\//,/^\\[/{ /^\\[com\\/solus-project\\/budgie-panel\\/panels\\//d; /^\\[/!d; }' "${BACKUP_ROOT}/.system-config/dconf-settings.txt"`,
      5000
    );
    await runCommand(
      `sed -i '/^\\[com\\/solus-project\\/budgie-panel\\/applets\\//,/^\\[/{ /^\\[com\\/solus-project\\/budgie-panel\\/applets\\//d; /^\\[/!d; }' "${BACKUP_ROOT}/.system-config/dconf-settings.txt"`,
      5000
    );
    // Also remove the main panel config that references UUID lists
    await runCommand(
      `sed -i '/^\\[com\\/solus-project\\/budgie-panel\\]$/,/^\\[/{ /^\\[com\\/solus-project\\/budgie-panel\\]$/d; /^\\[/!d; }' "${BACKUP_ROOT}/.system-config/dconf-settings.txt"`,
      5000
    );
    console.log('[SNAPSHOT] Exported dconf settings (excluding panel UUIDs)');

    // Capture user-installed apt packages
    console.log('[SNAPSHOT] Capturing apt packages...');
    const hasBasePackages = await runCommand(`[ -f "${BASE_APT_PACKAGES_FILE}" ] && echo "exists"`, 5000);
    if (hasBasePackages.stdout.includes('exists')) {
      await runCommand(
        `comm -13 <(sort "${BASE_APT_PACKAGES_FILE}") <(dpkg --get-selections | grep -v deinstall | cut -f1 | sort) > "${APT_PACKAGES_FILE}"`,
        30000
      );
      const countResult = await runCommand(`wc -l < "${APT_PACKAGES_FILE}"`, 5000);
      const newPackageCount = parseInt(countResult.stdout.trim()) || 0;
      if (newPackageCount > 0) {
        console.log(`[SNAPSHOT] Found ${newPackageCount} user-installed apt packages`);
      } else {
        await runCommand(`rm -f "${APT_PACKAGES_FILE}"`, 5000);
      }
    }

    // Capture user-installed snap packages
    console.log('[SNAPSHOT] Capturing snap packages...');
    const hasBaseSnaps = await runCommand(`[ -f "${BASE_SNAP_PACKAGES_FILE}" ] && echo "exists"`, 5000);
    if (hasBaseSnaps.stdout.includes('exists')) {
      await runCommand(
        `comm -13 <(sort "${BASE_SNAP_PACKAGES_FILE}") <(snap list | tail -n +2 | awk '{print $1}' | sort) > "${SNAP_PACKAGES_FILE}"`,
        30000
      );
      const countResult = await runCommand(`wc -l < "${SNAP_PACKAGES_FILE}"`, 5000);
      const newSnapCount = parseInt(countResult.stdout.trim()) || 0;
      if (newSnapCount > 0) {
        console.log(`[SNAPSHOT] Found ${newSnapCount} user-installed snap packages`);
      } else {
        await runCommand(`rm -f "${SNAP_PACKAGES_FILE}"`, 5000);
      }
    }

    // Check cancellation
    if (isCancelled) throw new Error('Snapshot cancelled');

    // Create full backup of entire /home/ariana
    // EXCLUDE:
    // - .config/dconf: We export this separately via dconf dump (with panel UUIDs stripped)
    // - .cache: Temporary cache data, not needed
    // - .local/share/logs/RustDesk: RustDesk log files cause permission issues on restore
    // User settings (wallpaper, theme, etc) are restored via dconf load during restore
    console.log('[SNAPSHOT] Creating backup of /home/ariana...');
    // Note: Don't suppress stderr (no 2>/dev/null) so we can see actual errors
    // tar warnings about "file changed as we read it" are expected and handled via exit code 1
    const tarCmd = `tar -I '${compressor}' -cf "${tempFile}" -C "${BACKUP_ROOT}" --exclude='./.config/dconf' --exclude='./.cache' --exclude='./.local/share/logs/RustDesk' .`;

    const tarStart = Date.now();
    const tarResult = await runCommand(tarCmd, 600000); // 10 min timeout

    // Log any tar warnings/errors for debugging
    if (tarResult.stderr) {
      console.log(`[SNAPSHOT] tar stderr: ${tarResult.stderr.slice(-1000)}`);
    }

    if (tarResult.code !== 0 && tarResult.code !== 1) {
      // Code 1 means "some files changed during archiving" which is OK
      throw new Error(`Failed to create archive (exit code ${tarResult.code}): ${tarResult.stderr.slice(-500)}`);
    }

    const tarDuration = Date.now() - tarStart;
    console.log(`[SNAPSHOT] Archive created in ${formatDuration(tarDuration)}`);

    // Check cancellation before upload
    if (isCancelled) throw new Error('Snapshot cancelled');

    // Get archive size
    const stats = await fs.stat(tempFile);
    const sizeBytes = stats.size;
    console.log(`[SNAPSHOT] Archive size: ${(sizeBytes / 1024 / 1024).toFixed(2)} MB`);

    let chunkCount = 0;
    let chunkManifest: { file: string; size: number; sha256: string }[] = [];

    if (isChunked) {
      // === CHUNKED UPLOAD PATH ===
      const effectiveChunkSize = chunkSizeBytes || (200 * 1024 * 1024);
      console.log(`[SNAPSHOT] Splitting into ${effectiveChunkSize / (1024 * 1024)}MB chunks...`);

      // Split the archive into chunks in /dev/shm (RAM)
      const splitResult = await runCommand(
        `split -b ${effectiveChunkSize} -d -a 2 "${TEMP_FILE_ZSTD}" "${CHUNK_PREFIX}"`,
        120000
      );
      if (splitResult.code !== 0) {
        throw new Error(`Failed to split archive: ${splitResult.stderr}`);
      }

      // List the chunk files, sorted
      const lsResult = await runCommand(`ls -1 ${CHUNK_PREFIX}* | sort`, 5000);
      const chunkFiles = lsResult.stdout.trim().split('\n').filter(f => f);
      chunkCount = chunkFiles.length;
      console.log(`[SNAPSHOT] Split into ${chunkCount} chunks`);

      if (chunkCount > presignedUploadUrls!.length) {
        throw new Error(`Too many chunks (${chunkCount}) for available URLs (${presignedUploadUrls!.length}). Increase chunk count or chunk size.`);
      }

      // Integrity check: verify split produced correct total size and compute checksums
      chunkManifest = [];
      let splitTotalSize = 0;
      for (const chunkFile of chunkFiles) {
        const chunkStat = await fs.stat(chunkFile);
        const sha256Result = await runCommand(`sha256sum "${chunkFile}" | cut -d' ' -f1`, 10000);
        const sha256 = sha256Result.stdout.trim();
        chunkManifest.push({ file: chunkFile, size: chunkStat.size, sha256 });
        splitTotalSize += chunkStat.size;
        console.log(`[SNAPSHOT] Chunk ${chunkFile}: ${(chunkStat.size / 1024 / 1024).toFixed(1)}MB sha256=${sha256}`);
      }

      if (splitTotalSize !== sizeBytes) {
        throw new Error(`Split integrity failure: archive=${sizeBytes} bytes but chunks total=${splitTotalSize} bytes (delta=${splitTotalSize - sizeBytes})`);
      }
      console.log(`[SNAPSHOT] Split integrity OK: ${chunkCount} chunks, ${splitTotalSize} bytes == archive size`);

      // Remove the full archive from /dev/shm since we have chunks now
      await fs.unlink(TEMP_FILE_ZSTD).catch(() => {});

      // Upload chunks in parallel (MAX_PARALLEL_UPLOADS at a time)
      console.log(`[SNAPSHOT] Uploading ${chunkCount} chunks (${MAX_PARALLEL_UPLOADS} parallel)...`);
      const uploadStart = Date.now();

      for (let i = 0; i < chunkCount; i += MAX_PARALLEL_UPLOADS) {
        if (isCancelled) throw new Error('Snapshot cancelled');

        const batch = chunkFiles.slice(i, i + MAX_PARALLEL_UPLOADS);
        const batchPromises = batch.map((chunkFile, batchIdx) => {
          const urlIdx = i + batchIdx;
          const url = presignedUploadUrls![urlIdx];
          return uploadChunk(chunkFile, url, urlIdx);
        });

        await Promise.all(batchPromises);
        console.log(`[SNAPSHOT] Uploaded chunks ${i + 1}-${Math.min(i + MAX_PARALLEL_UPLOADS, chunkCount)} of ${chunkCount}`);
      }

      const uploadDuration = Date.now() - uploadStart;
      console.log(`[SNAPSHOT] All chunks uploaded in ${formatDuration(uploadDuration)}`);

      // Cleanup chunk files
      await runCommand(`rm -f ${CHUNK_PREFIX}*`, 5000);

    } else {
      // === LEGACY SINGLE-FILE UPLOAD PATH ===
      if (!presignedUploadUrl) {
        throw new Error('No presignedUploadUrl or presignedUploadUrls provided');
      }

      console.log('[SNAPSHOT] Uploading to R2 (legacy single file)...');
      const uploadStart = Date.now();

      const sizeMB = sizeBytes / (1024 * 1024);
      const uploadTimeoutSec = Math.max(60, Math.ceil(sizeMB / 4));
      console.log(`[SNAPSHOT] Upload timeout: ${uploadTimeoutSec}s for ${sizeMB.toFixed(0)}MB`);

      const uploadCmd = `curl -X PUT --upload-file "${TEMP_FILE_LEGACY}" -H "Content-Type: application/gzip" --connect-timeout 10 --max-time ${uploadTimeoutSec} --fail -s -S "${presignedUploadUrl}"`;

      await new Promise<void>((resolve, reject) => {
        const shell = spawn('bash', ['-c', uploadCmd], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        currentProcess = shell;

        const progressInterval = setInterval(() => {
          const elapsed = formatDuration(Date.now() - uploadStart);
          console.log(`[SNAPSHOT] Still uploading... (${elapsed})`);
        }, 30000);

        let stderr = '';
        shell.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        shell.on('exit', (code, signal) => {
          clearInterval(progressInterval);
          currentProcess = null;

          if (signal === 'SIGKILL' || isCancelled) {
            reject(new Error('Snapshot cancelled'));
          } else if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Upload failed with code ${code}: ${stderr.slice(-500)}`));
          }
        });

        shell.on('error', (err) => {
          clearInterval(progressInterval);
          currentProcess = null;
          reject(err);
        });
      });

      const uploadDuration = Date.now() - uploadStart;
      console.log(`[SNAPSHOT] Upload completed in ${formatDuration(uploadDuration)}`);

      // Cleanup temp file
      await fs.unlink(TEMP_FILE_LEGACY).catch(() => {});
      chunkCount = 1;
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[SNAPSHOT] SUCCESS - ${(sizeBytes / 1024 / 1024).toFixed(2)} MB in ${formatDuration(totalDuration)}`);

    // Clear current snapshot tracking
    currentSnapshotId = null;

    const response = {
      success: true,
      sizeBytes: sizeBytes.toString(),
      chunkCount,
      chunks: chunkManifest.map(c => ({ size: c.size, sha256: c.sha256 })),
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });

  } catch (error) {
    // Cleanup temp files on error (both legacy and chunked)
    await fs.unlink(TEMP_FILE_LEGACY).catch(() => {});
    await fs.unlink(TEMP_FILE_ZSTD).catch(() => {});
    await runCommand(`rm -f ${CHUNK_PREFIX}*`, 5000);

    // Clear current snapshot tracking
    currentSnapshotId = null;
    currentProcess = null;

    const totalDuration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const wasCancelled = errorMessage === 'Snapshot cancelled';

    if (wasCancelled) {
      console.log(`[SNAPSHOT] Cancelled after ${formatDuration(totalDuration)}`);
    } else {
      console.error(`[SNAPSHOT] FAILED after ${formatDuration(totalDuration)}:`, errorMessage);
    }

    const response = {
      success: false,
      error: errorMessage,
      cancelled: wasCancelled,
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
  }
});

/**
 * Upload a single chunk file to R2 using curl.
 * Each chunk is a known-size file, so Content-Length is set automatically by curl.
 */
async function uploadChunk(chunkFile: string, presignedUrl: string, index: number): Promise<void> {
  const chunkStats = await fs.stat(chunkFile);
  const chunkSizeMB = (chunkStats.size / (1024 * 1024)).toFixed(1);
  const uploadTimeoutSec = Math.max(60, Math.ceil(chunkStats.size / (1024 * 1024) / 4));

  console.log(`[SNAPSHOT] Uploading chunk ${index} (${chunkSizeMB}MB, timeout ${uploadTimeoutSec}s)`);

  const uploadCmd = `curl -X PUT --upload-file "${chunkFile}" -H "Content-Type: application/zstd" --connect-timeout 10 --max-time ${uploadTimeoutSec} --fail -s -S "${presignedUrl}"`;

  return new Promise<void>((resolve, reject) => {
    const shell = spawn('bash', ['-c', uploadCmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    shell.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    shell.on('exit', (code, signal) => {
      if (signal === 'SIGKILL' || isCancelled) {
        reject(new Error('Snapshot cancelled'));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Chunk ${index} upload failed with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    shell.on('error', (err) => {
      reject(new Error(`Chunk ${index} upload spawn error: ${err.message}`));
    });
  });
}

export default app;
