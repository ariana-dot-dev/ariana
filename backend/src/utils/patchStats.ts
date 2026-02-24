// Utility to calculate additions/deletions from a unified diff patch

export interface PatchStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export function calculatePatchStats(patch: string): PatchStats {
  if (!patch || patch.trim().length === 0) {
    return { filesChanged: 0, additions: 0, deletions: 0 };
  }

  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;

  const lines = patch.split('\n');

  for (const line of lines) {
    // Count files changed (lines starting with "diff --git")
    if (line.startsWith('diff --git ')) {
      filesChanged++;
    }
    // Count additions (lines starting with +, but not +++)
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++;
    }
    // Count deletions (lines starting with -, but not ---)
    else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++;
    }
  }

  return { filesChanged, additions, deletions };
}
