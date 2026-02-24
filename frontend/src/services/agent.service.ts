import { API_URL } from '@/config';
import { authenticatedFetch } from '@/lib/auth';
import { useAppStore } from '@/stores/useAppStore';
import { useUploadProgressStore } from '@/stores/useUploadProgressStore';
import type { AgentConfig } from '@/types/AgentConfig';
import type { AgentWithCreator } from '@/bindings/types';
import { getTauriAPI } from '@/lib/tauri-api';
import { processApiResponse, type LimitHandlerCallbacks } from '@/lib/limitHandler';
import type { LimitExceededInfo } from '@/types/UsageLimits';

const tauriAPI = getTauriAPI();

interface CreateAgentParams {
  projectId: string;
  projectWorkspace: {
    localPath?: string;
    repositoryId?: string | null;
  };
  config: AgentConfig;
}

interface CreateAgentResult {
  agentId: string;
  agent: AgentWithCreator;
}

export class AgentCreationService {
  private limitCallbacks: LimitHandlerCallbacks | null = null;

  setLimitCallbacks(callbacks: LimitHandlerCallbacks) {
    this.limitCallbacks = callbacks;
  }

  /**
   * Resume an interrupted upload for an agent stuck in PROVISIONED state
   * Returns true if resume was attempted, false if not needed
   */
  async resumeUploadIfNeeded(
    agentId: string,
    projectId: string,
    localPath: string
  ): Promise<boolean> {
    // console.log(`[UPLOAD-RESUME] Checking if agent ${agentId} needs upload resume`);

    // Check if there's upload progress on backend
    try {
      const progressResponse = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/upload-progress`);
      if (!progressResponse.ok) {
        // console.log(`[UPLOAD-RESUME] No upload progress found for agent ${agentId}`);
        return false;
      }

      const progressData = await progressResponse.json();
      if (!progressData.progress || progressData.progress.chunksReceived === 0) {
        // console.log(`[UPLOAD-RESUME] Upload not started yet for agent ${agentId}, starting fresh`);
      } else {
        // console.log(`[UPLOAD-RESUME] Found partial upload for agent ${agentId}: ${progressData.progress.chunksReceived} chunks received`);
      }

      // Create bundle and patch
      // console.log(`[UPLOAD-RESUME] Creating bundle and patch from ${localPath}`);
      const { bundlePath, patchPath } = await this.createGitBundleAndPatch(localPath);

      // Resume/continue upload (uploadProjectToBackend has resume logic built-in)
      // console.log(`[UPLOAD-RESUME] Resuming upload for agent ${agentId}`);
      await this.uploadProjectToBackend(agentId, bundlePath, patchPath);

      // Clean up temp files
      // console.log(`[UPLOAD-RESUME] Cleaning up temporary files`);
      await this.cleanupTempFiles(bundlePath, patchPath);

      // Start the agent
      // console.log(`[UPLOAD-RESUME] Starting agent ${agentId}`);
      await this.startAgent(projectId, agentId, {
        setupType: 'zip-uploaded',
        remotePath: '/tmp/project.bundle'
      });

      // console.log(`[UPLOAD-RESUME] Successfully resumed and completed upload for agent ${agentId}`);
      return true;
    } catch (error) {
      console.error(`[UPLOAD-RESUME] Failed to resume upload for agent ${agentId}:`, error);
      // Don't throw - let the agent remain in PROVISIONED state for manual retry
      return false;
    }
  }

  /**
   * Fork an agent with automatic limit handling.
   * Automatically handles local-only projects by uploading bundle before forking.
   */
  async forkAgent(
    sourceAgentId: string,
    newOwnerId: string,
    newAgentName?: string,
    localPath?: string
  ): Promise<{ success: boolean; targetAgentId?: string; agent?: AgentWithCreator; error?: string; limitExceeded?: boolean }> {
    try {
      // Step 1: Try normal fork first
      // console.log('[FORK] Attempting normal fork for agent:', sourceAgentId);
      const response = await authenticatedFetch(`${API_URL}/api/agents/${sourceAgentId}/fork`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          newOwnerId,
          newAgentName,
          useBundleFallback: false
        })
      });

      // Check for machine pool exhaustion (503)
      if (response.status === 503) {
        const data = await response.json();
        if (data.code === 'MACHINE_POOL_EXHAUSTED') {
          // console.log('[FORK] Machine pool exhausted');
          return {
            success: false,
            error: 'MACHINE_POOL_EXHAUSTED' // Special error code
          };
        }
      }

      // Check for limit exceeded error (429 status) - dialog is shown automatically
      if (this.limitCallbacks && response.status === 429) {
        // console.log('[FORK] Detected 429 status, checking for limit error');
        const limitExceeded = await processApiResponse(response.clone(), this.limitCallbacks);
        if (limitExceeded) {
          // console.log('[FORK] Limit exceeded, dialog shown');
          return { success: false, limitExceeded: true };
        }
      }

      // Success - return immediately
      if (response.ok) {
        const data = await response.json();
        // console.log('[FORK] Normal fork succeeded, target agent:', data.targetAgentId);
        return { success: true, targetAgentId: data.targetAgentId, agent: data.agent };
      }

      // If we get here, fork failed for some reason
      const data = await response.json();
      return { success: false, error: data.error || 'Failed to fork agent' };

    } catch (error) {
      console.error('[FORK] Error forking agent:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Upload bundle for fork operation (stored temporarily on backend)
   */
  private async uploadBundleForFork(sourceAgentId: string, bundleBlob: Blob, patchBlob: Blob): Promise<void> {
    // console.log('[FORK-BUNDLE] Converting bundle and patch to base64');

    // Helper function to convert ArrayBuffer to base64
    const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      return btoa(binary);
    };

    const [bundleBuffer, patchBuffer] = await Promise.all([
      bundleBlob.arrayBuffer(),
      patchBlob.arrayBuffer()
    ]);

    const bundleBase64 = arrayBufferToBase64(bundleBuffer);
    const patchBase64 = arrayBufferToBase64(patchBuffer);

    const combinedData = JSON.stringify({ bundleBase64, patchBase64 });
    // console.log(`[FORK-BUNDLE] Combined size: ${combinedData.length} bytes`);

    // Chunk into 1MB pieces (reuse existing chunking logic)
    const CHUNK_SIZE = 1 * 1024 * 1024;
    const totalChunks = Math.ceil(combinedData.length / CHUNK_SIZE);
    // console.log(`[FORK-BUNDLE] Uploading ${totalChunks} chunks`);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, combinedData.length);
      const chunk = combinedData.substring(start, end);

      const response = await authenticatedFetch(`${API_URL}/api/agents/${sourceAgentId}/fork-bundle-chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunkIndex: i, totalChunks, chunk })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to upload fork bundle chunk');
      }

      // console.log(`[FORK-BUNDLE] Chunk ${i + 1}/${totalChunks} uploaded`);
    }

    // Finalize bundle upload
    // console.log('[FORK-BUNDLE] Finalizing bundle upload');
    const finalizeResponse = await authenticatedFetch(`${API_URL}/api/agents/${sourceAgentId}/fork-bundle-finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!finalizeResponse.ok) {
      const data = await finalizeResponse.json();
      throw new Error(data.error || 'Failed to finalize fork bundle upload');
    }

    // console.log('[FORK-BUNDLE] Bundle upload complete');
  }

  /**
   * Extend agent lifetime with automatic limit handling
   * @param agentId - The agent ID to extend
   * @param hours - Number of hours to extend (optional, defaults to 1 lifetime unit)
   */
  async extendAgentLifetime(agentId: string, hours?: number): Promise<{ success: boolean; lifetimeUnits?: number; totalHours?: number; error?: string; limitExceeded?: boolean }> {
    try {
      const body: { hours?: number } = {};
      if (hours !== undefined && hours > 0) {
        body.hours = hours;
      }

      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/extend-lifetime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      // Check for limit exceeded error (429 status) - dialog is shown automatically
      if (this.limitCallbacks && response.status === 429) {
        // console.log('[AgentService] Detected 429 status, checking for limit error');
        const limitExceeded = await processApiResponse(response.clone(), this.limitCallbacks);
        if (limitExceeded) {
          // console.log('[AgentService] Limit exceeded, dialog should have been shown');
          // Limit dialog was shown, return failure with limitExceeded flag
          return {
            success: false,
            limitExceeded: true
          };
        }
      }

      if (!response.ok) {
        const data = await response.json();
        return {
          success: false,
          error: data.error || 'Failed to extend agent lifetime'
        };
      }

      const data = await response.json();
      return {
        success: true,
        lifetimeUnits: data.lifetimeUnits,
        totalHours: data.totalHours
      };
    } catch (error) {
      console.error('Error extending agent lifetime:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Start slop mode for an agent
   * @param agentId - The agent ID
   * @param hours - Number of hours to run slop mode
   * @param customPrompt - Optional custom text to append to the keep going prompt
   */
  async startSlopMode(agentId: string, hours: number, customPrompt?: string): Promise<{ success: boolean; inSlopModeUntil?: string; error?: string }> {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/slop-mode/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ hours, customPrompt })
      });

      if (!response.ok) {
        const data = await response.json();
        return {
          success: false,
          error: data.error || 'Failed to start slop mode'
        };
      }

      const data = await response.json();
      return {
        success: true,
        inSlopModeUntil: data.inSlopModeUntil
      };
    } catch (error) {
      console.error('Error starting slop mode:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Stop slop mode for an agent
   * @param agentId - The agent ID
   */
  async stopSlopMode(agentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/slop-mode/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const data = await response.json();
        return {
          success: false,
          error: data.error || 'Failed to stop slop mode'
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Error stopping slop mode:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Start ralph mode for an agent
   * @param agentId - The agent ID
   * @param taskDescription - Description of the task for the agent to work on autonomously
   */
  async startRalphMode(agentId: string, taskDescription: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/ralph-mode/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ taskDescription })
      });

      if (!response.ok) {
        const data = await response.json();
        return {
          success: false,
          error: data.error || 'Failed to start ralph mode'
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Error starting ralph mode:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Stop ralph mode for an agent
   * @param agentId - The agent ID
   */
  async stopRalphMode(agentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/ralph-mode/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const data = await response.json();
        return {
          success: false,
          error: data.error || 'Failed to stop ralph mode'
        };
      }

      return { success: true };
    } catch (error) {
      console.error('Error stopping ralph mode:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async pollUntilState(agentId: string, statePredicate: (state: string) => boolean): Promise<void> {
    while (true) {
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}`);
      if (!response.ok) throw new Error('Failed to fetch agent state');

      const data = await response.json();
      if (statePredicate(data.status.state)) return;

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async createAndStartAgent(
    params: CreateAgentParams,
    onAgentCreated?: (agent: AgentWithCreator) => void
  ): Promise<CreateAgentResult> {
    const { projectId, projectWorkspace, config } = params;

    if (config.source.from === 'local') {
      if (!projectWorkspace.localPath) {
        throw new Error('Local path required for local agent creation');
      }

      const { agentId, agent } = await this.createAgent(
        projectId,
        undefined,
        config.machine.machineSource,
        config.machine.customMachineId
      );

      // Notify UI immediately so agent appears selected
      if (onAgentCreated) {
        onAgentCreated(agent);
      }

      // console.log('[AGENT-CREATE] Step 2: Wait for provisioned and determine upload strategy');

      await this.pollUntilState(agentId, (state) => state === 'provisioned');

      // Check if we should use patch-based upload
      // Requirements: GitHub remote + user has read access
      const gitInfo = await tauriAPI.invoke<{ githubUrl: string; gitRoot: string } | null>('get_github_remote_url', {
        folderPath: projectWorkspace.localPath
      });

      const hasGitHubRemote = gitInfo?.githubUrl && gitInfo.githubUrl.length > 0;
      let canUsePatchBased = false;

      if (hasGitHubRemote) {
        // Check if user has read access to this repository
        const match = gitInfo.githubUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
        if (match) {
          const owner = match[1];
          const repo = match[2];
          const repoPath = `${owner}---${repo}`;

          try {
            const response = await authenticatedFetch(`${API_URL}/api/repositories/${repoPath}/check-access`);
            if (response.ok) {
              const data = await response.json();
              if (data.accessLevel !== 'none') {
                canUsePatchBased = true;
                // console.log('[AGENT-CREATE] User has read access to repository, can use patch-based upload');
              } else {
                // console.log('[AGENT-CREATE] User has no access to private repo - using bundle upload');
              }
            }
          } catch (error) {
            console.warn('[AGENT-CREATE] Failed to check repo access:', error);
          }
        }
      }

      if (canUsePatchBased) {
        // Use NEW patch-based upload (replacement for incremental bundle)
        // console.log('[AGENT-CREATE] Using patch-based upload (has GitHub remote + access)');

        try {
          const patchData = await tauriAPI.invoke<{
            gitHistoryLastPushedCommitSha: string | null;
            commits: Array<{ sha: string; title: string; timestamp: number; patch: string }>;
            uncommittedPatch: string;
            remoteUrl: string | null;
          }>('create_patch_based_upload_data', {
            sourcePath: projectWorkspace.localPath
          });

          // console.log(`[AGENT-CREATE] Extracted ${patchData.commits.length} commit patches`);
          // console.log(`[AGENT-CREATE] gitHistoryLastPushedCommitSha: ${patchData.gitHistoryLastPushedCommitSha || 'none'}`);

          // Start agent with patch-based setup
          await this.startAgent(projectId, agentId, {
            setupType: 'patch-based',
            gitHistoryLastPushedCommitSha: patchData.gitHistoryLastPushedCommitSha,
            commits: patchData.commits,
            uncommittedPatch: patchData.uncommittedPatch
          });

          // console.log('[AGENT-CREATE] Complete (patch-based)!');
          return { agentId, agent };
        } catch (error) {
          console.warn('[AGENT-CREATE] Patch-based upload failed, falling back to bundle:', error);
          // Fall through to bundle upload
        }
      }

      // Fallback: Use OLD bundle upload (for repos without remote or patch-based failure)
      // console.log('[AGENT-CREATE] Using bundle upload (no remote or fallback)');

      const bundleResult = await this.createGitBundleAndPatch(projectWorkspace.localPath);
      const { bundlePath, patchPath, isIncremental, baseCommitSha, remoteUrl: detectedRemoteUrl } = bundleResult;

      // console.log('[AGENT-CREATE] Step 3: Upload bundle and patch to backend');
      await this.uploadProjectToBackend(agentId, bundlePath, patchPath, {
        isIncremental,
        baseCommitSha,
        remoteUrl: detectedRemoteUrl
      });

      // Clean up temp files
      // console.log('[AGENT-CREATE] Cleaning up temporary files');
      await this.cleanupTempFiles(bundlePath, patchPath);

      // console.log('[AGENT-CREATE] Step 4: Start agent');
      await this.startAgent(projectId, agentId, {
        setupType: 'zip-uploaded',
        remotePath: '/tmp/project.bundle'
      });

      // console.log('[AGENT-CREATE] Complete (bundle)!');
      return { agentId, agent };
    }

    if (config.source.from === 'branch') {
      if (!projectWorkspace.repositoryId) {
        throw new Error('Repository ID required for branch-based agent creation');
      }

      console.log('[AGENT-CREATE] Step 1: Creating agent with baseBranch:', config.source.branch);
      const { agentId, agent } = await this.createAgent(
        projectId,
        config.source.branch,
        config.machine.machineSource,
        config.machine.customMachineId
      );
      console.log('[AGENT-CREATE] Agent created:', agentId);

      // Notify UI immediately so agent appears selected
      if (onAgentCreated) {
        onAgentCreated(agent);
      }

      // console.log('[AGENT-CREATE] Step 2: Wait for provisioned');
      await this.pollUntilState(agentId, (state) => state === 'provisioned');

      // console.log('[AGENT-CREATE] Step 3: Start agent');
      await this.startAgent(projectId, agentId, { baseBranch: config.source.branch });

      // console.log('[AGENT-CREATE] Complete!');
      return { agentId, agent };
    }

    if (config.source.from === 'clone-url') {
      console.log('[AGENT-CREATE] Step 1: Creating agent with public clone URL:', config.source.url);
      const { agentId, agent } = await this.createAgent(
        projectId,
        undefined,
        config.machine.machineSource,
        config.machine.customMachineId
      );
      console.log('[AGENT-CREATE] Agent created:', agentId);

      // Notify UI immediately so agent appears selected
      if (onAgentCreated) {
        onAgentCreated(agent);
      }

      // console.log('[AGENT-CREATE] Step 2: Wait for provisioned');
      await this.pollUntilState(agentId, (state) => state === 'provisioned');

      // console.log('[AGENT-CREATE] Step 3: Start agent with public clone');
      await this.startAgent(projectId, agentId, {
        cloneUrl: config.source.url,
        branch: config.source.branch
      });

      // console.log('[AGENT-CREATE] Complete!');
      return { agentId, agent };
    }

    throw new Error('Invalid configuration for agent creation');
  }


  private async createGitBundleAndPatch(localPath: string): Promise<{
    bundlePath: string;
    patchPath: string;
    isIncremental: boolean;
    baseCommitSha?: string;
    remoteUrl?: string;
  }> {
    // console.log('[GIT] Creating git bundle and patch from:', localPath);

    let useFullBundle = false;

    // Check if we have access to the repo (for all users, not just anonymous)
    const gitInfo = await tauriAPI.invoke<{ githubUrl: string; gitRoot: string } | null>('get_github_remote_url', {
      folderPath: localPath
    });

    if (gitInfo?.githubUrl) {
      const match = gitInfo.githubUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
      if (match) {
        const owner = match[1];
        const repo = match[2];
        const repoPath = `${owner}---${repo}`;

        try {
          const response = await authenticatedFetch(`${API_URL}/api/repositories/${repoPath}/check-access`);
          if (response.ok) {
            const data = await response.json();
            if (data.accessLevel === 'none') {
              // console.log('[GIT] No access to private repo - using full bundle');
              useFullBundle = true;
            }
          } else {
            // console.log('[GIT] Could not check repo access - using full bundle');
            useFullBundle = true;
          }
        } catch (error) {
          console.warn('[GIT] Error checking repo access - using full bundle:', error);
          useFullBundle = true;
        }
      }
    }

    if (useFullBundle) {
      // console.log('[GIT] Starting full bundle creation...');
      const [bundlePath, patchPath] = await tauriAPI.invoke<[string, string]>('create_git_bundle_and_patch', {
        sourcePath: localPath
      });
      // console.log('[GIT] Bundle creation complete, paths received');
      // console.log('[GIT] Bundle path:', bundlePath);
      // console.log('[GIT] Patch path:', patchPath);

      // Get file info without reading into memory
      const [bundleInfo, patchInfo] = await Promise.all([
        tauriAPI.invoke('get_file_info', { filePath: bundlePath }) as Promise<[number, number]>,
        tauriAPI.invoke('get_file_info', { filePath: patchPath }) as Promise<[number, number]>
      ]);

      // console.log('[GIT] Full bundle size:', bundleInfo[0], 'bytes');
      // console.log('[GIT] Full patch size:', patchInfo[0], 'bytes');

      return {
        bundlePath,
        patchPath,
        isIncremental: false,
        baseCommitSha: undefined,
        remoteUrl: undefined
      };
    }

    const metadata = await tauriAPI.invoke<{
      bundlePath: string;
      patchPath: string;
      isIncremental: boolean;
      baseCommitSha?: string;
      remoteUrl?: string;
    }>('create_incremental_git_bundle_and_patch', {
      sourcePath: localPath
    });

    // console.log('[GIT] Bundle created at:', metadata.bundlePath);
    // console.log('[GIT] Incremental:', metadata.isIncremental);
    if (metadata.isIncremental) {
      // console.log('[GIT] Base commit SHA:', metadata.baseCommitSha);
    }

    // Get file info without reading into memory
    const [bundleInfo, patchInfo] = await Promise.all([
      tauriAPI.invoke('get_file_info', { filePath: metadata.bundlePath }) as Promise<[number, number]>,
      tauriAPI.invoke('get_file_info', { filePath: metadata.patchPath }) as Promise<[number, number]>
    ]);

    // console.log('[GIT] Bundle size:', bundleInfo[0], 'bytes');
    // console.log('[GIT] Patch size:', patchInfo[0], 'bytes');

    return {
      bundlePath: metadata.bundlePath,
      patchPath: metadata.patchPath,
      isIncremental: metadata.isIncremental,
      baseCommitSha: metadata.baseCommitSha,
      remoteUrl: metadata.remoteUrl
    };
  }

  private async cleanupTempFiles(bundlePath: string, patchPath: string): Promise<void> {
    try {
      await tauriAPI.invoke('delete_temp_file', { filePath: bundlePath });
      await tauriAPI.invoke('delete_temp_file', { filePath: patchPath });
      // console.log('[CLEANUP] Temporary files deleted');
    } catch (error) {
      console.warn('[CLEANUP] Failed to cleanup temp files:', error);
    }
  }

  private async uploadProjectToBackend(
    agentId: string,
    bundlePath: string,
    patchPath: string,
    metadata?: {
      isIncremental: boolean;
      baseCommitSha?: string;
      remoteUrl?: string;
    }
  ): Promise<void> {
    // console.log('[UPLOAD] Starting streaming upload from files');

    // Get file sizes without reading into memory
    const [bundleInfo, patchInfo] = await Promise.all([
      tauriAPI.invoke('get_file_info', { filePath: bundlePath }) as Promise<[number, number]>,
      tauriAPI.invoke('get_file_info', { filePath: patchPath }) as Promise<[number, number]>
    ]);

    const bundleFileSize = bundleInfo[0];
    const patchFileSize = patchInfo[0];
    const bundleBase64Size = bundleInfo[1];
    const patchBase64Size = patchInfo[1];

    // console.log(`[UPLOAD] Bundle: ${bundleFileSize} bytes (${bundleBase64Size} base64)`);
    // console.log(`[UPLOAD] Patch: ${patchFileSize} bytes (${patchBase64Size} base64)`);

    // Calculate total size of the combined JSON structure
    // Structure: {"bundleBase64":"...","patchBase64":"...","isIncremental":...,"baseCommitSha":"...","remoteUrl":"..."}
    const metadataJson = metadata ? JSON.stringify({
      isIncremental: metadata.isIncremental,
      baseCommitSha: metadata.baseCommitSha,
      remoteUrl: metadata.remoteUrl
    }) : '{}';

    // JSON overhead: {"bundleBase64":"","patchBase64":"", + metadata without outer braces + }
    // We need to account for the structure wrapping the base64 strings
    const jsonPrefix = '{"bundleBase64":"';
    const jsonMiddle = '","patchBase64":"';
    const jsonSuffix = metadata
      ? `","isIncremental":${metadata.isIncremental}${metadata.baseCommitSha ? `,"baseCommitSha":"${metadata.baseCommitSha}"` : ''}${metadata.remoteUrl ? `,"remoteUrl":"${metadata.remoteUrl}"` : ''}}`
      : '"}';

    const totalSize = jsonPrefix.length + bundleBase64Size + jsonMiddle.length + patchBase64Size + jsonSuffix.length;

    // console.log(`[UPLOAD] Total combined size: ${totalSize} bytes`);

    // Use 768KB chunks (must be multiple of 3 for base64 alignment when reading binary)
    // 768KB = 786432 bytes, which is divisible by 3
    const BINARY_CHUNK_SIZE = 768 * 1024; // 768KB binary = 1MB base64
    const BASE64_CHUNK_SIZE = (BINARY_CHUNK_SIZE / 3) * 4; // Base64 size for this chunk

    // Calculate number of chunks needed
    const bundleChunks = Math.ceil(bundleFileSize / BINARY_CHUNK_SIZE);
    const patchChunks = Math.ceil(patchFileSize / BINARY_CHUNK_SIZE);

    // Total chunks: JSON prefix (1) + bundle chunks + JSON middle (1) + patch chunks + JSON suffix (1)
    // Actually, we'll send the combined JSON in logical chunks of ~1MB
    const JSON_CHUNK_SIZE = 1 * 1024 * 1024; // 1MB for the combined JSON string
    const totalChunks = Math.ceil(totalSize / JSON_CHUNK_SIZE);

    // console.log(`[UPLOAD] Splitting into ${totalChunks} chunks of ~1MB each (streaming from disk)`);

    // Determine if this is a full bundle upload (not incremental)
    const isFullBundle = !metadata?.isIncremental;
    // console.log(`[UPLOAD] Upload type: ${isFullBundle ? 'full bundle' : 'incremental'}`);

    // Initialize progress with isFullBundle flag
    useUploadProgressStore.getState().setProgress(agentId, {
      loaded: 0,
      total: totalSize,
      percentage: 0,
      isFullBundle
    });

    // Check for existing upload progress (resume capability)
    let startChunkIndex = 0;
    try {
      const progressResponse = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/upload-progress`);
      if (progressResponse.ok) {
        const progressData = await progressResponse.json();
        if (progressData.progress && progressData.progress.chunksReceived > 0) {
          startChunkIndex = progressData.progress.chunksReceived;
          // console.log(`[UPLOAD] Resuming upload from chunk ${startChunkIndex + 1}/${totalChunks}`);

          // Update progress UI to show resumed state
          const loaded = startChunkIndex * JSON_CHUNK_SIZE;
          const percentage = Math.round((startChunkIndex / totalChunks) * 100);
          useUploadProgressStore.getState().setProgress(agentId, {
            loaded: Math.min(loaded, totalSize),
            total: totalSize,
            percentage,
            isFullBundle
          });
        }
      }
    } catch (error) {
      console.warn('[UPLOAD] Failed to check upload progress, starting from beginning:', error);
    }

    // Stream chunks directly from files
    // We need to generate the JSON structure on-the-fly
    let currentPosition = 0; // Position in the virtual combined JSON string

    for (let chunkIndex = startChunkIndex; chunkIndex < totalChunks; chunkIndex++) {
      const chunkStart = chunkIndex * JSON_CHUNK_SIZE;
      const chunkEnd = Math.min(chunkStart + JSON_CHUNK_SIZE, totalSize);
      const chunkLength = chunkEnd - chunkStart;

      // console.log(`[UPLOAD] Generating chunk ${chunkIndex + 1}/${totalChunks} (positions ${chunkStart}-${chunkEnd})`);

      // Build this chunk by reading from the appropriate source
      let chunk = '';
      let pos = chunkStart;

      while (chunk.length < chunkLength) {
        const remaining = chunkLength - chunk.length;

        if (pos < jsonPrefix.length) {
          // We're in the JSON prefix
          const take = Math.min(remaining, jsonPrefix.length - pos);
          chunk += jsonPrefix.substring(pos, pos + take);
          pos += take;
        } else if (pos < jsonPrefix.length + bundleBase64Size) {
          // We're in the bundle base64 data
          const bundleBase64Pos = pos - jsonPrefix.length;
          const take = Math.min(remaining, bundleBase64Size - bundleBase64Pos);

          // Read from bundle file - convert base64 position to binary position
          // Base64: 4 chars per 3 bytes, so bundleBase64Pos / 4 * 3 = binary position
          const binaryPos = Math.floor(bundleBase64Pos / 4) * 3;
          const base64Offset = bundleBase64Pos % 4;

          // We need to read enough binary data to produce 'take' base64 characters
          // But we need to align to base64 boundaries (groups of 4)
          const alignedBase64Start = bundleBase64Pos - base64Offset;
          const alignedBase64End = Math.min(bundleBase64Pos + take + (4 - ((bundleBase64Pos + take) % 4)) % 4, bundleBase64Size);
          const alignedBinaryStart = (alignedBase64Start / 4) * 3;
          const alignedBinaryLength = Math.ceil((alignedBase64End - alignedBase64Start) / 4) * 3;

          // Read binary chunk from file
          const base64Data = await tauriAPI.invoke('read_file_chunk_base64', {
            filePath: bundlePath,
            offset: alignedBinaryStart,
            chunkSize: Math.min(alignedBinaryLength, bundleFileSize - alignedBinaryStart)
          }) as string;

          // Extract the exact portion we need
          const extractStart = base64Offset;
          const extractEnd = extractStart + take;
          chunk += base64Data.substring(extractStart, extractEnd);
          pos += take;
        } else if (pos < jsonPrefix.length + bundleBase64Size + jsonMiddle.length) {
          // We're in the JSON middle
          const middlePos = pos - jsonPrefix.length - bundleBase64Size;
          const take = Math.min(remaining, jsonMiddle.length - middlePos);
          chunk += jsonMiddle.substring(middlePos, middlePos + take);
          pos += take;
        } else if (pos < jsonPrefix.length + bundleBase64Size + jsonMiddle.length + patchBase64Size) {
          // We're in the patch base64 data
          const patchBase64Pos = pos - jsonPrefix.length - bundleBase64Size - jsonMiddle.length;
          const take = Math.min(remaining, patchBase64Size - patchBase64Pos);

          // Similar logic for patch file
          const base64Offset = patchBase64Pos % 4;
          const alignedBase64Start = patchBase64Pos - base64Offset;
          const alignedBase64End = Math.min(patchBase64Pos + take + (4 - ((patchBase64Pos + take) % 4)) % 4, patchBase64Size);
          const alignedBinaryStart = (alignedBase64Start / 4) * 3;
          const alignedBinaryLength = Math.ceil((alignedBase64End - alignedBase64Start) / 4) * 3;

          const base64Data = await tauriAPI.invoke('read_file_chunk_base64', {
            filePath: patchPath,
            offset: alignedBinaryStart,
            chunkSize: Math.min(alignedBinaryLength, patchFileSize - alignedBinaryStart)
          }) as string;

          const extractStart = base64Offset;
          const extractEnd = extractStart + take;
          chunk += base64Data.substring(extractStart, extractEnd);
          pos += take;
        } else {
          // We're in the JSON suffix
          const suffixPos = pos - jsonPrefix.length - bundleBase64Size - jsonMiddle.length - patchBase64Size;
          const take = Math.min(remaining, jsonSuffix.length - suffixPos);
          chunk += jsonSuffix.substring(suffixPos, suffixPos + take);
          pos += take;
        }
      }

      // console.log(`[UPLOAD] Sending chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} bytes)`);

      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/upload-project-chunk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chunkIndex,
          totalChunks,
          chunk
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to upload chunk');
      }

      // Update progress
      const loaded = (chunkIndex + 1) * JSON_CHUNK_SIZE;
      const percentage = Math.round(((chunkIndex + 1) / totalChunks) * 100);

      useUploadProgressStore.getState().setProgress(agentId, {
        loaded: Math.min(loaded, totalSize),
        total: totalSize,
        percentage
      });

      // console.log(`[UPLOAD] Chunk ${chunkIndex + 1}/${totalChunks} uploaded (${percentage}%)`);
    }

    // Finalize upload
    // console.log('[UPLOAD] Finalizing upload');
    const finalizeResponse = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/upload-project-finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!finalizeResponse.ok) {
      const data = await finalizeResponse.json();
      throw new Error(data.error || 'Failed to finalize upload');
    }

    // console.log('[UPLOAD] Upload complete');
    useUploadProgressStore.getState().clearProgress(agentId);
  }


  private async createAgent(
    projectId: string,
    baseBranch?: string,
    machineSource?: 'hetzner' | 'custom',
    customMachineId?: string
  ): Promise<CreateAgentResult> {
    const response = await authenticatedFetch(`${API_URL}/api/projects/${projectId}/agents`, {
      method: 'POST',
      body: JSON.stringify({
        baseBranch: baseBranch || null,
        machineType: machineSource || 'hetzner',
        customMachineId: machineSource === 'custom' ? customMachineId : null
      })
    });

    // Check for machine pool exhaustion FIRST (before limit check)
    if (response.status === 503) {
      const data = await response.json();
      if (data.code === 'MACHINE_POOL_EXHAUSTED') {
        throw new Error('MACHINE_POOL_EXHAUSTED');
      }
    }

    // Check for limit exceeded error - dialog is shown automatically
    if (this.limitCallbacks && response.status === 429) {
      const limitExceeded = await processApiResponse(response.clone(), this.limitCallbacks);
      if (limitExceeded) {
        // Limit dialog was shown, throw error to stop creation
        throw new Error('Agent creation limit exceeded');
      }
    }

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to create agent');
    }

    const data = await response.json();
    return {
      agentId: data.agent.id,
      agent: data.agent
    };
  }


  private async startAgent(
    projectId: string,
    agentId: string,
    setupData: {
      baseBranch?: string;
      setupType?: string;
      remotePath?: string;
      cloneUrl?: string;
      branch?: string;
      // Patch-based upload params
      gitHistoryLastPushedCommitSha?: string | null;
      commits?: Array<{ sha: string; title: string; timestamp: number; patch: string }>;
      uncommittedPatch?: string;
    }
  ): Promise<void> {
    // DEBUG: Log what we're about to send
    // console.log('[DEBUG] startAgent sending:', JSON.stringify({
    //   ...setupData,
    //   uncommittedPatch: setupData.uncommittedPatch ? `${setupData.uncommittedPatch.length} bytes` : undefined,
    //   commits: setupData.commits ? `${setupData.commits.length} commits` : undefined
    // }, null, 2));

    const startResponse = await authenticatedFetch(
      `${API_URL}/api/projects/${projectId}/agents/${agentId}/start`,
      {
        method: 'POST',
        body: JSON.stringify({ ...setupData })
      }
    );

    if (!startResponse.ok) {
      const startData = await startResponse.json();
      throw new Error(startData.error || 'Failed to start agent');
    }
  }
}

export const agentCreationService = new AgentCreationService();

// SSH Key Management

/**
 * Get machine IP without uploading SSH key (for browser mode)
 */
export async function getMachineIP(agentId: string): Promise<string> {
  try {
    // console.log(`[IP] Fetching machine IP for agent ${agentId} (browser mode)`);

    const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/machine-ip`, {
      method: 'GET'
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch machine IP: ${response.status}`);
    }

    const data = await response.json();
    const machineIp = data.machineIp;

    if (!machineIp) {
      throw new Error('No machine IP returned from backend');
    }

    // Store machine IP in app store
    useAppStore.getState().setMachineIP(agentId, machineIp);
    // console.log(`[IP] Machine IP fetched successfully: ${machineIp}`);

    return machineIp;
  } catch (error) {
    console.error(`[IP] Error fetching machine IP for agent ${agentId}:`, error);
    throw error;
  }
}

/**
 * Upload SSH key and get machine IP (for desktop mode)
 */
export async function uploadSSHKeyAndGetIP(agentId: string): Promise<string> {
  try {
    // console.log(`[SSH] Uploading SSH key for agent ${agentId}`);

    // Get SSH public key
    const publicKey: string | null = await tauriAPI.invoke('get_or_create_ssh_key');

    // Check if SSH is not available (browser mode)
    if (!publicKey) {
      // console.log(`[SSH] SSH not available (browser mode), falling back to getMachineIP`);
      return getMachineIP(agentId);
    }

    // Upload to backend
    const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/sshkey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: publicKey })
    });

    if (!response.ok) {
      throw new Error(`Failed to upload SSH key: ${response.status}`);
    }

    const data = await response.json();
    const machineIp = data.machineIp;
    const sshUser = data.sshUser || 'ariana'; // Default to 'ariana' for backward compatibility

    if (!machineIp) {
      throw new Error('No machine IP returned from SSH key upload');
    }

    // Store machine IP and SSH user in app store
    useAppStore.getState().setMachineIP(agentId, machineIp);
    useAppStore.getState().setSSHUser(agentId, sshUser);
    // console.log(`[SSH] SSH key uploaded successfully, machine IP: ${machineIp}, SSH user: ${sshUser}`);

    return machineIp;
  } catch (error) {
    console.error(`[SSH] Error uploading SSH key for agent ${agentId}:`, error);
    throw error;
  }
}

// Diff service
interface TaskDiff {
  taskId: string;
  promptPreview: string;
  diff: string;
  fromCommit: string;
  toCommit: string;
}

interface DiffResponse {
  success: boolean;
  totalDiff?: string;
  taskDiffs?: TaskDiff[];
  pendingDiff?: string;
  totalWithPendingDiff?: string;
  initialCommit?: string;
  initialUncommittedDiff?: TaskDiff;
  error?: string;
}

export async function fetchAgentDiffs(agentId: string): Promise<DiffResponse> {
  try {
    const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/diffs`, {
      method: 'GET'
    });

    if (!response.ok) {
      const data = await response.json();
      return {
        success: false,
        error: data.error || 'Failed to fetch diffs'
      };
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching agent diffs:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * @deprecated Use agentCreationService.forkAgent() instead for automatic limit dialog handling
 */
export async function forkAgent(sourceAgentId: string, newOwnerId: string, newAgentName?: string): Promise<{ success: boolean; targetAgentId?: string; error?: string; limitExceeded?: LimitExceededInfo }> {
  console.warn('forkAgent() is deprecated. Use agentCreationService.forkAgent() instead for automatic limit dialog handling.');
  try {
    const response = await authenticatedFetch(`${API_URL}/api/agents/${sourceAgentId}/fork`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        newOwnerId,
        newAgentName
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // Check for limit exceeded
      if (response.status === 429 && data.code === 'LIMIT_EXCEEDED' && data.limitInfo) {
        return {
          success: false,
          error: data.error,
          limitExceeded: data.limitInfo
        };
      }

      return {
        success: false,
        error: data.error || 'Failed to fork agent'
      };
    }

    return {
      success: true,
      targetAgentId: data.targetAgentId
    };
  } catch (error) {
    console.error('Error forking agent:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Agent Lifetime Management
export async function fetchAgentLifetimeUnit(): Promise<number | null> {
  try {
    const response = await authenticatedFetch(`${API_URL}/api/agents/lifetime-unit`, {
      method: 'GET'
    });

    if (!response.ok) {
      console.error('Failed to fetch agent lifetime unit:', response.status);
      return null;
    }

    const data = await response.json();
    return data.lifetimeUnitMinutes;
  } catch (error) {
    console.error('Error fetching agent lifetime unit:', error);
    return null;
  }
}

/**
 * @deprecated Use agentCreationService.extendAgentLifetime() instead for automatic limit dialog handling
 */
export async function extendAgentLifetime(agentId: string): Promise<{ success: boolean; lifetimeUnits?: number; error?: string; limitExceeded?: LimitExceededInfo }> {
  console.warn('extendAgentLifetime() is deprecated. Use agentCreationService.extendAgentLifetime() instead for automatic limit dialog handling.');
  try {
    const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/extend-lifetime`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (!response.ok) {
      // Check for limit exceeded
      if (response.status === 429 && data.code === 'LIMIT_EXCEEDED' && data.limitInfo) {
        return {
          success: false,
          error: data.error,
          limitExceeded: data.limitInfo
        };
      }

      return {
        success: false,
        error: data.error || 'Failed to extend agent lifetime'
      };
    }

    return {
      success: true,
      lifetimeUnits: data.lifetimeUnits
    };
  } catch (error) {
    console.error('Error extending agent lifetime:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Agent Template Management

// TemplateAgent uses the same structure as AgentWithCreator (which already has isTemplate and templateMarkedAt from the schema)
export type TemplateAgent = AgentWithCreator;

export interface GetProjectTemplatesResponse {
  success: boolean;
  templates: TemplateAgent[];
  limit: number;
  error?: string;
  status?: number;
}

/**
 * Get all template agents for a project
 */
export async function getProjectTemplates(projectId: string): Promise<GetProjectTemplatesResponse> {
  try {
    const response = await authenticatedFetch(`${API_URL}/api/projects/${projectId}/templates`, {
      method: 'GET'
    });

    if (!response.ok) {
      const data = await response.json();
      return {
        success: false,
        templates: [],
        limit: 10,
        error: data.error || 'Failed to fetch templates',
        status: response.status
      };
    }

    const data = await response.json();
    return {
      success: true,
      templates: data.templates,
      limit: data.limit
    };
  } catch (error) {
    console.error('Error fetching project templates:', error);
    return {
      success: false,
      templates: [],
      limit: 10,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export type TemplateVisibility = 'personal' | 'shared';

/**
 * Mark an agent as a template
 */
export async function makeAgentTemplate(
  agentId: string,
  visibility: TemplateVisibility = 'shared'
): Promise<{ success: boolean; error?: string; code?: string; visibility?: TemplateVisibility }> {
  try {
    const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/make-template`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ visibility })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to make agent a template',
        code: data.code
      };
    }

    return { success: true, visibility: data.visibility };
  } catch (error) {
    console.error('Error making agent a template:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Remove an agent from being a template
 */
export async function removeAgentTemplate(agentId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/remove-template`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: data.error || 'Failed to remove agent from templates'
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Error removing agent from templates:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}