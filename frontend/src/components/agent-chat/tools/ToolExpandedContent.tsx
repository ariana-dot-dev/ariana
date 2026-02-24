/**
 * Renders ONLY the expanded content for a tool - no header, no wrapper.
 * Used by ToolEventsGroup to avoid redundancy with the summary row.
 */

import { cn } from '@/lib/utils';
import type { ToolResult, ToolUse } from '@/bindings/types';
import type {
  FileContentResult,
  FileEditResult,
  FileWriteResult,
  BashOutputResult,
  GrepResult,
  GlobResult,
  WebSearchResult,
  WebFetchResult,
  TodoWriteResult,
  TaskResult,
} from '@/bindings/types';
import { Badge } from '@/components/ui/badge';
import { CodeViewer } from './shared/ToolContentBlock';
import * as Diff from 'diff';
import { useInlineDiffTheme } from '@/lib/diffsTheme';
import { PatchDiff } from '@pierre/diffs/react';

interface ToolExpandedContentProps {
  toolUse: ToolUse;
  toolResult?: ToolResult;
}

function parseToolResult<T>(toolResult?: ToolResult): T | null {
  if (!toolResult?.content) return null;
  try {
    return JSON.parse(toolResult.content) as T;
  } catch {
    return null;
  }
}


function FileReadContent({ result }: { result: FileContentResult }) {
  return (
    <CodeViewer
      lines={result.lines.map(line => ({ content: line.content, number: line.number }))}
      filePath={result.filePath}
    />
  );
}

function FileEditContent({ result }: { result: FileEditResult }) {
  const { styles, options } = useInlineDiffTheme();
  const patchString = Diff.createPatch(result.filePath, result.oldString, result.newString);

  if (!patchString) return null;

  return (
    <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-64 bg-background">
      <PatchDiff
        patch={patchString}
        options={options}
        style={styles}
      />
    </div>
  );
}

function FileWriteContent({ result }: { result: FileWriteResult }) {
  const lines = result.content.split('\n');
  return (
    <CodeViewer
      lines={lines.map(line => ({ content: line }))}
      filePath={result.filePath}
    />
  );
}

function BashContent({ result }: { result: BashOutputResult }) {
  const lines = (result.content ?? '').split('\n');
  return (
    <div className="flex flex-col gap-2">
      {/* Full command with wrapping */}
      {result.command && (
        <div className="flex items-start gap-2 text-xs">
          <Badge variant={result.error ? "destructive" : "default"} className="text-xs h-4 flex-shrink-0">
            {result.error ? 'Error' : 'Success'}
          </Badge>
          <code className="font-mono text-muted-foreground whitespace-pre-wrap break-all">
            $ {result.command}
          </code>
        </div>
      )}
      {/* Output */}
      <div className={cn(
        "rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-64 bg-background font-mono text-xs",
        result.error && "bg-destructive/10"
      )}>
        {lines.map((line, i) => (
          <div key={i} className="flex hover:bg-muted/30">
            <div className="w-8 flex-shrink-0 text-right px-1 py-0.5 text-muted-foreground/50 bg-background-darker select-none">
              {i + 1}
            </div>
            <div className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-all">{line}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GrepContent({ result }: { result: GrepResult }) {
  const lines = result.content.split('\n').filter(line => line.trim());
  return <CodeViewer lines={lines.map(line => ({ content: line }))} />;
}

function GlobContent({ result }: { result: GlobResult }) {
  const lines = result.content.split('\n').filter(line => line.trim());
  return <CodeViewer lines={lines.map(line => ({ content: line }))} />;
}

function WebSearchContent({ result }: { result: WebSearchResult }) {
  return (
    <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-64 bg-background">
      <pre className="p-2 whitespace-pre-wrap break-all text-xs font-mono">{result.content}</pre>
    </div>
  );
}

function WebFetchContent({ result }: { result: WebFetchResult }) {
  return (
    <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-64 bg-background">
      <pre className="p-2 whitespace-pre-wrap break-all text-xs font-mono">{result.content}</pre>
    </div>
  );
}

function TaskContent({ result }: { result: TaskResult }) {
  return (
    <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-64 bg-background p-2">
      {result.result && (
        <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">{result.result}</pre>
      )}
    </div>
  );
}

function TodoWriteContent({ result }: { result: TodoWriteResult }) {
  return (
    <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-64 bg-background p-2 space-y-1">
      {result.todos.map((todo, i) => (
        <div key={i} className="flex items-center gap-2 p-1 bg-muted/30 rounded text-xs">
          <span className={cn(
            "w-2 h-2 rounded-full flex-shrink-0",
            todo.state === 'completed' ? "bg-constructive" : "bg-yellow-500"
          )} />
          <span className="flex-1">{todo.content}</span>
          <Badge variant="outline" className="text-xs h-4">{todo.state}</Badge>
        </div>
      ))}
    </div>
  );
}

export function ToolExpandedContent({ toolUse, toolResult }: ToolExpandedContentProps) {
  switch (toolUse.name) {
    case 'Read': {
      const result = parseToolResult<FileContentResult>(toolResult);
      return result && !result.pending ? <FileReadContent result={result} /> : null;
    }
    case 'Edit':
    case 'MultiEdit': {
      const result = parseToolResult<FileEditResult>(toolResult);
      return result && !result.pending ? <FileEditContent result={result} /> : null;
    }
    case 'Write': {
      const result = parseToolResult<FileWriteResult>(toolResult);
      return result && !result.pending ? <FileWriteContent result={result} /> : null;
    }
    case 'Bash':
    case 'BashOutput':
    case 'KillShell': {
      const result = parseToolResult<BashOutputResult>(toolResult);
      return result && !result.pending ? <BashContent result={result} /> : null;
    }
    case 'Grep': {
      const result = parseToolResult<GrepResult>(toolResult);
      return result && !result.pending ? <GrepContent result={result} /> : null;
    }
    case 'Glob': {
      const result = parseToolResult<GlobResult>(toolResult);
      return result && !result.pending ? <GlobContent result={result} /> : null;
    }
    case 'WebSearch': {
      const result = parseToolResult<WebSearchResult>(toolResult);
      return result && !result.pending ? <WebSearchContent result={result} /> : null;
    }
    case 'WebFetch': {
      const result = parseToolResult<WebFetchResult>(toolResult);
      return result && !result.pending ? <WebFetchContent result={result} /> : null;
    }
    case 'Task': {
      const result = parseToolResult<TaskResult>(toolResult);
      return result && !result.pending ? <TaskContent result={result} /> : null;
    }
    case 'TodoWrite': {
      const result = parseToolResult<TodoWriteResult>(toolResult);
      return result && !result.pending ? <TodoWriteContent result={result} /> : null;
    }
    case 'Skill': {
      // Skill result may be JSON with output field or plain text
      const skillName = (toolUse.input as Record<string, unknown>)?.skill as string || 'unknown';
      let displayContent = '';
      if (toolResult?.content) {
        try {
          const parsed = JSON.parse(toolResult.content);
          displayContent = parsed.output || parsed.content || toolResult.content;
        } catch {
          displayContent = toolResult.content;
        }
      }
      return (
        <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-64 bg-background p-3">
          <pre className="whitespace-pre-wrap break-words text-xs font-mono text-foreground">
            {displayContent || `Skill "${skillName}" loaded`}
          </pre>
        </div>
      );
    }
    default:
      return null;
  }
}
