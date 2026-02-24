import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { FileWriteResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, CodeViewer, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import { memo } from 'react';
import FileEdit from '@/components/ui/icons/FileEdit';

interface FileWriteDisplayProps {
  structuredResult: FileWriteResult;
}

function FileWriteDisplayComponent({ structuredResult }: FileWriteDisplayProps) {
  const lines = structuredResult.content.split('\n');

  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader className='flex-row gap-2 items-center'>
        <Badge className="text-xs h-4">
          Created
        </Badge>
        <ToolMetadata value={structuredResult.filePath} />
      </ToolHeader>

      <CodeViewer
        lines={lines.map(line => ({ content: line }))}
        filePath={structuredResult.filePath}
      />

      <div className="mt-2 text-xs text-muted-foreground">
        ✓ File successfully created
      </div>
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending && lines.length > 0 ? (
    <div className="text-xs text-muted-foreground">
      ✓ File created • {lines.length} lines
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <FileEdit className="max-h-full max-w-full text-inherit" />
      </div>}
      title="Write"
      subtitle={structuredResult.fileName}
      color="text-chart-4"
      badges={[]}
      pending={structuredResult.pending}
      pendingText="Writing..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}

// Memoize to prevent re-renders when structuredResult hasn't changed
export const FileWriteDisplay = memo(FileWriteDisplayComponent, (prevProps, nextProps) => {
  const prev = prevProps.structuredResult;
  const next = nextProps.structuredResult;

  return (
    prev.filePath === next.filePath &&
    prev.fileName === next.fileName &&
    prev.content === next.content &&
    prev.pending === next.pending
  );
});