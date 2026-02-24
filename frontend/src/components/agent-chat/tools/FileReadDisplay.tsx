import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { FileContentResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, CodeViewer, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import { memo } from 'react';
import FileView from '@/components/ui/icons/FileView';

interface FileReadDisplayProps {
  structuredResult: FileContentResult;
}

function FileReadDisplayComponent({ structuredResult }: FileReadDisplayProps) {
  const badges = structuredResult.totalLines > 0 ? [
    <Badge key="lines" variant="default" className="text-xs h-4">
      {structuredResult.totalLines} lines
    </Badge>
  ] : [];

  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader className='flex-row gap-2 items-center'>
        <Badge variant="default" className="text-xs h-4">
          {structuredResult.language}
        </Badge>
        <ToolMetadata value={structuredResult.filePath} />
      </ToolHeader>

      <CodeViewer
        lines={structuredResult.lines.map(line => ({
          content: line.content,
          number: line.number
        }))}
        filePath={structuredResult.filePath}
      />
    </ToolContentBlock>
  );

  const collapsedPreview = structuredResult.lines.length > 0 ? (
    <div className="text-xs text-muted-foreground truncate font-mono">
      {structuredResult.lines[0]?.content || ''}
      {structuredResult.lines.length > 1 && ` ... (+${structuredResult.lines.length - 1} more lines)`}
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <FileView className="max-h-full max-w-full text-inherit" />
      </div>}
      title="Read"
      color="text-chart-2"
      subtitle={structuredResult.fileName}
      badges={badges}
      pending={structuredResult.pending}
      pendingText="Reading..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}

// Memoize to prevent re-renders when structuredResult hasn't changed
export const FileReadDisplay = memo(FileReadDisplayComponent, (prevProps, nextProps) => {
  const prev = prevProps.structuredResult;
  const next = nextProps.structuredResult;

  return (
    prev.filePath === next.filePath &&
    prev.fileName === next.fileName &&
    prev.language === next.language &&
    prev.totalLines === next.totalLines &&
    prev.pending === next.pending &&
    JSON.stringify(prev.lines) === JSON.stringify(next.lines)
  );
});