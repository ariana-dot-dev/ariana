import { invoke } from "@tauri-apps/api/core";
import { OsSession } from "../bindings/os";

export interface CanvasOperationResult {
	success: boolean;
	error?: string;
}

export class CanvasService {
	/**
	 * Copies a directory from source to destination using the appropriate OS session
	 */
	static async copyDirectory(
		source: string,
		destination: string,
		osSession: OsSession,
		excludeGit?: boolean
	): Promise<CanvasOperationResult> {
		try {
			await invoke("copy_files", {
				source,
				destination,
				osSession,
				excludeGit
			});
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error as string
			};
		}
	}

	/**
	 * Creates a new git branch in the specified directory
	 */
	static async createGitBranch(
		directory: string,
		branchName: string,
		osSession: OsSession
	): Promise<CanvasOperationResult> {
		try {
			await invoke("create_git_branch", {
				directory,
				branchName,
				osSession
			});
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error as string
			};
		}
	}

	/**
	 * Executes a command in the specified directory
	 */
	static async executeCommand(
		command: string,
		args: string[],
		directory?: string
	): Promise<{ success: boolean; output?: string; error?: string }> {
		try {
			let output: string;
			
			if (directory) {
				output = await invoke("execute_command_in_dir", {
					command,
					args,
					directory
				});
			} else {
				output = await invoke("execute_command", {
					command,
					args
				});
			}

			return { success: true, output };
		} catch (error) {
			return {
				success: false,
				error: error as string
			};
		}
	}

	/**
	 * Generates a random ID for canvas operations
	 */
	static generateRandomId(): string {
		return crypto.randomUUID().replace(/-/g, '').substring(0, 8);
	}
}