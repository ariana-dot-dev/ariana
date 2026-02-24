import { Globe } from 'lucide-react';
import type { WebSearchResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import WebAiUse from '@/components/ui/icons/WebAiUse';

interface WebSearchDisplayProps {
  structuredResult: WebSearchResult;
}

export function WebSearchDisplay({ structuredResult }: WebSearchDisplayProps) {
  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader>
        <ToolMetadata label="Query" value={structuredResult.query} mono />
      </ToolHeader>

      <div className="rounded-md border-(length:--border-width) border-background/50 overflow-auto max-h-96 bg-background">
        <pre className="p-2 whitespace-pre-wrap break-all text-xs font-mono text-foreground">
          {structuredResult.content}
        </pre>
      </div>
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending && structuredResult.content ? (
    <div className="text-xs text-muted-foreground truncate font-mono">
      Search results for "{structuredResult.query}"
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <WebAiUse className="max-h-full max-w-full text-inherit" />
      </div>}
      title="WebSearch"
      color="text-muted-foreground"
      subtitle={structuredResult.query}
      badges={[]}
      pending={structuredResult.pending}
      pendingText="Searching..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}