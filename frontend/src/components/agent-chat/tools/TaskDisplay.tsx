import { BookAlert, BookCheck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { TaskResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import AiScan from '@/components/ui/icons/AiScan';

interface TaskDisplayProps {
  structuredResult: TaskResult;
}

export function TaskDisplay({ structuredResult }: TaskDisplayProps) {

  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader>
        <ToolMetadata label="Description" value={structuredResult.description} />
      </ToolHeader>

      {structuredResult.prompt && (
        <div className="mb-2 p-2 bg-muted/20 rounded border">
          <div className="text-xs font-medium text-foreground mb-1">Prompt:</div>
          <div className="text-xs text-muted-foreground whitespace-pre-wrap">
            {structuredResult.prompt}
          </div>
        </div>
      )}

      {structuredResult.result && (
        <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-96 bg-background">
          <div className="p-2">
            <div className="text-xs font-medium text-foreground mb-1">Result:</div>
            <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">
              {structuredResult.result}
            </pre>
          </div>
        </div>
      )}
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending ? (
    <div className="text-xs text-muted-foreground truncate">
      {structuredResult.subagentType}: {structuredResult.description}
      {structuredResult.result && ' - completed'}
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='w-4 h-4'><AiScan className="max-h-full max-w-full text-inherit" /></div>}
      title="Task"
      color="text-muted-foreground"
      subtitle={structuredResult.description}
      badges={[]}
      pending={structuredResult.pending}
      pendingText="Running..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}