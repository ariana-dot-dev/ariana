import { invoke } from "@tauri-apps/api/core";
import { OsSession } from "../bindings/os";
import { CanvasService } from "./CanvasService";

export interface CopyPoolEntry {
    id: string;
    path: string;
    osSession: OsSession;
    branchName: string;
    createdAt: Date;
}

export interface CopyProgress {
    total: number;
    copied: number;
    currentFile: string;
    percentage: number;
    speed: string;
    estimatedTimeRemaining: string;
}

export class CopyPoolManager {
    private static instance: CopyPoolManager;
    private availableCopies: Map<string, CopyPoolEntry[]> = new Map();
    private lastKnownRootHashes: Map<string, string> = new Map(); // Track root git hashes

    private constructor() {}

    static getInstance(): CopyPoolManager {
        if (!CopyPoolManager.instance) {
            CopyPoolManager.instance = new CopyPoolManager();
        }
        return CopyPoolManager.instance;
    }

    /**
     * Get a copy - detects external root changes and syncs pool accordingly
     */
    async getCopy(rootPath: string, rootOsSession: OsSession, onProgress?: (progress: CopyProgress) => void): Promise<CopyPoolEntry> {
        const poolKey = this.getPoolKey(rootPath, rootOsSession);
        
        // Check if root has changed externally since last access
        await this.checkAndSyncRootChanges(rootPath, rootOsSession);
        
        const pool = this.availableCopies.get(poolKey) || [];
        
        // Try to reuse an available copy
        if (pool.length > 0) {
            const copy = pool.pop()!;
            this.availableCopies.set(poolKey, pool);
            
            try {
                // Simply sync to current root state - root is source of truth
                await this.syncToRoot(copy, rootPath, rootOsSession);
                return copy;
            } catch (error) {
                // If sync fails, cleanup and create new
                await this.cleanupCopy(copy);
            }
        }

        // Create new copy
        return this.createFreshCopy(rootPath, rootOsSession, onProgress);
    }

    /**
     * Return a copy to the pool for potential reuse
     */
    async returnCopy(entry: CopyPoolEntry, rootPath: string, rootOsSession: OsSession): Promise<void> {
        const poolKey = this.getPoolKey(rootPath, rootOsSession);
        const pool = this.availableCopies.get(poolKey) || [];
        
        // Keep pool size reasonable
        if (pool.length < 3) {
            pool.push(entry);
            this.availableCopies.set(poolKey, pool);
        } else {
            // Pool full, just cleanup
            await this.cleanupCopy(entry);
        }
    }

    /**
     * Check if root has changed externally and sync pool if needed
     */
    private async checkAndSyncRootChanges(rootPath: string, rootOsSession: OsSession): Promise<void> {
        const poolKey = this.getPoolKey(rootPath, rootOsSession);
        const currentRootHash = await this.getGitHash(rootPath, rootOsSession);
        
        if (!currentRootHash) {
            console.warn('[CopyPoolManager] Could not get root git hash');
            return;
        }
        
        const lastKnownHash = this.lastKnownRootHashes.get(poolKey);
        
        if (lastKnownHash && lastKnownHash !== currentRootHash) {
            console.log(`[CopyPoolManager] Root changed externally for ${poolKey}: ${lastKnownHash} → ${currentRootHash}`);
            await this.syncAllToRoot(rootPath, rootOsSession);
        }
        
        // Update tracked hash
        this.lastKnownRootHashes.set(poolKey, currentRootHash);
    }

    /**
     * Sync all existing copies to current root state (called after root changes like merges)
     */
    async syncAllToRoot(rootPath: string, rootOsSession: OsSession): Promise<void> {
        console.log('[CopyPoolManager] Syncing all existing copies to new root state');
        
        // Get the pool key for this root path and OS session
        const targetPoolKey = this.getPoolKey(rootPath, rootOsSession);
        const copies = this.availableCopies.get(targetPoolKey) || [];

        if (copies.length === 0) {
            console.log(`[CopyPoolManager] No copies to sync for pool ${targetPoolKey}`);
            return;
        }

        console.log(`[CopyPoolManager] Syncing ${copies.length} copies for pool ${targetPoolKey}`);
        const validCopies: CopyPoolEntry[] = [];
        
        for (const copy of copies) {
            try {
                await this.syncToRoot(copy, rootPath, rootOsSession);
                validCopies.push(copy);
                console.log(`[CopyPoolManager] Successfully synced copy ${copy.id}`);
            } catch (error) {
                console.warn(`[CopyPoolManager] Failed to sync copy ${copy.id}, removing from pool:`, error);
                // Cleanup failed copy
                await this.cleanupCopy(copy);
            }
        }
        
        // Update pool with only successfully synced copies
        this.availableCopies.set(targetPoolKey, validCopies);
        
        // Update the tracked root hash to current state
        const currentRootHash = await this.getGitHash(rootPath, rootOsSession);
        if (currentRootHash) {
            this.lastKnownRootHashes.set(targetPoolKey, currentRootHash);
        }
        
        console.log(`[CopyPoolManager] Sync completed. Active copies in pool ${targetPoolKey}: ${validCopies.length}`);
    }

    /**
     * Sync a copy to exactly match root state
     */
    private async syncToRoot(copy: CopyPoolEntry, rootPath: string, rootOsSession: OsSession): Promise<void> {
        const copyPath = copy.path;
        const copyOsSession = copy.osSession;

        console.log(`[CopyPoolManager] Syncing copy ${copy.id} to root`);

        // Get current root state
        const rootBranch = await this.getCurrentBranch(rootPath, rootOsSession);
        const rootHash = await this.getGitHash(rootPath, rootOsSession);
        
        if (!rootBranch || !rootHash) {
            throw new Error('Cannot determine root git state');
        }

        // Switch to root branch
        await this.ensureBranch(copyPath, copyOsSession, rootBranch);
        
        // Hard reset to root hash
        await invoke('execute_command_with_os_session', {
            command: 'git',
            args: ['reset', '--hard', rootHash],
            directory: copyPath,
            osSession: copyOsSession
        });

        // Clean any uncommitted changes
        await invoke('execute_command_with_os_session', {
            command: 'git',
            args: ['clean', '-fd'],
            directory: copyPath,
            osSession: copyOsSession
        });

        // Create new working branch
        await invoke('execute_command_with_os_session', {
            command: 'git',
            args: ['checkout', '-b', copy.branchName],
            directory: copyPath,
            osSession: copyOsSession
        });

        console.log(`[CopyPoolManager] Copy ${copy.id} synced to ${rootBranch}@${rootHash}`);
    }

    /**
     * Create a fresh copy from root
     */
    private async createFreshCopy(rootPath: string, rootOsSession: OsSession, onProgress?: (progress: CopyProgress) => void): Promise<CopyPoolEntry> {
        const copyId = CanvasService.generateRandomId();
        const copyPath = `${rootPath}-${copyId}`;
        const branchName = `canvas-${copyId}`;

        console.log(`[CopyPoolManager] Creating fresh copy ${copyId}`);

        // Track progress if callback provided
        if (onProgress) {
            this.trackCopyProgress(rootPath, copyPath, rootOsSession, onProgress);
        }

        // Perform the copy
        await this.performOptimizedCopy(rootPath, copyPath, rootOsSession);

        const entry: CopyPoolEntry = {
            id: copyId,
            path: copyPath,
            osSession: this.createOsSessionForPath(copyPath, rootOsSession),
            branchName,
            createdAt: new Date()
        };

        // Sync to current root state and create working branch
        await this.syncToRoot(entry, rootPath, rootOsSession);

        console.log(`[CopyPoolManager] Fresh copy ${copyId} created`);
        return entry;
    }

    /**
     * Ensure we're on the specified branch
     */
    private async ensureBranch(directory: string, osSession: OsSession, targetBranch: string): Promise<void> {
        const currentBranch = await this.getCurrentBranch(directory, osSession);
        
        if (currentBranch !== targetBranch) {
            try {
                await invoke('execute_command_with_os_session', {
                    command: 'git',
                    args: ['checkout', targetBranch],
                    directory,
                    osSession
                });
            } catch (error) {
                // Branch doesn't exist, create it
                await invoke('execute_command_with_os_session', {
                    command: 'git',
                    args: ['checkout', '-b', targetBranch],
                    directory,
                    osSession
                });
            }
        }
    }

    // Utility methods
    private getPoolKey(projectPath: string, osSession: OsSession): string {
        const sessionKey = 'Local' in osSession ? 'local' : `wsl-${osSession.Wsl.distribution}`;
        return `${projectPath}-${sessionKey}`;
    }

    private createOsSessionForPath(path: string, baseSession: OsSession): OsSession {
        if ('Local' in baseSession) {
            return { Local: path };
        } else {
            return {
                Wsl: {
                    distribution: baseSession.Wsl.distribution,
                    working_directory: path
                }
            };
        }
    }

    private async getCurrentBranch(directory: string, osSession: OsSession): Promise<string | null> {
        try {
            const result = await invoke('git_get_current_branch', {
                directory,
                osSession
            });
            return result as string;
        } catch (error) {
            return null;
        }
    }

    private async getGitHash(directory: string, osSession: OsSession): Promise<string | null> {
        try {
            const result = await invoke('get_git_hash', {
                directory,
                osSession
            });
            return result as string;
        } catch (error) {
            return null;
        }
    }

    private async performOptimizedCopy(source: string, destination: string, osSession: OsSession): Promise<void> {
        try {
            await invoke("copy_files_optimized", {
                source,
                destination,
                osSession,
                excludeGit: false
            });
        } catch (error) {
            throw new Error(`Copy failed: ${error}`);
        }
    }

    private async cleanupCopy(entry: CopyPoolEntry): Promise<void> {
        try {
            await invoke("delete_path", {
                path: entry.path,
                osSession: entry.osSession
            });
            console.log(`[CopyPoolManager] Cleaned up copy ${entry.id}`);
        } catch (error) {
            console.error('Failed to cleanup copy:', error);
        }
    }

    private async trackCopyProgress(
        source: string, 
        destination: string, 
        osSession: OsSession, 
        callback: (progress: CopyProgress) => void
    ): Promise<void> {
        const startTime = Date.now();
        let lastSize = 0;
        
        const checkProgress = async () => {
            try {
                const stats = await invoke("get_copy_stats", {
                    source,
                    destination,
                    osSession
                });
                
                const progress = stats as any;
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = elapsed > 0 ? (progress.copied - lastSize) / elapsed : 0;
                const remaining = speed > 0 ? (progress.total - progress.copied) / speed : 0;
                
                callback({
                    total: progress.total,
                    copied: progress.copied,
                    currentFile: progress.currentFile || '',
                    percentage: progress.total > 0 ? (progress.copied / progress.total) * 100 : 0,
                    speed: `${(speed / 1024 / 1024).toFixed(1)} MB/s`,
                    estimatedTimeRemaining: `${Math.ceil(remaining)}s`
                });
                
                lastSize = progress.copied;
                
                if (progress.copied < progress.total) {
                    setTimeout(checkProgress, 500);
                }
            } catch (error) {
                console.warn('Progress tracking failed:', error);
            }
        };
        
        setTimeout(checkProgress, 500);
    }
}