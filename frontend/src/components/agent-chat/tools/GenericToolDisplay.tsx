import { Settings } from 'lucide-react';
import type { GenericToolResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock } from './shared/ToolContentBlock';
import Developer from '@/components/ui/icons/Developer';

interface GenericToolDisplayProps {
  structuredResult: GenericToolResult;
}

export function GenericToolDisplay({ structuredResult }: GenericToolDisplayProps) {
  const expandedContent = (
    <ToolContentBlock>
      <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-96 bg-background">
        <pre className="p-2 whitespace-pre-wrap break-all text-xs font-mono text-foreground">
          {structuredResult.output}
        </pre>
      </div>
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending && structuredResult.output ? (
    <div className="text-xs text-muted-foreground truncate">
      {structuredResult.output.slice(0, 100)}
      {structuredResult.output.length > 100 && '...'}
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <Developer className="max-h-full max-w-full text-inherit" />
      </div>}
      title={structuredResult.toolName}
      color="text-muted-foreground"
      subtitle=""
      badges={[]}
      pending={structuredResult.pending}
      pendingText="Processing..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}

