import { invoke } from "@tauri-apps/api/core";
import { GitDiffFile, GitDiffHunk, GitDiffLine, DiffSummary, MainLogicChange, DiffChange, SubLogicPath, GitBranch, GitCommit, BranchComparison } from "../types/diff";
import { OsSession } from "../bindings/os";

export class DiffService {
  private workingDirectory: string | null = null;
  private osSession: OsSession | null = null;

  setWorkingDirectory(directory: string) {
    this.workingDirectory = directory;
  }

  setOsSession(osSession: OsSession) {
    this.osSession = osSession;
  }

  getWorkingDirectory(): string | null {
    return this.workingDirectory;
  }

  getOsSession(): OsSession | null {
    return this.osSession;
  }

  private async executeGitCommand(args: string[]): Promise<string> {
    try {
      let result: string;
      if (this.workingDirectory && this.osSession) {
        result = await invoke<string>("execute_command_with_os_session", {
          command: "git",
          args,
          directory: this.workingDirectory,
          osSession: this.osSession
        });
      } else {
        console.log("[FRONTEND] Missing working directory or OS session, falling back to execute_command");
        result = await invoke<string>("execute_command", {
          command: "git",
          args
        });
      }
      
      return result;
    } catch (error) {
      console.error("[FRONTEND] Git command failed:", error);
      
      // Provide helpful context for git repository errors
      if (typeof error === 'string' && error.includes('not a git repository')) {
        console.error("[FRONTEND] Git command failed - not a git repository");
        console.error("[FRONTEND] Directory:", this.workingDirectory);
        console.error("[FRONTEND] Command: git", args.join(' '));
      }
      
      throw error;
    }
  }

  async checkGitRepository(directory: string, osSession?: OsSession): Promise<boolean> {
    try {
      const sessionToUse = osSession || this.osSession;
      if (!sessionToUse) {
        console.error("[FRONTEND] No OS session available for git repository check");
        return false;
      }
      
      const isGitRepo = await invoke<boolean>("check_git_repository", {
        directory,
        osSession: sessionToUse
      });
      
      return isGitRepo;
    } catch (error) {
      console.error("[FRONTEND] Failed to check git repository:", error);
      return false;
    }
  }

  // Test method to verify basic command execution in working directory
  async testWorkingDirectory(): Promise<string> {
    try {
      if (!this.workingDirectory || !this.osSession) {
        throw new Error("No working directory or OS session configured");
      }
      
      const result = await invoke<string>("execute_command_with_os_session", {
        command: "pwd",
        args: [],
        directory: this.workingDirectory,
        osSession: this.osSession
      });
      console.log("[FRONTEND] Working directory test successful:", result);
      return result;
    } catch (error) {
      console.error("[FRONTEND] Working directory test failed:", error);
      throw error;
    }
  }

  // Test method to verify Tauri invoke is working
  async testInvoke(): Promise<string> {
    try {
      if (!this.osSession) {
        throw new Error("No OS session available for test invoke");
      }
      const currentDir = await invoke<string>("get_current_dir", {
        osSession: this.osSession
      });
      console.log("[FRONTEND] Test invoke successful:", currentDir);
      return currentDir;
    } catch (error) {
      console.error("[FRONTEND] Test invoke failed:", error);
      throw error;
    }
  }

  async getGitBranches(): Promise<GitBranch[]> {
    try {
      console.log("[FRONTEND] Getting git branches...");
      
      // First check if we're in a git repository
      const isGitRepo = this.workingDirectory 
        ? await this.checkGitRepository(this.workingDirectory, this.osSession || undefined)
        : true;
        
      if (!isGitRepo) {
        throw new Error("Directory is not a git repository. Please select a directory with .git or .github folder.");
      }

      // Get local branches with error handling
      let localBranchesOutput = "";
      try {
        localBranchesOutput = await this.executeGitCommand([
          "branch", "--format=%(refname:short)|%(HEAD)|%(objectname:short)|%(contents:subject)"
        ]);
      } catch (error) {
        console.log("[FRONTEND] Formatted local branches failed, trying simple format:", error);
        // Fallback to simpler branch listing
        try {
          localBranchesOutput = await this.executeGitCommand(["branch"]);
        } catch (fallbackError) {
          console.warn("[FRONTEND] Failed to get local branches:", fallbackError);
        }
      }

      // Get remote branches with error handling
      let remoteBranchesOutput = "";
      try {
        remoteBranchesOutput = await this.executeGitCommand([
          "branch", "-r", "--format=%(refname:short)|%(HEAD)|%(objectname:short)|%(contents:subject)"
        ]);
      } catch (error) {
        console.log("[FRONTEND] Formatted remote branches failed, trying simple:", error);
        // Fallback to simpler remote branch listing
        try {
          remoteBranchesOutput = await this.executeGitCommand(["branch", "-r"]);
        } catch (fallbackError) {
          console.warn("[FRONTEND] Failed to get remote branches:", fallbackError);
        }
      }

      const branches: GitBranch[] = [];

      // Parse local branches
      if (localBranchesOutput.trim()) {
        localBranchesOutput.split('\n').forEach((line, index) => {
          if (line.trim()) {
            if (line.includes('|')) {
              // Format output parsing
              const parts = line.split('|');
              const [name, head, commit, message] = parts;
              const branch = {
                name: name?.trim() || '',
                isCurrentBranch: head?.trim() === '*',
                isRemote: false,
                lastCommit: commit?.trim(),
                lastCommitMessage: message?.trim()
              };
              branches.push(branch);
            } else {
              // Simple branch output parsing
              const trimmedLine = line.trim();
              const isCurrentBranch = trimmedLine.startsWith('*');
              const branchName = trimmedLine.replace(/^\*\s*/, '').trim();
              if (branchName) {
                const branch = {
                  name: branchName,
                  isCurrentBranch,
                  isRemote: false,
                  lastCommit: undefined,
                  lastCommitMessage: undefined
                };
                branches.push(branch);
              }
            }
          }
        });
      }

      // Parse remote branches
      if (remoteBranchesOutput.trim()) {
        remoteBranchesOutput.split('\n').forEach((line, index) => {
          if (line.trim() && !line.includes('HEAD ->')) {
            if (line.includes('|')) {
              // Format output parsing
              const parts = line.split('|');
              const [name, head, commit, message] = parts;
              const cleanName = name?.trim().replace(/^origin\//, '') || '';
              
              // Only add if not already present as local branch
              if (cleanName && !branches.some(b => b.name === cleanName)) {
                const branch = {
                  name: cleanName,
                  isCurrentBranch: false,
                  isRemote: true,
                  lastCommit: commit?.trim(),
                  lastCommitMessage: message?.trim()
                };
                branches.push(branch);
              }
            } else {
              // Simple remote branch output parsing
              const trimmedLine = line.trim();
              const cleanName = trimmedLine.replace(/^origin\//, '').replace(/^\*\s*/, '');
              
              // Only add if not already present as local branch
              if (cleanName && !branches.some(b => b.name === cleanName)) {
                const branch = {
                  name: cleanName,
                  isCurrentBranch: false,
                  isRemote: true,
                  lastCommit: undefined,
                  lastCommitMessage: undefined
                };
                branches.push(branch);
              }
            }
          }
        });
      }

      // Sort branches
      const sortedBranches = branches.sort((a, b) => {
        // Current branch first, then local branches, then remote branches
        if (a.isCurrentBranch) return -1;
        if (b.isCurrentBranch) return 1;
        if (!a.isRemote && b.isRemote) return -1;
        if (a.isRemote && !b.isRemote) return 1;
        return a.name.localeCompare(b.name);
      });
      
      return sortedBranches;
    } catch (error) {
      console.error("Failed to get git branches:", error);
      const errorStr = String(error);
      
      if (errorStr.includes("Not a git repository")) {
        throw new Error("This directory is not a git repository. Please navigate to a git repository to use diff management.");
      } else if (errorStr.includes("not found")) {
        throw new Error("Git is not installed or not available in PATH. Please install git to use diff management.");
      } else {
        throw new Error(`Failed to list git branches: ${errorStr}`);
      }
    }
  }

  async getBranchCommits(branchName: string, limit: number = 20): Promise<GitCommit[]> {
    try {
      console.log(`[FRONTEND] Getting commits for branch: ${branchName}`);
      
      const output = await this.executeGitCommand([
        "log",
        branchName,
        "--pretty=format:%H|%h|%s|%an|%ad",
        "--date=short",
        `-n${limit}`
      ]);
      
      const commits: GitCommit[] = [];
      if (output.trim()) {
        output.split('\n').forEach((line, index) => {
          if (line.trim()) {
            const parts = line.split('|');
            if (parts.length >= 5) {
              commits.push({
                hash: parts[0],
                shortHash: parts[1],
                message: parts[2],
                author: parts[3],
                date: parts[4],
                isHead: index === 0
              });
            }
          }
        });
      }
      
      console.log(`[FRONTEND] Found ${commits.length} commits for ${branchName}`);
      return commits;
    } catch (error) {
      console.error(`Failed to get commits for branch ${branchName}:`, error);
      throw new Error(`Failed to get commits for branch ${branchName}: ${error}`);
    }
  }

  async getBranchComparison(baseBranch: string, targetBranch: string, baseCommit?: string, targetCommit?: string): Promise<string> {
    try {
      // First check if we're in a git repository
      await this.executeGitCommand(["rev-parse", "--git-dir"]);

      const baseRef = baseCommit || baseBranch;
      const targetRef = targetCommit || targetBranch;
      
      console.log(`[FRONTEND] Comparing ${baseRef} with ${targetRef}`);
      
      // Special handling for unstaged/staged changes
      const currentBranch = await this.executeGitCommand(["branch", "--show-current"]);
      
      // Case 1: Comparing with unstaged changes
      if (targetCommit === 'UNSTAGED') {
        console.log(`[FRONTEND] Comparing ${baseRef} with unstaged changes`);
        
        // If base is different from current branch, we need to show ALL changes from base to current state
        if (baseRef !== currentBranch.trim() && baseRef !== 'HEAD') {
          console.log(`[FRONTEND] Cross-branch comparison: ${baseRef} to current unstaged`);
          
          try {
            // Get diff from base branch to current HEAD (committed changes)
            const committedDiff = await this.executeGitCommand(["diff", `${baseRef}...HEAD`]);
            
            // Get unstaged changes from current HEAD
            const unstagedDiff = await this.executeGitCommand(["diff", "HEAD"]);
            
            console.log(`[FRONTEND] Committed diff length: ${committedDiff.length}`);
            console.log(`[FRONTEND] Unstaged diff length: ${unstagedDiff.length}`);
            
            // Combine both to show complete diff from base to current state
            if (committedDiff.trim() && unstagedDiff.trim()) {
              // Parse and merge the diffs properly
              const combinedDiff = this.combineDiffs(committedDiff, unstagedDiff);
              return combinedDiff;
            } else if (committedDiff.trim()) {
              return committedDiff;
            } else if (unstagedDiff.trim()) {
              return unstagedDiff;
            } else {
              return "";
            }
            
          } catch (error) {
            console.warn(`[FRONTEND] Failed combined diff, trying direct comparison:`, error);
            // Fallback: get diff from base directly to working directory
            return await this.executeGitCommand(["diff", baseRef]);
          }
        } else {
          // Same branch comparison - just show unstaged changes
          return await this.executeGitCommand(["diff", "HEAD"]);
        }
      }
      
      // Case 2: Comparing with staged changes  
      else if (targetCommit === 'STAGED') {
        console.log(`[FRONTEND] Comparing ${baseRef} with staged changes`);
        
        if (baseRef !== currentBranch.trim() && baseRef !== 'HEAD') {
          // Cross-branch: base to current HEAD + staged changes
          try {
            const committedDiff = await this.executeGitCommand(["diff", `${baseRef}...HEAD`]);
            const stagedDiff = await this.executeGitCommand(["diff", "--cached", "HEAD"]);
            
            if (committedDiff.trim() && stagedDiff.trim()) {
              return this.combineDiffs(committedDiff, stagedDiff);
            } else if (committedDiff.trim()) {
              return committedDiff;
            } else if (stagedDiff.trim()) {
              return stagedDiff;
            } else {
              return "";
            }
          } catch (error) {
            console.warn(`[FRONTEND] Failed staged diff combination:`, error);
            return await this.executeGitCommand(["diff", "--cached", baseRef]);
          }
        } else {
          // Same branch - just show staged changes
          return await this.executeGitCommand(["diff", "--cached", "HEAD"]);
        }
      }
      
      // Case 3: Normal branch/commit comparison
      else {
        const diff = await this.executeGitCommand(["diff", `${baseRef}...${targetRef}`]);
        return diff;
      }
      
    } catch (error) {
      console.error("Failed to get branch comparison:", error);
      const errorStr = String(error);
      
      if (errorStr.includes("Not a git repository")) {
        throw new Error("This directory is not a git repository. Please navigate to a git repository to use diff management.");
      } else if (errorStr.includes("not found")) {
        throw new Error("Git is not installed or not available in PATH. Please install git to use diff management.");
      } else if (errorStr.includes("unknown revision")) {
        throw new Error(`One or both refs not found: ${baseCommit || baseBranch}, ${targetCommit || targetBranch}`);
      } else {
        throw new Error(`Failed to compare branches: ${errorStr}`);
      }
    }
  }

  async getUnifiedDiff(baseBranch: string, targetBranch: string, baseCommit?: string, targetCommit?: string): Promise<string> {
    try {
      const baseRef = baseCommit || baseBranch;
      const targetRef = targetCommit || targetBranch;
      
      // Special handling for unstaged/staged changes (same logic as getBranchComparison)
      const currentBranch = await this.executeGitCommand(["branch", "--show-current"]);
      
      // Case 1: Comparing with unstaged changes
      if (targetCommit === 'UNSTAGED') {
        console.log(`[FRONTEND] Getting unified diff: ${baseRef} with unstaged changes`);
        
        if (baseRef !== currentBranch.trim() && baseRef !== 'HEAD') {
          console.log(`[FRONTEND] Cross-branch unified diff: ${baseRef} to current unstaged`);
          
          try {
            const committedDiff = await this.executeGitCommand([
              "diff", 
              "--unified=3",
              "--no-color",
              `${baseRef}...HEAD`
            ]);
            
            const unstagedDiff = await this.executeGitCommand([
              "diff",
              "--unified=3", 
              "--no-color",
              "HEAD"
            ]);
            
            if (committedDiff.trim() && unstagedDiff.trim()) {
              return this.combineDiffs(committedDiff, unstagedDiff);
            } else if (committedDiff.trim()) {
              return committedDiff;
            } else if (unstagedDiff.trim()) {
              return unstagedDiff;
            } else {
              return "";
            }
          } catch (error) {
            console.warn(`[FRONTEND] Failed unified diff combination:`, error);
            return await this.executeGitCommand([
              "diff", 
              "--unified=3",
              "--no-color",
              baseRef
            ]);
          }
        } else {
          return await this.executeGitCommand([
            "diff",
            "--unified=3", 
            "--no-color",
            "HEAD"
          ]);
        }
      }
      
      // Case 2: Comparing with staged changes
      else if (targetCommit === 'STAGED') {
        console.log(`[FRONTEND] Getting unified diff: ${baseRef} with staged changes`);
        
        if (baseRef !== currentBranch.trim() && baseRef !== 'HEAD') {
          try {
            const committedDiff = await this.executeGitCommand([
              "diff", 
              "--unified=3",
              "--no-color",
              `${baseRef}...HEAD`
            ]);
            
            const stagedDiff = await this.executeGitCommand([
              "diff",
              "--unified=3", 
              "--no-color",
              "--cached",
              "HEAD"
            ]);
            
            if (committedDiff.trim() && stagedDiff.trim()) {
              return this.combineDiffs(committedDiff, stagedDiff);
            } else if (committedDiff.trim()) {
              return committedDiff;
            } else if (stagedDiff.trim()) {
              return stagedDiff;
            } else {
              return "";
            }
          } catch (error) {
            console.warn(`[FRONTEND] Failed staged unified diff combination:`, error);
            return await this.executeGitCommand([
              "diff",
              "--unified=3", 
              "--no-color",
              "--cached",
              baseRef
            ]);
          }
        } else {
          return await this.executeGitCommand([
            "diff",
            "--unified=3", 
            "--no-color",
            "--cached",
            "HEAD"
          ]);
        }
      }
      
      // Case 3: Normal branch/commit comparison
      else {
        const diff = await this.executeGitCommand([
          "diff", 
          "--unified=3",
          "--no-color",
          `${baseRef}...${targetRef}`
        ]);
        
        return diff;
      }
      
    } catch (error) {
      console.error("Failed to get unified diff:", error);
      throw new Error(`Failed to generate unified diff: ${error}`);
    }
  }

  async getUnstagedChanges(): Promise<string> {
    try {
      // Get unstaged changes (working directory vs HEAD)
      const diff = await this.executeGitCommand([
        "diff",
        "--unified=3", 
        "--no-color",
        "HEAD"
      ]);
      
      return diff;
    } catch (error) {
      console.error("Failed to get unstaged changes:", error);
      throw new Error(`Failed to get unstaged changes: ${error}`);
    }
  }

  async getStagedChanges(): Promise<string> {
    try {
      // Get staged changes (index vs HEAD)
      const diff = await this.executeGitCommand([
        "diff",
        "--unified=3",
        "--no-color", 
        "--cached",
        "HEAD"
      ]);
      
      return diff;
    } catch (error) {
      console.error("Failed to get staged changes:", error);
      throw new Error(`Failed to get staged changes: ${error}`);
    }
  }

  async addFilesToGit(filePaths: string[]): Promise<void> {
    try {
      console.log("[FRONTEND] Starting git add operation");
      console.log("[FRONTEND] Files to add:", filePaths);
      console.log("[FRONTEND] Current working directory:", this.workingDirectory);
      
      // Get comprehensive git information
      let gitRoot = "";
      let currentBranch = "";
      let gitStatus = "";
      
      try {
        gitRoot = (await this.executeGitCommand(["rev-parse", "--show-toplevel"])).trim();
        currentBranch = (await this.executeGitCommand(["branch", "--show-current"])).trim();
        gitStatus = await this.executeGitCommand(["status", "--porcelain"]);
        
        console.log("[FRONTEND] Git root:", gitRoot);
        console.log("[FRONTEND] Current branch:", currentBranch);
        console.log("[FRONTEND] Git status (modified files):");
        console.log(gitStatus);
      } catch (error) {
        console.warn("[FRONTEND] Could not get git info:", error);
      }
      
      // Parse git status to get list of actually modified files
      const modifiedFiles = new Set<string>();
      if (gitStatus) {
        gitStatus.split('\n').forEach(line => {
          if (line.trim()) {
            // Git status format: "XY filename" where X and Y are status codes
            const filename = line.substring(3).trim();
            modifiedFiles.add(filename);
            console.log("[FRONTEND] Found modified file in git status:", filename);
          }
        });
      }
      
      console.log("[FRONTEND] All modified files from git status:", Array.from(modifiedFiles));
      
      // Try to match our file paths with actually modified files
      const filesToAdd: string[] = [];
      
      for (const filePath of filePaths) {
        console.log(`[FRONTEND] Looking for matches for: ${filePath}`);
        
        // Try to find this file in the list of modified files
        let matchedFile = null;
        
        // Direct match
        if (modifiedFiles.has(filePath)) {
          matchedFile = filePath;
        } else {
          // Try various path transformations to find a match
          for (const modifiedFile of modifiedFiles) {
            // Check if the modified file ends with our file path
            if (modifiedFile.endsWith(filePath) || filePath.endsWith(modifiedFile)) {
              matchedFile = modifiedFile;
              break;
            }
            
            // Check if removing common prefixes helps
            const cleanFilePath = filePath.replace(/^frontend\/tauri-app\//, '');
            if (modifiedFile === cleanFilePath || modifiedFile.endsWith(cleanFilePath)) {
              matchedFile = modifiedFile;
              break;
            }
            
            // Check if the base filename matches
            const baseFileName = filePath.split('/').pop();
            const modifiedFileName = modifiedFile.split('/').pop();
            if (baseFileName === modifiedFileName && modifiedFile.includes('src')) {
              matchedFile = modifiedFile;
              break;
            }
          }
        }
        
        if (matchedFile) {
          console.log(`[FRONTEND] Found match: ${filePath} -> ${matchedFile}`);
          filesToAdd.push(matchedFile);
        } else {
          console.warn(`[FRONTEND] No match found for ${filePath} in modified files`);
        }
      }
      
      console.log("[FRONTEND] Files that will be added to git:", filesToAdd);
      
      // Add the matched files
      if (filesToAdd.length > 0) {
        for (const file of filesToAdd) {
          try {
            console.log(`[FRONTEND] Adding file to git: ${file}`);
            await this.executeGitCommand(["add", file]);
            console.log(`[FRONTEND] Successfully added: ${file}`);
          } catch (error) {
            console.error(`[FRONTEND] Failed to add ${file}:`, error);
          }
        }
      } else {
        console.warn("[FRONTEND] No files to add - trying to add all modified files");
        // If we can't match any files, try adding all modified files
        try {
          await this.executeGitCommand(["add", "."]);
          console.log("[FRONTEND] Successfully added all modified files with 'git add .'");
        } catch (error) {
          console.error("[FRONTEND] Failed to add all files:", error);
        }
      }
      
      // Final status check
      try {
        const finalStatus = await this.executeGitCommand(["status", "--porcelain"]);
        console.log("[FRONTEND] Git status after adding:");
        console.log(finalStatus);
      } catch (error) {
        console.warn("[FRONTEND] Could not get final git status:", error);
      }
      
    } catch (error) {
      console.error("[FRONTEND] Git add operation failed:", error);
      console.warn("[FRONTEND] Allowing validation to continue despite git add failure");
    }
  }

  async getGitDiff(): Promise<string> {
    try {
      // First check if we're in a git repository
      await this.executeGitCommand(["rev-parse", "--git-dir"]);
      
      // Get diff between current working directory and last commit
      const diff = await this.executeGitCommand(["diff", "HEAD"]);
      
      // If no staged changes, try diff against branch creation point
      if (!diff.trim()) {
        try {
          const branchDiff = await this.executeGitCommand(["diff", "origin/main...HEAD"]);
          return branchDiff;
        } catch {
          // If origin/main doesn't exist, try other common base branches
          try {
            const mainDiff = await this.executeGitCommand(["diff", "main...HEAD"]);
            return mainDiff;
          } catch {
            // If no base branch, show all changes in working directory
            const workingDiff = await this.executeGitCommand(["diff"]);
            return workingDiff;
          }
        }
      }
      
      return diff;
    } catch (error) {
      console.error("Failed to get git diff:", error);
      const errorStr = String(error);
      
      if (errorStr.includes("Not a git repository")) {
        throw new Error("This directory is not a git repository. Please navigate to a git repository to use diff management.");
      } else if (errorStr.includes("not found")) {
        throw new Error("Git is not installed or not available in PATH. Please install git to use diff management.");
      } else {
        throw new Error(`Git diff failed: ${errorStr}`);
      }
    }
  }

  parseDiff(diffText: string): GitDiffFile[] {
    const files: GitDiffFile[] = [];
    const lines = diffText.split('\n');
    let currentFile: GitDiffFile | null = null;
    let currentHunk: GitDiffHunk | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // File header
      if (line.startsWith('diff --git')) {
        if (currentFile) {
          files.push(currentFile);
        }
        
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (match) {
          currentFile = {
            filePath: match[2],
            oldFilePath: match[1] !== match[2] ? match[1] : undefined,
            status: 'modified',
            hunks: [],
            additions: 0,
            deletions: 0
          };
        }
      }
      
      // File status
      else if (line.startsWith('new file mode')) {
        if (currentFile) currentFile.status = 'added';
      }
      else if (line.startsWith('deleted file mode')) {
        if (currentFile) currentFile.status = 'deleted';
      }
      else if (line.startsWith('rename from')) {
        if (currentFile) currentFile.status = 'renamed';
      }
      
      // Hunk header
      else if (line.startsWith('@@')) {
        const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
        if (match && currentFile) {
          currentHunk = {
            oldStart: parseInt(match[1]),
            oldCount: parseInt(match[2]) || 1,
            newStart: parseInt(match[3]),
            newCount: parseInt(match[4]) || 1,
            lines: []
          };
          currentFile.hunks.push(currentHunk);
        }
      }
      
      // Diff lines
      else if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        const type = line.startsWith('+') ? 'added' : 
                    line.startsWith('-') ? 'removed' : 'context';
        
        currentHunk.lines.push({
          lineNumber: currentHunk.lines.length + 1,
          content: line.substring(1),
          type,
          oldLineNumber: type !== 'added' ? currentHunk.oldStart + currentHunk.lines.filter(l => l.type !== 'added').length : undefined,
          newLineNumber: type !== 'removed' ? currentHunk.newStart + currentHunk.lines.filter(l => l.type !== 'removed').length : undefined
        });
        
        if (currentFile) {
          if (type === 'added') currentFile.additions++;
          else if (type === 'removed') currentFile.deletions++;
        }
      }
    }
    
    if (currentFile) {
      files.push(currentFile);
    }
    
    return files;
  }

  categorizeChanges(files: GitDiffFile[]): DiffSummary {
    const mainLogicChanges: MainLogicChange[] = [];
    const smallChanges: DiffChange[] = [];
    
    // Handle empty diff case
    if (files.length === 0) {
      return {
        totalFiles: 0,
        totalAdditions: 0,
        totalDeletions: 0,
        mainLogicChanges: [],
        smallChanges: [],
        validationState: {
          allValidated: true, // No changes means everything is "validated"
          viewMode: 'overview'
        }
      };
    }
    
    // Analyze files to determine if they're main logic or small changes
    for (const file of files) {
      const totalChanges = file.additions + file.deletions;
      const isMainLogic = this.isMainLogicChange(file, totalChanges);
      
      if (isMainLogic) {
        const mainChange = this.createMainLogicChange(file);
        mainLogicChanges.push(mainChange);
      } else {
        const smallChange = this.createSmallChange(file);
        smallChanges.push(smallChange);
      }
    }
    
    return {
      totalFiles: files.length,
      totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
      mainLogicChanges,
      smallChanges,
      validationState: {
        allValidated: false,
        viewMode: 'overview'
      }
    };
  }

  private isMainLogicChange(file: GitDiffFile, totalChanges: number): boolean {
    // Logic to determine if this is a main logic change
    const largeChangeThreshold = 20;
    const isLargeChange = totalChanges > largeChangeThreshold;
    
    // Check file patterns that typically indicate main logic
    const mainLogicPatterns = [
      /\.tsx?$/, // React components
      /Service\.ts$/, // Service files
      /Manager\.ts$/, // Manager files
      /\/types\//, // Type definitions
      /\/state\//, // State management
    ];
    
    const isMainLogicFile = mainLogicPatterns.some(pattern => 
      pattern.test(file.filePath)
    );
    
    return isLargeChange || isMainLogicFile;
  }

  private createMainLogicChange(file: GitDiffFile): MainLogicChange {
    const subLogicPaths = this.generateSubLogicPaths(file);
    
    return {
      id: `main-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'main_logic',
      title: file.filePath,
      description: `${file.additions} additions, ${file.deletions} deletions`,
      files: [file],
      validated: false,
      subLogicPaths
    };
  }

  private createSmallChange(file: GitDiffFile): DiffChange {
    const subLogicPaths = this.generateSubLogicPaths(file);
    
    return {
      id: `small-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'small_change',
      title: file.filePath,
      description: `${file.additions} additions, ${file.deletions} deletions`,
      files: [file],
      validated: false,
      subLogicPaths
    };
  }

  private generateSubLogicPaths(file: GitDiffFile): SubLogicPath[] {
    const subPaths: SubLogicPath[] = [];
    
    // Analyze hunks to create logical groupings
    file.hunks.forEach((hunk, index) => {
      const addedLines = hunk.lines.filter(l => l.type === 'added');
      const removedLines = hunk.lines.filter(l => l.type === 'removed');
      
      // Try to infer the type of change based on content
      const changeType = this.inferChangeType(addedLines, removedLines);
      
      subPaths.push({
        id: `hunk-${index}`,
        title: changeType.title,
        description: changeType.description,
        files: [file.filePath],
        promptSegment: changeType.promptSegment,
        validated: false,
        changes: [file]
      });
    });
    
    return subPaths;
  }

  private combineDiffs(diff1: string, diff2: string): string {
    // Simple combination for now - just concatenate the diffs
    // This could be enhanced to merge overlapping file changes more intelligently
    console.log("[FRONTEND] Combining two diffs");
    
    if (!diff1.trim()) return diff2;
    if (!diff2.trim()) return diff1;
    
    // Add a separator comment between the diffs
    return diff1 + "\n\n" + diff2;
  }

  private inferChangeType(addedLines: GitDiffLine[], removedLines: GitDiffLine[]) {
    // Analyze code patterns to infer what type of change this is
    const addedContent = addedLines.map(l => l.content).join('\n');
    const removedContent = removedLines.map(l => l.content).join('\n');
    
    // Define patterns and their corresponding change types
    const patterns = [
      {
        pattern: /(interface|type|class)/i,
        title: "Type Definition Changes",
        description: "Modifications to TypeScript interfaces, types, or classes",
        promptSegment: "type-definitions"
      },
      {
        pattern: /(useState|useEffect|useCallback)/i,
        title: "React Hooks Implementation",
        description: "Changes to React hooks and state management",
        promptSegment: "react-hooks"
      },
      {
        pattern: /(function|const.*=.*=>|async)/i,
        title: "Function Implementation",
        description: "New functions or modifications to existing function logic",
        promptSegment: "function-logic"
      },
      {
        pattern: /(className|style|css)/i,
        title: "UI/Styling Changes",
        description: "Modifications to component styling and layout",
        promptSegment: "ui-styling"
      },
      {
        pattern: /(import|export)/i,
        title: "Module Dependencies",
        description: "Changes to imports, exports, and module structure",
        promptSegment: "module-deps"
      }
    ];
    
    for (const pattern of patterns) {
      if (pattern.pattern.test(addedContent) || pattern.pattern.test(removedContent)) {
        return pattern;
      }
    }
    
    // Default case
    return {
      title: "General Logic Changes",
      description: "Miscellaneous code modifications",
      promptSegment: "general-logic"
    };
  }

  async discardFileChanges(filePaths: string[]): Promise<void> {
    try {
      console.log("[FRONTEND] Starting discard file changes operation");
      console.log("[FRONTEND] Files to discard:", filePaths);
      
      for (const filePath of filePaths) {
        try {
          console.log(`[FRONTEND] Discarding changes for file: ${filePath}`);
          
          // Use git checkout to discard unstaged changes
          await this.executeGitCommand(["checkout", "HEAD", "--", filePath]);
          
          // Also remove from staging area if it was staged
          try {
            await this.executeGitCommand(["reset", "HEAD", "--", filePath]);
          } catch (error) {
            // Ignore errors for reset - file might not be staged
            console.log(`[FRONTEND] Reset not needed for ${filePath}:`, error);
          }
          
          console.log(`[FRONTEND] Successfully discarded changes for: ${filePath}`);
        } catch (error) {
          console.error(`[FRONTEND] Failed to discard changes for ${filePath}:`, error);
          throw new Error(`Failed to discard changes for ${filePath}: ${error}`);
        }
      }
    } catch (error) {
      console.error("[FRONTEND] Discard file changes operation failed:", error);
      throw error;
    }
  }

  async discardHunkChanges(filePath: string, hunk: GitDiffHunk): Promise<void> {
    try {
      console.log("[FRONTEND] Starting discard hunk changes operation");
      console.log("[FRONTEND] File:", filePath);
      console.log("[FRONTEND] Hunk:", hunk);
      
      // For now, provide a helpful message about hunk-level discard
      // This would require more advanced git operations with temporary files
      throw new Error(
        "Hunk-level discard is not yet implemented. " +
        "This feature requires creating and applying reverse patches, which needs more complex implementation. " +
        "For now, please use 'Discard File' to discard all changes in the file, " +
        "or manually edit the file to remove specific changes."
      );
      
    } catch (error) {
      console.error("[FRONTEND] Discard hunk changes operation failed:", error);
      throw error;
    }
  }

  async validateHunkChanges(filePath: string, hunk: GitDiffHunk): Promise<void> {
    try {
      console.log("[FRONTEND] Starting validate hunk changes operation");
      console.log("[FRONTEND] File:", filePath);
      console.log("[FRONTEND] Hunk:", hunk);
      
      // For now, just validate the whole file when a hunk is validated
      // This could be enhanced to validate individual hunks with git add --patch
      await this.addFilesToGit([filePath]);
      
      console.log("[FRONTEND] Successfully validated hunk changes (whole file)");
    } catch (error) {
      console.error("[FRONTEND] Validate hunk changes operation failed:", error);
      throw error;
    }
  }

  async validateFileChanges(filePath: string): Promise<void> {
    try {
      console.log("[FRONTEND] Starting validate file changes operation");
      console.log("[FRONTEND] File:", filePath);
      
      // Validate the entire file by adding it to git
      await this.addFilesToGit([filePath]);
      
      console.log("[FRONTEND] Successfully validated file changes");
    } catch (error) {
      console.error("[FRONTEND] Validate file changes operation failed:", error);
      throw error;
    }
  }
}

export const diffService = new DiffService();