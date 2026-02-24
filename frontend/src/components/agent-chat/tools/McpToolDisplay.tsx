import type { GenericToolResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock } from './shared/ToolContentBlock';
import Search from '@/components/ui/icons/Search';
import CloudConnection from '@/components/ui/icons/CloudConnection';

interface McpToolDisplayProps {
  structuredResult: GenericToolResult;
  toolName: string;
  input?: Record<string, unknown>;
}

export function McpToolDisplay({ structuredResult, toolName, input }: McpToolDisplayProps) {
  // Parse mcp__<server>__<tool> format
  const parts = toolName.split('__');
  const mcpToolName = parts[2] || 'tool';
  const isQuery = mcpToolName === 'query';

  // Build title and subtitle
  const title = isQuery ? 'MCP Query' : 'MCP Action';
  let subtitle = '';
  if (isQuery && input?.entity) {
    subtitle = String(input.entity);
  } else if (!isQuery && input?.action) {
    subtitle = String(input.action);
  }

  // Parse and format the output
  let formattedOutput = structuredResult.output;
  let parsedData: unknown = null;
  let isError = false;
  try {
    parsedData = JSON.parse(structuredResult.output);
    formattedOutput = JSON.stringify(parsedData, null, 2);
    // Check if the parsed result indicates an error
    if (typeof parsedData === 'object' && parsedData !== null) {
      const data = parsedData as Record<string, unknown>;
      isError = data.success === false || data.error !== undefined;
    }
  } catch {
    // Keep original output if not valid JSON
    // Non-empty non-JSON output from MCP tools is likely an error message
    isError = !!structuredResult.output?.trim() && !structuredResult.pending;
  }

  // Extract summary info from parsed data
  const badges: string[] = [];
  if (parsedData && typeof parsedData === 'object') {
    const data = parsedData as Record<string, unknown>;
    if (data.success === true) {
      badges.push('Success');
    } else if (data.success === false) {
      badges.push('Failed');
    }
    if (Array.isArray(data.data)) {
      badges.push(`${data.data.length} results`);
    }
  }

  // Determine what to show in expanded content
  const hasOutput = !!structuredResult.output?.trim();
  const expandedContent = (
    <ToolContentBlock>
      <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-96 bg-background">
        {structuredResult.pending ? (
          <div className="p-2 text-xs text-muted-foreground">
            {isQuery ? 'Querying...' : 'Executing action...'}
          </div>
        ) : hasOutput ? (
          <pre className={`p-2 whitespace-pre-wrap break-all text-xs font-mono ${isError ? 'text-destructive' : 'text-foreground'}`}>
            {formattedOutput}
          </pre>
        ) : (
          <div className="p-2 text-xs text-muted-foreground">
            No output returned
          </div>
        )}
      </div>
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending ? (
    hasOutput ? (
      <div className={`text-xs truncate ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
        {structuredResult.output.slice(0, 100)}
        {structuredResult.output.length > 100 && '...'}
      </div>
    ) : (
      <div className="text-xs text-muted-foreground">
        No output returned
      </div>
    )
  ) : null;

  return (
    <BaseToolDisplay
      icon={
        <div className="h-4 w-4">
          {isQuery
            ? <Search className="h-4 w-4 text-inherit" />
            : <CloudConnection className="h-4 w-4 text-inherit" />}
        </div>
      }
      title={title}
      color={isQuery ? 'text-chart-1' : 'text-chart-5'}
      subtitle={subtitle}
      badges={badges}
      pending={structuredResult.pending}
      pendingText={isQuery ? 'Querying...' : 'Executing...'}
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}
