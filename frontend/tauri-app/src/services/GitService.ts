import { invoke } from '@tauri-apps/api/core';
import { OsSession, osSessionGetWorkingDirectory } from '../bindings/os';

export class GitService {
	/**
	 * Create a git commit with all changes
	 * @param osSession - The OS session for the git repository
	 * @param message - The commit message
	 * @returns Promise<string> - The commit hash
	 */
	static async createCommit(osSession: OsSession, message: string): Promise<string> {
		const directory = osSessionGetWorkingDirectory(osSession);
		
		try {
			const commitHash = await invoke<string>('git_commit', {
				directory,
				message,
				osSession
			});
			
			console.log(`[GitService] Created commit: ${commitHash} with message: "${message}"`);
			return commitHash;
		} catch (error) {
			// Extract the actual error message, not the entire error object
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error('[GitService] Failed to create commit:', errorMessage);
			
			// Re-throw with the actual error message
			if (errorMessage === "NO_CHANGES_TO_COMMIT") {
				throw errorMessage; // Preserve special error codes
			}
			throw new Error(errorMessage); // Return just the error message, not wrapped
		}
	}

	/**
	 * Revert to a specific commit using git reset --hard
	 * @param osSession - The OS session for the git repository
	 * @param commitHash - The commit hash to revert to
	 */
	static async revertToCommit(osSession: OsSession, commitHash: string): Promise<void> {
		const directory = osSessionGetWorkingDirectory(osSession);
		
		// Validate commitHash before attempting revert
		if (!commitHash || commitHash.trim() === '') {
			throw new Error('Cannot revert: no target commit specified');
		}
		
		if (commitHash === 'HEAD~1') {
			throw new Error('Cannot revert: repository has no previous commits to revert to');
		}
		
		try {
			await invoke<void>('git_revert_to_commit', {
				directory,
				commitHash,
				osSession
			});
			
			console.log(`[GitService] Reverted to commit: ${commitHash}`);
		} catch (error) {
			console.error('[GitService] Failed to revert to commit:', error);
			
			// Provide more helpful error messages
			const errorStr = String(error);
			if (errorStr.includes('unknown revision')) {
				throw new Error('Cannot revert: the target commit does not exist in this repository');
			} else if (errorStr.includes('ambiguous argument')) {
				throw new Error('Cannot revert: repository has insufficient commit history');
			}
			
			throw new Error(`Failed to revert to commit: ${error}`);
		}
	}

	/**
	 * Check if the repository has any commits
	 * @param osSession - The OS session for the git repository
	 * @returns Promise<boolean> - True if repository has commits, false otherwise
	 */
	static async hasCommits(osSession: OsSession): Promise<boolean> {
		const directory = osSessionGetWorkingDirectory(osSession);
		
		try {
			await invoke<string>('execute_command_with_os_session', {
				command: 'git',
				args: ['log', '--oneline', '-n', '1'],
				directory,
				osSession
			});
			return true;
		} catch (error) {
			// If git log fails, it means there are no commits
			return false;
		}
	}

	/**
	 * Ensure the repository has an initial commit by creating one if none exists
	 * @param osSession - The OS session for the git repository
	 * @returns Promise<string | null> - The commit hash if created, null if already existed
	 */
	static async ensureInitialCommit(osSession: OsSession): Promise<string | null> {
		const directory = osSessionGetWorkingDirectory(osSession);
		
		// Check if repository already has commits
		const hasExistingCommits = await this.hasCommits(osSession);
		if (hasExistingCommits) {
			console.log(`[GitService] Repository already has commits, skipping initial commit`);
			return null;
		}

		console.log(`[GitService] No commits found, creating initial commit...`);

		// Create .ariana file if it doesn't exist using shell command
		try {
			const arianaContent = JSON.stringify({
				version: "1.0.0",
				created: new Date().toISOString(),
				description: "Ariana IDE project file"
			}, null, 2);

			// Use cat to create the file (works on both Linux and Windows)
			await invoke<string>('execute_command_with_os_session', {
				command: 'sh',
				args: ['-c', `cat > .ariana << 'EOF'\n${arianaContent}\nEOF`],
				directory,
				osSession
			});
			console.log(`[GitService] Created .ariana file`);
		} catch (error) {
			console.error(`[GitService] Failed to create .ariana file:`, error);
			throw new Error(`Failed to create .ariana file: ${error}`);
		}

		// Create initial commit
		try {
			const commitHash = await this.createCommit(osSession, "Initial commit - Ariana IDE project");
			console.log(`[GitService] Created initial commit: ${commitHash}`);
			return commitHash;
		} catch (error) {
			console.error(`[GitService] Failed to create initial commit:`, error);
			throw new Error(`Failed to create initial commit: ${error}`);
		}
	}

	/**
	 * Stash any uncommitted changes
	 * @param osSession - The OS session for the git repository
	 * @param message - Optional stash message
	 * @returns Promise<void>
	 */
	static async stashChanges(osSession: OsSession, message?: string): Promise<void> {
		const directory = osSessionGetWorkingDirectory(osSession);
		
		try {
			const args = ['stash'];
			if (message) {
				args.push('push', '-m', message);
			}
			
			await invoke<string>('execute_command_with_os_session', {
				command: 'git',
				args,
				directory,
				osSession
			});
			
			console.log(`[GitService] Successfully stashed changes${message ? ` with message: "${message}"` : ''}`);
		} catch (error) {
			console.error('[GitService] Failed to stash changes:', error);
			// Don't throw - stashing is best effort
		}
	}
}