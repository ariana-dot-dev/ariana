import { Globe } from 'lucide-react';
import type { WebFetchResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import WebAiUse from '@/components/ui/icons/WebAiUse';

interface WebFetchDisplayProps {
  structuredResult: WebFetchResult;
}

export function WebFetchDisplay({ structuredResult }: WebFetchDisplayProps) {
  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader>
        <ToolMetadata label="URL" value={structuredResult.url} mono />
        <ToolMetadata label="Prompt" value={structuredResult.prompt} />
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
      Fetched from {structuredResult.url}
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <WebAiUse className="max-h-full max-w-full text-inherit" />
      </div>}
      title="WebFetch"
      color="text-muted-foreground"
      subtitle={structuredResult.url}
      badges={[]}
      pending={structuredResult.pending}
      pendingText="Fetching..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}