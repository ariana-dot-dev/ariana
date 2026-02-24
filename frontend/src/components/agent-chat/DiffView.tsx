import { useState, useMemo, useCallback, useRef } from 'react';
import { DiffViewer } from './DiffViewer';
import { DiffCommitMap } from './DiffCommitMap';
import { DiffFileTree } from './DiffFileTree';
import type { DiffData } from '@/stores/useDiffsStore';
import { DiffActionButtons } from './DiffActionButtons';

const EMPTY_COMMITS: DiffData['commits'] = [];

interface DiffViewProps {
  diffData: DiffData | null;
  sendPrompt: (prompt: string, model?: 'opus' | 'sonnet' | 'haiku') => Promise<boolean>;
  interruptAgent: () => Promise<void>;
  canInterrupt: boolean;
  canSendPrompts: boolean;
  onCreateAgentWithPrompt?: (prompt: string) => void;
}

/** Parse a multi-file unified diff into per-file sections keyed by file name */
function splitDiffByFile(diff: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!diff) return map;
  const sections = diff.split(/(?=^diff --git )/m);
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    // Extract file name from "diff --git a/foo b/foo" line
    const match = trimmed.match(/^diff --git a\/(.+?) b\/(.+)/m);
    if (match) {
      const fileName = match[2];
      map.set(fileName, trimmed);
    }
  }
  return map;
}

/** Extract file stats (additions/deletions) from a diff string */
function getFileStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}

export interface FileEntry {
  path: string;       // full path like "backend/src/foo.ts"
  name: string;       // just the file name "foo.ts"
  additions: number;
  deletions: number;
  isNew: boolean;
  isDeleted: boolean;
}

/** Get change type from a single file section */
function getChangeType(section: string): { isNew: boolean; isDeleted: boolean } {
  const isNew = section.includes('new file mode');
  const isDeleted = section.includes('deleted file mode');
  return { isNew, isDeleted };
}

export function DiffView({ diffData, sendPrompt, interruptAgent, canInterrupt, canSendPrompts, onCreateAgentWithPrompt }: DiffViewProps) {
  // Selection state for commit filtering
  const [selectedCommitShas, setSelectedCommitShas] = useState<Set<string>>(new Set());
  // Selection state for file filtering
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const commits = diffData?.commits ?? EMPTY_COMMITS;
  const totalDiff = diffData?.totalDiff || '';

  // Compute the effective diff based on commit selection
  const effectiveDiff = useMemo(() => {
    if (selectedCommitShas.size === 0) {
      // No commits selected = show all (totalDiff)
      return totalDiff;
    }
    // Combine patches of selected commits + pending if desired
    const parts: string[] = [];
    for (const commit of commits) {
      if (selectedCommitShas.has(commit.sha) && commit.patch) {
        parts.push(commit.patch);
      }
    }
    return parts.join('\n');
  }, [selectedCommitShas, commits, totalDiff]);

  // Compute file-level diff sections from the effective diff
  const fileSectionsMap = useMemo(() => splitDiffByFile(effectiveDiff), [effectiveDiff]);

  // Build the file entries list
  const fileEntries = useMemo<FileEntry[]>(() => {
    const entries: FileEntry[] = [];
    for (const [path, section] of fileSectionsMap) {
      const stats = getFileStats(section);
      const { isNew, isDeleted } = getChangeType(section);
      const parts = path.split('/');
      entries.push({
        path,
        name: parts[parts.length - 1],
        additions: stats.additions,
        deletions: stats.deletions,
        isNew,
        isDeleted,
      });
    }
    // Sort alphabetically by path
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return entries;
  }, [fileSectionsMap]);

  // Compute the final diff to display (after both commit and file filtering)
  const displayDiff = useMemo(() => {
    if (selectedFiles.size === 0) {
      // No files selected = show all files in effective diff
      return effectiveDiff;
    }
    // Rebuild diff with only selected files
    const parts: string[] = [];
    for (const [path, section] of fileSectionsMap) {
      if (selectedFiles.has(path)) {
        parts.push(section);
      }
    }
    return parts.join('\n');
  }, [selectedFiles, effectiveDiff, fileSectionsMap]);

  // Commit selection handlers
  const handleToggleCommit = useCallback((sha: string) => {
    setSelectedCommitShas(prev => {
      const next = new Set(prev);
      if (next.has(sha)) {
        next.delete(sha);
      } else {
        next.add(sha);
      }
      return next;
    });
    // Reset file selection when commits change
    setSelectedFiles(new Set());
  }, []);

  const commitsRef = useRef(commits);
  commitsRef.current = commits;
  const fileEntriesRef = useRef(fileEntries);
  fileEntriesRef.current = fileEntries;

  const handleToggleAllCommits = useCallback(() => {
    setSelectedCommitShas(prev => {
      // If any are selected, clear all (back to "show all" default)
      // If none are selected, select all explicitly
      if (prev.size > 0) return new Set();
      return new Set(commitsRef.current.map(c => c.sha));
    });
    setSelectedFiles(new Set());
  }, []);

  // File selection handlers
  const handleToggleFile = useCallback((path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleToggleFolder = useCallback((folderPrefix: string) => {
    setSelectedFiles(prev => {
      const entries = fileEntriesRef.current;
      const filesInFolder = entries.filter(f => f.path.startsWith(folderPrefix)).map(f => f.path);
      const allSelected = filesInFolder.every(f => prev.has(f));
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all files in folder
        for (const f of filesInFolder) next.delete(f);
      } else {
        // Select all files in folder
        for (const f of filesInFolder) next.add(f);
      }
      return next;
    });
  }, []);

  const handleToggleAllFiles = useCallback(() => {
    setSelectedFiles(prev => {
      if (prev.size > 0) return new Set();
      return new Set(fileEntriesRef.current.map(f => f.path));
    });
  }, []);

  if (!diffData) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No diff data available
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 max-w-full w-[140ch] pb-10">
      {/* Action buttons */}
      <DiffActionButtons
        diff={displayDiff}
        onCreateAgentWithPrompt={onCreateAgentWithPrompt}
      />

      {/* Filter panels — stacked on mobile, side by side on md+ */}
      <div className="flex flex-col md:flex-row gap-3 w-full">
        {/* File tree - top left */}
        <div className="flex-1 min-w-0">
          <DiffFileTree
            files={fileEntries}
            selectedFiles={selectedFiles}
            onToggleFile={handleToggleFile}
            onToggleFolder={handleToggleFolder}
            onToggleAll={handleToggleAllFiles}
          />
        </div>

        {/* Metro map - top right */}
        {commits.length > 0 && (
          <div className="flex-1 min-w-0">
            <DiffCommitMap
              commits={commits}
              selectedShas={selectedCommitShas}
              onToggleCommit={handleToggleCommit}
              onToggleAll={handleToggleAllCommits}
            />
          </div>
        )}
      </div>

      {/* Diff viewer */}
      <DiffViewer
        diff={displayDiff}
        sendPrompt={sendPrompt}
        interruptAgent={interruptAgent}
        canInterrupt={canInterrupt}
        canSendPrompts={canSendPrompts}
      />
    </div>
  );
}
