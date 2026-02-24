import { memo } from 'react';
import { ChevronRight, ChevronDown, CheckCircle2 } from 'lucide-react';
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
import FileView from '@/components/ui/icons/FileView';
import FileEdit from '@/components/ui/icons/FileEdit';
import TerminalUse from '@/components/ui/icons/TerminalUse';
import Search from '@/components/ui/icons/Search';
import WebAiUse from '@/components/ui/icons/WebAiUse';
import AiScan from '@/components/ui/icons/AiScan';
import CloudConnection from '@/components/ui/icons/CloudConnection';
import { ToolDisplay } from '../ToolDisplay';

export interface ToolWithResult {
  use: ToolUse;
  result?: ToolResult;
}

interface ToolSummaryInfo {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  badge?: string;
  pending: boolean;
}

function parseToolResult<T>(toolResult?: ToolResult): T | null {
  if (!toolResult?.content) return null;
  try {
    return JSON.parse(toolResult.content) as T;
  } catch {
    return null;
  }
}

export function getToolSummary(tool: ToolWithResult): ToolSummaryInfo {
  const { use: toolUse, result: toolResult } = tool;

  switch (toolUse.name) {
    case 'Read': {
      const result = parseToolResult<FileContentResult>(toolResult);
      return {
        icon: <FileView className="h-4 w-4 text-inherit" />,
        title: 'Read',
        subtitle: result?.fileName || toolUse.input?.file_path || '',
        color: 'text-chart-2',
        badge: result?.totalLines && result.totalLines > 0 ? `${result.totalLines} lines` : undefined,
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'Edit':
    case 'MultiEdit': {
      const result = parseToolResult<FileEditResult>(toolResult);
      return {
        icon: <FileEdit className="h-4 w-4 text-inherit" />,
        title: result?.isMultiEdit ? 'Multi-Edit' : 'Edit',
        subtitle: result?.fileName || toolUse.input?.file_path || '',
        color: 'text-chart-4',
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'Write': {
      const result = parseToolResult<FileWriteResult>(toolResult);
      return {
        icon: <FileEdit className="h-4 w-4 text-inherit" />,
        title: 'Write',
        subtitle: result?.fileName || toolUse.input?.file_path || '',
        color: 'text-chart-4',
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'Bash':
    case 'BashOutput':
    case 'KillShell': {
      const result = parseToolResult<BashOutputResult>(toolResult);
      const command = result?.command || toolUse.input?.command || '';
      const truncatedCmd = command.length > 60 ? command.slice(0, 57) + '...' : command;
      return {
        icon: <TerminalUse className="h-4 w-4 text-inherit" />,
        title: 'Bash',
        subtitle: truncatedCmd,
        color: 'text-chart-3',
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'Grep': {
      const result = parseToolResult<GrepResult>(toolResult);
      const pattern = result?.pattern || toolUse.input?.pattern || '';
      const path = result?.path || toolUse.input?.path || '';
      return {
        icon: <Search className="h-4 w-4 text-inherit" />,
        title: 'Grep',
        subtitle: `"${pattern}"${path ? ` in ${path}` : ''}`,
        color: 'text-chart-1',
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'Glob': {
      const result = parseToolResult<GlobResult>(toolResult);
      const pattern = result?.glob || toolUse.input?.pattern || '';
      const fileCount = result?.content?.split('\n').filter(Boolean).length ?? 0;
      return {
        icon: <Search className="h-4 w-4 text-inherit" />,
        title: 'Glob',
        subtitle: pattern,
        color: 'text-chart-1',
        badge: fileCount > 0 ? `${fileCount} files` : undefined,
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'WebSearch': {
      const result = parseToolResult<WebSearchResult>(toolResult);
      return {
        icon: <WebAiUse className="h-4 w-4 text-inherit" />,
        title: 'WebSearch',
        subtitle: result?.query || toolUse.input?.query || '',
        color: 'text-muted-foreground',
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'WebFetch': {
      const result = parseToolResult<WebFetchResult>(toolResult);
      const url = result?.url || toolUse.input?.url || '';
      const truncatedUrl = url.length > 50 ? url.slice(0, 47) + '...' : url;
      return {
        icon: <WebAiUse className="h-4 w-4 text-inherit" />,
        title: 'WebFetch',
        subtitle: truncatedUrl,
        color: 'text-muted-foreground',
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'Task': {
      const result = parseToolResult<TaskResult>(toolResult);
      return {
        icon: <AiScan className="h-4 w-4 text-inherit" />,
        title: 'Task',
        subtitle: result?.description || toolUse.input?.description || '',
        color: 'text-muted-foreground',
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'TodoWrite': {
      const result = parseToolResult<TodoWriteResult>(toolResult);
      const completed = result?.todos?.filter(t => t.state === 'completed').length ?? 0;
      const total = result?.todos?.length ?? 0;
      return {
        icon: <CheckCircle2 className="h-4 w-4" />,
        title: 'TodoWrite',
        subtitle: total > 0 ? `${completed}/${total} done` : '',
        color: 'text-muted-foreground',
        pending: result?.pending ?? !toolResult,
      };
    }

    case 'Skill': {
      const skillName = (toolUse.input?.skill as string) || 'unknown';
      const args = toolUse.input?.args as string | undefined;
      return {
        icon: <AiScan className="h-4 w-4 text-inherit" />,
        title: 'Skill',
        subtitle: args ? `${skillName} ${args}` : skillName,
        color: 'text-purple-500',
        pending: !toolResult,
      };
    }

    default: {
      // Handle MCP tools (mcp__<server>__<tool>)
      if (toolUse.name.startsWith('mcp__')) {
        const parts = toolUse.name.split('__');
        const serverName = parts[1] || 'mcp';
        const toolName = parts[2] || 'tool';

        // Extract subtitle from input
        let subtitle = '';
        if (toolName === 'query' && toolUse.input?.entity) {
          subtitle = `${toolUse.input.entity}`;
          if (toolUse.input.filters?.length) {
            subtitle += ` (${toolUse.input.filters.length} filters)`;
          }
        } else if (toolName === 'action' && toolUse.input?.action) {
          subtitle = toolUse.input.action;
        }

        const isQuery = toolName === 'query';
        return {
          icon: isQuery
            ? <Search className="h-4 w-4 text-inherit" />
            : <CloudConnection className="h-4 w-4 text-inherit" />,
          title: isQuery ? 'MCP Query' : 'MCP Action',
          subtitle,
          color: isQuery ? 'text-chart-1' : 'text-chart-5',
          pending: !toolResult,
        };
      }

      return {
        icon: <AiScan className="h-4 w-4 text-inherit" />,
        title: toolUse.name,
        subtitle: '',
        color: 'text-muted-foreground',
        pending: !toolResult,
      };
    }
  }
}

interface ToolSummaryRowProps {
  tool: ToolWithResult;
  isExpanded: boolean;
  onToggle: () => void;
  showConnector?: boolean;
}

function ToolSummaryRowComponent({ tool, isExpanded, onToggle, showConnector = true }: ToolSummaryRowProps) {
  const summary = getToolSummary(tool);

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-muted/20 transition-colors rounded px-2 -mx-2"
        onClick={onToggle}
      >
        <div className="flex items-center gap-1.5 text-muted-foreground/50">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </div>

        <div className={cn("h-4 w-4 flex-shrink-0", summary.color)}>
          {summary.icon}
        </div>

        <span className={cn("text-sm font-medium", summary.color)}>
          {summary.title}
        </span>

        {summary.subtitle && (
          <span className="text-sm text-muted-foreground truncate font-mono">
            {summary.subtitle}
          </span>
        )}

        {summary.badge && (
          <span className="text-xs text-muted-foreground/70 bg-muted/50 px-1.5 py-0.5 rounded">
            {summary.badge}
          </span>
        )}

        {summary.pending && (
          <div className="flex items-center gap-1 ml-auto">
            <div className="w-1.5 h-1.5 rounded-full bg-chart-1 animate-pulse" />
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="mt-1 mb-2">
          <ToolDisplay toolUse={tool.use} toolResult={tool.result} />
        </div>
      )}
    </div>
  );
}

export const ToolSummaryRow = memo(ToolSummaryRowComponent);
