// Structured tool result formats - created in agents-server, used by frontend

export interface FileContentResult {
  type: 'file_content';
  pending: boolean;
  filePath: string;
  fileName: string;
  language: string;
  totalLines: number;
  lines: Array<{
    number: number;
    content: string;
  }>;
  isBinary?: boolean;
}

export interface FileEditResult {
  type: 'file_edit';
  pending: boolean;
  filePath: string;
  fileName: string;
  isMultiEdit: boolean;
  editsCount: number;
  oldString: string;
  newString: string;
}

export interface FileWriteResult {
  type: 'file_write';
  pending: boolean;
  filePath: string;
  fileName: string;
  content: string;
}

export interface BashOutputResult {
  type: 'bash_output';
  pending: boolean;
  command: string;
  description: string;
  content: string;
  error: boolean;
}

export interface GrepResult {
  type: 'grep_result';
  pending: boolean;
  pattern: string;
  path: string;
  glob: string;
  content: string;
}

export interface GlobResult {
  type: 'glob_result';
  pending: boolean;
  path: string;
  glob: string;
  content: string;
}

export interface WebSearchResult {
  type: 'web_search';
  pending: boolean;
  query: string;
  content: string;
}

export interface WebFetchResult {
  type: 'web_fetch';
  pending: boolean;
  url: string;
  prompt: string;
  content: string;
}

export interface TodoWriteResult {
  type: 'todo_write';
  pending: boolean;
  todos: Array<{
    content: string;
    state: "completed" | "pending"
  }>;
}

export interface TaskResult {
  type: 'task';
  pending: boolean;
  description: string;
  subagentType: string;
  prompt: string;
  result: string;
}

export interface GenericToolResult {
  type: 'generic_tool';
  pending: boolean;
  toolName: string;
  output: string;
}

// Union type for all structured tool results
export type StructuredToolResult =
  | FileContentResult
  | FileEditResult
  | BashOutputResult
  | GrepResult
  | GlobResult
  | WebSearchResult
  | WebFetchResult
  | TodoWriteResult
  | TaskResult
  | GenericToolResult;