import { Badge } from '@/components/ui/badge';
import type { GrepResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, CodeViewer, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import Search from '@/components/ui/icons/Search';

interface GrepDisplayProps {
  structuredResult: GrepResult;
}

export function GrepDisplay({ structuredResult }: GrepDisplayProps) {
  const badges = [];

  if (structuredResult.glob) {
    badges.push(
      <Badge key="glob" variant="outline" className="text-xs h-4">
        {structuredResult.glob}
      </Badge>
    );
  }

  const lines = structuredResult.content.split('\n').filter(line => line.trim());

  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader className='flex-row gap-2 items-center'>
        <ToolMetadata label="Pattern" value={structuredResult.pattern} mono />
        {structuredResult.path && (
          <ToolMetadata label="in" value={structuredResult.path} />
        )}
      </ToolHeader>

      <CodeViewer
        lines={lines.map(line => ({ content: line }))}
      />
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending && lines.length > 0 ? (
    <div className="text-xs text-muted-foreground truncate font-mono">
      {lines[0]}
      {lines.length > 1 && ` ... (+${lines.length - 1} more matches)`}
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <Search className="max-h-full max-w-full text-inherit" />
      </div>}
      title="Grep"
      color="text-chart-1"
      subtitle={structuredResult.pattern}
      badges={badges}
      pending={structuredResult.pending}
      pendingText="Searching..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}