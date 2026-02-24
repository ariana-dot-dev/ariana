import { Hono } from 'hono';
import { encryption } from '../cryptoSingleton';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import {
  formatDuration,
  runCommand,
} from './snapshotUtils';

const app = new Hono();

const BACKUP_ROOT = '/home/ariana';
const TEMP_FILE_LEGACY = '/tmp/restore-snapshot.tar.gz';
// Use /tmp instead of /dev/shm: the restore process stops lightdm which tears down
// the ariana user session. systemd-logind's RemoveIPC=yes then deletes ALL ariana-owned
// files in /dev/shm, killing our chunks mid-extraction.
const CHUNK_PREFIX = '/tmp/restore-chunk-';
const MAX_PARALLEL_DOWNLOADS = 4;
const SYSTEM_CONFIG_DIR = '/home/ariana/.system-config';

// System config files that were backed up - restore them to their original locations
// We use sudo to write these since they're system files
const SYSTEM_CONFIG_RESTORE_MAP: Record<string, string> = {
  'keyboard': '/etc/default/keyboard',
  'timezone': '/etc/timezone',
  'locale': '/etc/default/locale',
};

// Files containing user-installed packages
const APT_PACKAGES_FILE = `${SYSTEM_CONFIG_DIR}/apt-packages.txt`;
const SNAP_PACKAGES_FILE = `${SYSTEM_CONFIG_DIR}/snap-packages.txt`;

interface RestoreSnapshotConfig {
  // Chunked download (new)
  presignedDownloadUrls?: string[];
  // Legacy single-file download
  presignedDownloadUrl?: string;
}

app.post('/', async (c) => {
  const startTime = Date.now();
  console.log('[RESTORE-SNAPSHOT] Request received');
  const body = await c.req.json();

  const { valid, data, error } = await encryption.decryptAndValidate<RestoreSnapshotConfig>(body);

  if (!valid) {
    console.log('[RESTORE-SNAPSHOT] Invalid data', '\nerror: ', error);
    return c.json({ error }, 400);
  }

  const { presignedDownloadUrls, presignedDownloadUrl } = data!;
  const isChunked = Array.isArray(presignedDownloadUrls) && presignedDownloadUrls.length > 0;

  try {
    const decompressor = isChunked ? 'zstd -d -T8' : 'pigz -d -p 8';
    console.log(`[RESTORE-SNAPSHOT] Using decompressor: ${decompressor} (${isChunked ? 'chunked' : 'legacy'})`);

    // Stop lightdm BEFORE extracting snapshot
    // This ensures no desktop processes are accessing files during extraction
    console.log('[RESTORE-SNAPSHOT] Stopping display manager before extraction...');
    await runCommand('sudo systemctl stop lightdm', 15000);

    // Backup Sunshine config BEFORE extraction.
    // During machine parking, Sunshine SSL certs were generated and moonlight-web
    // paired with them. The snapshot will overwrite /home/ariana/.config/sunshine/
    // with the source agent's different certs, breaking the pairing.
    // We preserve the parking-time certs so the pairing stays valid.
    console.log('[RESTORE-SNAPSHOT] Backing up Sunshine config (preserving parking-time pairing)...');
    await runCommand('rm -rf /tmp/sunshine-parking-backup && cp -a /home/ariana/.config/sunshine /tmp/sunshine-parking-backup 2>/dev/null || true', 5000);

    if (isChunked) {
      // === CHUNKED DOWNLOAD + EXTRACT PATH ===
      const chunkCount = presignedDownloadUrls!.length;
      console.log(`[RESTORE-SNAPSHOT] Downloading ${chunkCount} chunks (${MAX_PARALLEL_DOWNLOADS} parallel)...`);
      const downloadStart = Date.now();

      // Download all chunks in parallel batches to /dev/shm
      for (let i = 0; i < chunkCount; i += MAX_PARALLEL_DOWNLOADS) {
        const batch = presignedDownloadUrls!.slice(i, i + MAX_PARALLEL_DOWNLOADS);
        const batchPromises = batch.map((url, batchIdx) => {
          const idx = i + batchIdx;
          const chunkFile = `${CHUNK_PREFIX}${String(idx).padStart(2, '0')}`;
          return downloadChunk(url, chunkFile, idx);
        });

        await Promise.all(batchPromises);
        console.log(`[RESTORE-SNAPSHOT] Downloaded chunks ${i + 1}-${Math.min(i + MAX_PARALLEL_DOWNLOADS, chunkCount)} of ${chunkCount}`);
      }

      const downloadDuration = Date.now() - downloadStart;

      // Build ordered chunk file list
      const chunkFiles: string[] = [];
      for (let i = 0; i < chunkCount; i++) {
        chunkFiles.push(`${CHUNK_PREFIX}${String(i).padStart(2, '0')}`);
      }

      // Verify all chunk files exist, have non-zero size, and compute checksums
      let totalBytes = 0;
      const downloadedChunks: { file: string; size: number; sha256: string }[] = [];
      for (const chunkFile of chunkFiles) {
        try {
          const stat = await fs.stat(chunkFile);
          if (stat.size === 0) {
            throw new Error(`Chunk file ${chunkFile} is empty (0 bytes)`);
          }
          const sha256Result = await runCommand(`sha256sum "${chunkFile}" | cut -d' ' -f1`, 10000);
          const sha256 = sha256Result.stdout.trim();
          downloadedChunks.push({ file: chunkFile, size: stat.size, sha256 });
          totalBytes += stat.size;
          console.log(`[RESTORE-SNAPSHOT] Chunk ${chunkFile}: ${(stat.size / 1024 / 1024).toFixed(1)}MB sha256=${sha256}`);
        } catch (e: any) {
          if (e.code === 'ENOENT') {
            const diagnostic = await collectDiagnostics();
            throw new Error(`Chunk file ${chunkFile} missing after download.\n${diagnostic}`);
          }
          throw e;
        }
      }
      console.log(`[RESTORE-SNAPSHOT] Downloaded ${(totalBytes / 1024 / 1024).toFixed(2)} MB in ${formatDuration(downloadDuration)} (${chunkCount} chunks, all checksummed)`);

      // Final pre-extraction check: verify all chunk files are still on disk right before we use them
      console.log('[RESTORE-SNAPSHOT] Pre-extraction verification...');
      for (const chunkFile of chunkFiles) {
        try {
          await fs.stat(chunkFile);
        } catch (e: any) {
          const diagnostic = await collectDiagnostics();
          throw new Error(`CRITICAL: Chunk ${chunkFile} disappeared between checksum and extraction!\n${diagnostic}`);
        }
      }

      // Concatenate chunks in order and pipe through decompressor + tar
      // Use pipefail so the pipeline fails on the first broken command
      console.log('[RESTORE-SNAPSHOT] Extracting chunked snapshot...');
      const extractStart = Date.now();

      const extractCmd = `set -o pipefail; cat ${chunkFiles.join(' ')} | ${decompressor} | tar xf - -C "${BACKUP_ROOT}"`;
      const extractResult = await runCommand(extractCmd, 600000); // 10 min timeout

      if (extractResult.code !== 0) {
        const diagnostic = await collectDiagnostics();
        throw new Error(`Failed to extract chunked snapshot (exit ${extractResult.code}): ${extractResult.stderr}\n${diagnostic}`);
      }

      const extractDuration = Date.now() - extractStart;
      console.log(`[RESTORE-SNAPSHOT] Extracted in ${formatDuration(extractDuration)}`);

      // Cleanup chunks from /dev/shm
      await runCommand(`rm -f ${CHUNK_PREFIX}*`, 5000);

    } else {
      // === LEGACY SINGLE-FILE DOWNLOAD + EXTRACT PATH ===
      if (!presignedDownloadUrl) {
        throw new Error('No presignedDownloadUrl or presignedDownloadUrls provided');
      }

      // Download from R2
      console.log('[RESTORE-SNAPSHOT] Downloading snapshot from R2 (legacy single file)...');
      const downloadStart = Date.now();

      await new Promise<void>((resolve, reject) => {
        const curl = spawn('curl', [
          '-o', TEMP_FILE_LEGACY,
          '--fail',
          '--silent',
          '--show-error',
          '--connect-timeout', '10',
          '--max-time', '120',
          presignedDownloadUrl
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        curl.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        curl.on('exit', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`curl download failed with code ${code}: ${stderr}`));
          }
        });

        curl.on('error', (err) => {
          reject(new Error(`curl spawn error: ${err.message}`));
        });
      });

      const downloadDuration = Date.now() - downloadStart;

      // Get file size for logging
      const stats = await fs.stat(TEMP_FILE_LEGACY);
      console.log(`[RESTORE-SNAPSHOT] Downloaded ${(stats.size / 1024 / 1024).toFixed(2)} MB in ${formatDuration(downloadDuration)}`);

      // Extract delta archive on top of /home/ariana
      console.log('[RESTORE-SNAPSHOT] Extracting snapshot...');
      const extractStart = Date.now();

      const extractCmd = `tar -I '${decompressor}' -xf "${TEMP_FILE_LEGACY}" -C "${BACKUP_ROOT}"`;
      const extractResult = await runCommand(extractCmd, 600000); // 10 min timeout

      if (extractResult.code !== 0) {
        throw new Error(`Failed to extract snapshot: ${extractResult.stderr}`);
      }

      const extractDuration = Date.now() - extractStart;
      console.log(`[RESTORE-SNAPSHOT] Extracted in ${formatDuration(extractDuration)}`);
    }

    // Fix ownership for home directory
    console.log('[RESTORE-SNAPSHOT] Fixing file ownership...');
    await runCommand('sudo chown -R ariana:ariana /home/ariana', 60000);

    // Restore parking-time Sunshine config over whatever the snapshot brought in.
    // This keeps the SSL certs and credentials that match the moonlight-web pairing.
    console.log('[RESTORE-SNAPSHOT] Restoring parking-time Sunshine config...');
    await runCommand(`
      if [ -d /tmp/sunshine-parking-backup ]; then
        rm -rf /home/ariana/.config/sunshine
        mv /tmp/sunshine-parking-backup /home/ariana/.config/sunshine
        chown -R ariana:ariana /home/ariana/.config/sunshine
        echo "Sunshine config restored from parking backup"
      fi
    `, 5000);

    // Clear any leftover desktop streaming config from previous snapshots
    console.log('[RESTORE-SNAPSHOT] Clearing desktop streaming config...');
    await runCommand('rm -rf /home/ariana/.config/rustdesk /home/ariana/.config/rustdesk-ariana /etc/rustdesk', 5000);

    // Reset gnome-keyring to prevent password prompts
    console.log('[RESTORE-SNAPSHOT] Resetting gnome-keyring...');
    await runCommand(`
      rm -rf /home/ariana/.local/share/keyrings/*
      mkdir -p /home/ariana/.local/share/keyrings
      echo 'default' > /home/ariana/.local/share/keyrings/default
      cat > /home/ariana/.local/share/keyrings/Default_keyring.keyring <<'EOF'
[keyring]
display-name=Default keyring
ctime=0
mtime=0
lock-on-idle=false
lock-after=false
EOF
      chmod 600 /home/ariana/.local/share/keyrings/Default_keyring.keyring
      chown -R ariana:ariana /home/ariana/.local/share/keyrings
    `, 5000);

    // Clear Chrome lock files that reference the old machine's hostname
    // Chrome uses SingletonLock to prevent multiple instances, but it contains the old hostname
    // which prevents Chrome from launching on the new machine
    console.log('[RESTORE-SNAPSHOT] Clearing Chrome lock files...');
    await runCommand('rm -f /home/ariana/.config/google-chrome/SingletonLock /home/ariana/.config/google-chrome/SingletonCookie /home/ariana/.config/google-chrome/SingletonSocket', 5000);

    // Fix Chrome "didn't shut down correctly" message
    // When Chrome is running during snapshot, exit_type is "Crashed" which triggers the warning
    // Change it to "Normal" so Chrome starts cleanly
    console.log('[RESTORE-SNAPSHOT] Fixing Chrome exit_type...');
    await runCommand('sed -i \'s/"exit_type":"Crashed"/"exit_type":"Normal"/g\' /home/ariana/.config/google-chrome/Default/Preferences', 5000);

    // Copy dconf settings file to a location that persists after cleanup
    // We'll import it after lightdm starts (dconf needs dbus session)
    const dconfSettingsFile = `${SYSTEM_CONFIG_DIR}/dconf-settings.txt`;
    const dconfExists = await runCommand(`[ -f "${dconfSettingsFile}" ] && echo "exists"`, 5000);
    const hasDconfSettings = dconfExists.stdout.includes('exists');
    if (hasDconfSettings) {
      await runCommand(`cp "${dconfSettingsFile}" /tmp/dconf-settings-restore.txt`, 5000);
      console.log('[RESTORE-SNAPSHOT] Dconf settings prepared for import after desktop starts');
    }

    // Restore system config files from .system-config directory
    // We use sudo because these are system files that need root to write
    console.log('[RESTORE-SNAPSHOT] Restoring system config files...');
    for (const [filename, destPath] of Object.entries(SYSTEM_CONFIG_RESTORE_MAP)) {
      const srcPath = `${SYSTEM_CONFIG_DIR}/${filename}`;
      const checkResult = await runCommand(`[ -f "${srcPath}" ] && echo "exists"`, 5000);
      if (checkResult.stdout.includes('exists')) {
        // Ensure destination directory exists and copy system file back
        const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
        await runCommand(`sudo mkdir -p "${destDir}"`, 5000);
        const copyResult = await runCommand(`sudo cp "${srcPath}" "${destPath}"`, 5000);
        if (copyResult.code === 0) {
          console.log(`[RESTORE-SNAPSHOT] Restored system config: ${destPath}`);
        } else {
          console.error(`[RESTORE-SNAPSHOT] Failed to restore ${destPath}: ${copyResult.stderr}`);
        }
      }
    }

    // Apply keyboard settings if keyboard config was restored
    const keyboardRestored = await runCommand(`[ -f "${SYSTEM_CONFIG_DIR}/keyboard" ] && echo "exists"`, 5000);
    if (keyboardRestored.stdout.includes('exists')) {
      console.log('[RESTORE-SNAPSHOT] Applying keyboard settings...');
      // Update console keyboard (for TTY)
      await runCommand('sudo setupcon --save-only', 10000);
    }

    // Apply timezone if restored
    const timezoneRestored = await runCommand(`[ -f "${SYSTEM_CONFIG_DIR}/timezone" ] && echo "exists"`, 5000);
    if (timezoneRestored.stdout.includes('exists')) {
      console.log('[RESTORE-SNAPSHOT] Applying timezone settings...');
      // Read the timezone and update /etc/localtime symlink
      const tzResult = await runCommand(`cat "${SYSTEM_CONFIG_DIR}/timezone"`, 5000);
      const timezone = tzResult.stdout.trim();
      if (timezone) {
        await runCommand(`sudo ln -sf /usr/share/zoneinfo/${timezone} /etc/localtime`, 5000);
        console.log(`[RESTORE-SNAPSHOT] Timezone set to: ${timezone}`);
      }
    }

    // Apply locale if restored
    const localeRestored = await runCommand(`[ -f "${SYSTEM_CONFIG_DIR}/locale" ] && echo "exists"`, 5000);
    if (localeRestored.stdout.includes('exists')) {
      console.log('[RESTORE-SNAPSHOT] Locale settings restored (will apply on next login)');
    }

    // Reinstall user-installed apt packages
    const aptPackagesExist = await runCommand(`[ -f "${APT_PACKAGES_FILE}" ] && echo "exists"`, 5000);
    if (aptPackagesExist.stdout.includes('exists')) {
      console.log('[RESTORE-SNAPSHOT] Reinstalling user-installed apt packages...');

      // Read the package list
      const packagesResult = await runCommand(`cat "${APT_PACKAGES_FILE}"`, 5000);
      const packages = packagesResult.stdout.trim();

      if (packages) {
        const packageCount = packages.split('\n').filter(p => p.trim()).length;
        console.log(`[RESTORE-SNAPSHOT] Installing ${packageCount} apt packages...`);

        // Update apt cache and install packages
        // Using xargs to handle the package list properly
        const installResult = await runCommand(
          `sudo apt-get update -qq && cat "${APT_PACKAGES_FILE}" | xargs sudo apt-get install -y -qq`,
          600000 // 10 minutes timeout for package installation
        );

        if (installResult.code === 0) {
          console.log(`[RESTORE-SNAPSHOT] Successfully installed ${packageCount} apt packages`);
        } else {
          console.error(`[RESTORE-SNAPSHOT] Some apt packages may have failed to install: ${installResult.stderr}`);
        }
      }
    }

    // Reinstall user-installed snap packages
    const snapPackagesExist = await runCommand(`[ -f "${SNAP_PACKAGES_FILE}" ] && echo "exists"`, 5000);
    if (snapPackagesExist.stdout.includes('exists')) {
      const snapdInstalled = await runCommand(`which snap 2>/dev/null && echo "exists"`, 5000);
      if (snapdInstalled.stdout.includes('exists')) {
        console.log('[RESTORE-SNAPSHOT] Reinstalling user-installed snap packages...');

        const packagesResult = await runCommand(`cat "${SNAP_PACKAGES_FILE}"`, 5000);
        const packages = packagesResult.stdout.trim();

        if (packages) {
          const packageCount = packages.split('\n').filter(p => p.trim()).length;
          console.log(`[RESTORE-SNAPSHOT] Installing ${packageCount} snap packages...`);

          // Install snaps one by one (snap doesn't support batch installs like apt)
          const snapList = packages.split('\n').filter(p => p.trim());
          let successCount = 0;
          let failCount = 0;

          for (const snapName of snapList) {
            const installResult = await runCommand(
              `sudo snap install ${snapName}`,
              120000 // 2 minutes per snap
            );

            if (installResult.code === 0) {
              successCount++;
              console.log(`[RESTORE-SNAPSHOT] Installed snap: ${snapName}`);
            } else {
              failCount++;
              console.error(`[RESTORE-SNAPSHOT] Failed to install snap ${snapName}: ${installResult.stderr}`);
            }
          }

          console.log(`[RESTORE-SNAPSHOT] Snap installation complete: ${successCount} succeeded, ${failCount} failed`);
        }
      }
    }

    // Start lightdm to start the desktop session
    // Budgie panel starts fresh with defaults (panel UUIDs were stripped from dconf)
    console.log('[RESTORE-SNAPSHOT] Starting display manager...');
    await runCommand('sudo systemctl start lightdm', 15000);

    // Wait for desktop session to be ready
    console.log('[RESTORE-SNAPSHOT] Waiting for desktop session to start...');
    await runCommand('sleep 5', 10000);

    // Start Moonlight desktop streaming services (must run AFTER lightdm)
    console.log('[RESTORE-SNAPSHOT] Starting desktop streaming services...');
    await runCommand(`
      sudo systemctl start sunshine
      sleep 1
      sudo systemctl start moonlight-web
    `, 30000);

    // Import dconf settings if they exist (dconf needs dbus session)
    if (hasDconfSettings) {
      // Import dconf settings using the user's dbus session
      console.log('[RESTORE-SNAPSHOT] Importing dconf settings (wallpaper, theme, keyboard, etc)...');
      await runCommand(`
        set -e
        # Find the user's dbus session from budgie-panel process
        DBUS_ADDR=$(grep -z DBUS_SESSION_BUS_ADDRESS /proc/$(pgrep -u ariana budgie-panel | head -1)/environ | cut -d= -f2- | tr -d '\\0')

        # Use the running session's dbus to load settings
        DBUS_SESSION_BUS_ADDRESS="$DBUS_ADDR" sudo -u ariana dconf load / < /tmp/dconf-settings-restore.txt

        rm -f /tmp/dconf-settings-restore.txt
        echo "Dconf settings imported"
      `, 60000);
      console.log('[RESTORE-SNAPSHOT] Dconf settings imported');
    }

    // Cleanup system config staging directory
    await runCommand(`rm -rf "${SYSTEM_CONFIG_DIR}"`, 5000);

    // Cleanup temp file (legacy path)
    await fs.unlink(TEMP_FILE_LEGACY).catch(() => {});
    console.log('[RESTORE-SNAPSHOT] Cleaned up temp files');

    const totalDuration = Date.now() - startTime;
    console.log(`[RESTORE-SNAPSHOT] SUCCESS - completed in ${formatDuration(totalDuration)}`);

    const response = {
      success: true,
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });

  } catch (error) {
    console.error('[RESTORE-SNAPSHOT] Failed:', error);

    // Cleanup temp files on error (both legacy and chunked)
    await fs.unlink(TEMP_FILE_LEGACY).catch(() => {});
    await runCommand(`rm -f ${CHUNK_PREFIX}*`, 5000);

    const response = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    const encryptedResponse = encryption.encrypt(response);
    return c.json({ encrypted: encryptedResponse });
  }
});

/**
 * Download a single chunk from R2 using curl.
 */
async function downloadChunk(url: string, destFile: string, index: number): Promise<void> {
  console.log(`[RESTORE-SNAPSHOT] Downloading chunk ${index} -> ${destFile}`);

  return new Promise<void>((resolve, reject) => {
    const curl = spawn('curl', [
      '-o', destFile,
      '--fail',
      '--silent',
      '--show-error',
      '--connect-timeout', '10',
      '--max-time', '120',
      url
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    curl.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    curl.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Chunk ${index} download failed with code ${code}: ${stderr}`));
      }
    });

    curl.on('error', (err) => {
      reject(new Error(`Chunk ${index} download spawn error: ${err.message}`));
    });
  });
}

/**
 * Collect full system diagnostics when something goes wrong during restore.
 * This captures everything we need to understand why chunks disappeared.
 */
async function collectDiagnostics(): Promise<string> {
  const parts: string[] = ['--- RESTORE DIAGNOSTICS ---'];
  try {
    const tmpLs = await runCommand(`ls -la /tmp/restore-chunk-* 2>&1`, 5000);
    parts.push(`/tmp restore chunks:\n${tmpLs.stdout}`);

    const tmpDf = await runCommand(`df -h /tmp 2>&1`, 5000);
    parts.push(`/tmp space:\n${tmpDf.stdout}`);

    const memInfo = await runCommand(`free -m 2>&1`, 5000);
    parts.push(`Memory:\n${memInfo.stdout}`);

    const lsofTmp = await runCommand(`sudo lsof /tmp/restore-chunk-* 2>&1 || true`, 5000);
    parts.push(`Open files in /tmp (restore chunks):\n${lsofTmp.stdout}`);

    // Use sudo for kernel logs — ariana user can't read dmesg without it
    const dmesgTail = await runCommand(`sudo dmesg --time-format iso | tail -50 2>&1`, 5000);
    parts.push(`dmesg tail:\n${dmesgTail.stdout}`);

    // Full system journal (all units, not just ariana-agent) for the last 60 seconds
    const sysJournal = await runCommand(`sudo journalctl --no-pager --since '60 seconds ago' 2>&1 | tail -80`, 10000);
    parts.push(`System journal (last 60s):\n${sysJournal.stdout}`);

    const tmpfilesStatus = await runCommand(`systemctl status systemd-tmpfiles-clean.timer 2>&1 | head -10`, 5000);
    parts.push(`tmpfiles-clean timer:\n${tmpfilesStatus.stdout}`);

    const procs = await runCommand(`ps aux 2>&1 | head -50`, 5000);
    parts.push(`All processes:\n${procs.stdout}`);
  } catch (e) {
    parts.push(`Diagnostics collection error: ${e}`);
  }
  parts.push('--- END DIAGNOSTICS ---');
  return parts.join('\n');
}

export default app;
