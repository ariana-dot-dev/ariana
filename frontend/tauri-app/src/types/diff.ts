export interface GitDiffLine {
  lineNumber: number;
  content: string;
  type: 'added' | 'removed' | 'context';
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface GitDiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: GitDiffLine[];
}

export interface GitDiffFile {
  filePath: string;
  oldFilePath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed';
  hunks: GitDiffHunk[];
  additions: number;
  deletions: number;
}

export interface DiffChange {
  id: string;
  type: 'main_logic' | 'small_change';
  title: string;
  description: string;
  files: GitDiffFile[];
  validated: boolean;
  promptLink?: string;
  subLogicPaths?: SubLogicPath[];
}

export interface MainLogicChange extends DiffChange {
  type: 'main_logic';
  subLogicPaths: SubLogicPath[];
}

export interface SubLogicPath {
  id: string;
  title: string;
  description: string;
  files: string[];
  promptSegment: string;
  validated: boolean;
  changes: GitDiffFile[];
}

export interface DiffValidationState {
  allValidated: boolean;
  currentChange?: string;
  currentFile?: string;
  currentLine?: number;
  viewMode: 'overview' | 'detailed';
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  isHead?: boolean;
}

export interface GitBranch {
  name: string;
  isCurrentBranch: boolean;
  isRemote: boolean;
  lastCommit?: string;
  lastCommitMessage?: string;
  commits?: GitCommit[];
}

export interface BranchComparison {
  baseBranch: string;
  targetBranch: string;
  baseCommit?: string;
  targetCommit?: string;
}

export interface DiffSummary {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  mainLogicChanges: MainLogicChange[];
  smallChanges: DiffChange[];
  validationState: DiffValidationState;
}