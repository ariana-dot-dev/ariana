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
  GenericToolResult
} from '@/bindings/types';
import { FileReadDisplay } from './tools/FileReadDisplay';
import { FileEditDisplay } from './tools/FileEditDisplay';
import { FileWriteDisplay } from './tools/FileWriteDisplay';
import { BashDisplay } from './tools/BashDisplay';
import { WebSearchDisplay } from './tools/WebSearchDisplay';
import { WebFetchDisplay } from './tools/WebFetchDisplay';
import { TaskDisplay } from './tools/TaskDisplay';
import { TodoWriteDisplay } from './tools/TodoWriteDisplay';
import { GenericToolDisplay } from './tools/GenericToolDisplay';
import { McpToolDisplay } from './tools/McpToolDisplay';
import { GrepDisplay } from './tools/GrepDisplay';
import { GlobDisplay } from './tools/GlobDisplay';
import { SkillDisplay } from './tools/SkillDisplay';

interface ToolDisplayProps {
  toolUse: ToolUse;
  toolResult?: ToolResult;
}

// Helper function to parse structured tool result from JSON
function parseToolResult<T>(toolResult?: ToolResult): T | null {
  if (!toolResult?.content) return null;
  try {
    return JSON.parse(toolResult.content) as T;
  } catch {
    return null;
  }
}

export function ToolDisplay({ toolUse, toolResult }: ToolDisplayProps) {
  // Route to specialized components based on tool type
  switch (toolUse.name) {
    case 'Read': {
      const structuredResult = parseToolResult<FileContentResult>(toolResult);
      return structuredResult ? <FileReadDisplay structuredResult={structuredResult} /> : null;
    }

    case 'Edit':
    case 'MultiEdit': {
      const structuredResult = parseToolResult<FileEditResult>(toolResult);
      return structuredResult ? <FileEditDisplay structuredResult={structuredResult} /> : null;
    }

    case 'Write': {
      const structuredResult = parseToolResult<FileWriteResult>(toolResult);
      return structuredResult ? <FileWriteDisplay structuredResult={structuredResult} /> : null;
    }

    case 'Bash':
    case 'BashOutput':
    case 'KillShell': {
      const structuredResult = parseToolResult<BashOutputResult>(toolResult);
      return structuredResult ? <BashDisplay structuredResult={structuredResult} /> : null;
    }

    case 'Grep': {
      const structuredResult = parseToolResult<GrepResult>(toolResult);
      return structuredResult ? <GrepDisplay structuredResult={structuredResult} /> : null;
    }

    case 'Glob': {
      const structuredResult = parseToolResult<GlobResult>(toolResult);
      return structuredResult ? <GlobDisplay structuredResult={structuredResult} /> : null;
    }

    case 'WebSearch': {
      const structuredResult = parseToolResult<WebSearchResult>(toolResult);
      return structuredResult ? <WebSearchDisplay structuredResult={structuredResult} /> : null;
    }

    case 'WebFetch': {
      const structuredResult = parseToolResult<WebFetchResult>(toolResult);
      return structuredResult ? <WebFetchDisplay structuredResult={structuredResult} /> : null;
    }

    case 'Task': {
      const structuredResult = parseToolResult<TaskResult>(toolResult);
      return structuredResult ? <TaskDisplay structuredResult={structuredResult} /> : null;
    }

    case 'TodoWrite': {
      const structuredResult = parseToolResult<TodoWriteResult>(toolResult);
      return structuredResult ? <TodoWriteDisplay structuredResult={structuredResult} /> : null;
    }

    case 'Skill': {
      const skillName = (toolUse.input as Record<string, unknown>)?.skill as string || 'unknown';
      return (
        <SkillDisplay
          skillName={skillName}
          input={toolUse.input as Record<string, unknown>}
          toolResult={toolResult}
        />
      );
    }

    default: {
      // Handle MCP tools (mcp__<server>__<tool>)
      if (toolUse.name.startsWith('mcp__')) {
        const structuredResult = parseToolResult<GenericToolResult>(toolResult);
        // Create fallback result for pending state or raw content
        const fallbackResult: GenericToolResult = !structuredResult ? {
          type: 'generic_tool',
          pending: !toolResult,
          toolName: toolUse.name,
          output: toolResult?.content || ''
        } : structuredResult;
        return (
          <McpToolDisplay
            structuredResult={fallbackResult}
            toolName={toolUse.name}
            input={toolUse.input}
          />
        );
      }

      const structuredResult = parseToolResult<GenericToolResult>(toolResult);
      return structuredResult ? <GenericToolDisplay structuredResult={structuredResult} /> : null;
    }
  }
}