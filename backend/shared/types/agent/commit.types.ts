// Agent commit helper types
// AgentCommit type is now provided by Prisma

// Git checkpoint for chat events
export interface GitCheckpoint {
  commitSha: string;
  commitMessage: string;
  commitUrl: string | null;  // NULL until pushed to GitHub
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  timestamp: Date;
}


// Commit info for agent polling
export interface CommitInfo {
  sha: string;
  message: string;
  timestamp: number;
  branch: string;
}

// Helper function for converting commits to checkpoint format
// Note: Now uses Prisma AgentCommit type
export function commitToCheckpoint(commit: {
  commitSha: string;
  commitMessage: string;
  commitUrl: string | null;
  branchName: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  createdAt: Date;
}): GitCheckpoint {
  return {
    commitSha: commit.commitSha,
    commitMessage: commit.commitMessage,
    commitUrl: commit.commitUrl,
    branch: commit.branchName,
    filesChanged: commit.filesChanged,
    additions: commit.additions,
    deletions: commit.deletions,
    timestamp: commit.createdAt
  };
}