import { Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BashOutputResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import TerminalUse from '@/components/ui/icons/TerminalUse';

interface BashDisplayProps {
  structuredResult: BashOutputResult;
}

function formatDirectoryLine(line: string) {
  if (line.startsWith('total ')) {
    return { type: 'header' as const, content: line };
  }

  if (line.match(/^[d-][rwx-]{9}/)) {
    // Parse directory listing line
    const permissions = (line ?? '').split(/\s+/)[0];
    const isDirectory = permissions.startsWith('d');

    return {
      type: 'file' as const,
      content: line,
      isDirectory
    };
  }

  return { type: 'normal' as const, content: line };
}

export function BashDisplay({ structuredResult }: BashDisplayProps) {
  const outputLines = (structuredResult.content ?? '').split('\n');
  const isDirectoryListing = (structuredResult.content ?? '').includes('total ') && (structuredResult.content ?? '').includes('drwx');

  const formattedOutput = isDirectoryListing
    ? outputLines.map(formatDirectoryLine)
    : outputLines.map(line => ({ type: 'normal' as const, content: line }));

  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader>
        {structuredResult.description && (
          <ToolMetadata value={`(${structuredResult.description})`} />
        )}
        <div className="flex items-center gap-2">
        {structuredResult.error ? (
          <Badge variant="destructive" className="text-xs h-4">
            Error
          </Badge>
        ) : (
          <Badge className="text-xs h-4">
            Success
          </Badge>
        )}
        <ToolMetadata value={`$ ${structuredResult.command}`} mono />
        </div>
      </ToolHeader>

      <div className={cn(
        "rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-96 bg-background",
        structuredResult.error && "bg-destructive/10 text-destructive-foreground"
      )}>
        {formattedOutput.map((line, index) => (
          <div
            key={index}
            className={cn(
              "flex hover:bg-muted/30 transition-colors last:border-b-0",
              line.type === 'header' && "font-medium bg-muted/20",
              line.type === 'file' && line.isDirectory && "font-medium"
            )}
          >
            <div className="w-12 flex-shrink-0 text-right px-2 py-0.5 text-xs text-muted-foreground/50 bg-background-darker select-none font-mono">
              {index + 1}
            </div>
            <div className="flex-1 px-2 py-0.5 font-mono text-xs">
              <span className="whitespace-pre-wrap break-all">
                {line.content}
              </span>
            </div>
          </div>
        ))}
      </div>
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending && outputLines.length > 0 ? (
    <div className={cn(
      "text-xs truncate font-mono",
      structuredResult.error ? "text-destructive-foreground" : "text-muted-foreground"
    )}>
      {formattedOutput[0]?.content || ''}
      {outputLines.length > 1 && ` ... (+${outputLines.length - 1} more lines)`}
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <TerminalUse className="max-h-full max-w-full text-inherit" />
      </div>}
      title="Bash"
      color="text-chart-3"
      subtitle={structuredResult.command}
      badges={[]}
      pending={structuredResult.pending}
      pendingText="Running..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}