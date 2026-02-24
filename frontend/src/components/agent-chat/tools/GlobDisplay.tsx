import { FolderSearch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { GlobResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, CodeViewer, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import Search from '@/components/ui/icons/Search';

interface GlobDisplayProps {
  structuredResult: GlobResult;
}

export function GlobDisplay({ structuredResult }: GlobDisplayProps) {
  const lines = structuredResult.content.split('\n').filter(line => line.trim());

  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader className='flex-row gap-2 items-center'>
        <ToolMetadata label="Pattern" value={structuredResult.glob} mono />
        {structuredResult.path && (
          <ToolMetadata label="in" value={structuredResult.path} />
        )}
        <Badge className="text-xs h-4">
          {lines.length} files
        </Badge>
      </ToolHeader>

      <CodeViewer
        lines={lines.map(line => ({ content: line }))}
      />
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending && lines.length > 0 ? (
    <div className="text-xs text-muted-foreground truncate font-mono">
      {lines[0]}
      {lines.length > 1 && ` ... (+${lines.length - 1} more files)`}
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <Search className="max-h-full max-w-full text-inherit" />
      </div>}
      title="Glob"
      subtitle={structuredResult.glob}
      color="text-chart-1"
      badges={[]}
      pending={structuredResult.pending}
      pendingText="Finding files..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}