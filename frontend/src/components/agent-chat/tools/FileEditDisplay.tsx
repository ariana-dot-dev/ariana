import { useMemo } from 'react';
import type { FileEditResult } from '@/bindings/types';
import { BaseToolDisplay } from './BaseToolDisplay';
import { ToolContentBlock, ToolHeader, ToolMetadata } from './shared/ToolContentBlock';
import * as Diff from 'diff';
import { useInlineDiffTheme } from '@/lib/diffsTheme';
import { PatchDiff } from '@pierre/diffs/react';
import FileEdit from '@/components/ui/icons/FileEdit';

interface FileEditDisplayProps {
  structuredResult: FileEditResult;
}

export function FileEditDisplay({ structuredResult }: FileEditDisplayProps) {
  const { styles, options } = useInlineDiffTheme();

  const patchString = useMemo(() => {
    if (structuredResult.pending) return '';
    return Diff.createPatch(
      structuredResult.filePath,
      structuredResult.oldString,
      structuredResult.newString,
    );
  }, [structuredResult.pending, structuredResult.filePath, structuredResult.oldString, structuredResult.newString]);

  const changeCount = useMemo(() => {
    if (!patchString) return 0;
    return patchString.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length;
  }, [patchString]);

  const renderDiff = (maxHeight?: string) => patchString && (
    <div
      className="rounded-md border-(length:--border-width) border-background/50 overflow-auto bg-background"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <PatchDiff
        patch={patchString}
        options={options}
        style={styles}
      />
    </div>
  );

  const expandedContent = (
    <ToolContentBlock>
      <ToolHeader className='flex-row gap-2 items-center'>
        <ToolMetadata value={structuredResult.filePath} />
      </ToolHeader>
      {renderDiff()}
    </ToolContentBlock>
  );

  const collapsedPreview = !structuredResult.pending ? (
    <div className="flex flex-col gap-2">
      {renderDiff('30rem')}
      <div className="text-xs text-muted-foreground">
        ✓ File updated • {changeCount} changes
      </div>
    </div>
  ) : null;

  return (
    <BaseToolDisplay
      icon={<div className='h-4 w-4'>
        <FileEdit className="max-h-full max-w-full text-inherit" />
      </div>}
      title={structuredResult.isMultiEdit ? 'Multi-Edit' : 'Edit'}
      subtitle={structuredResult.fileName}
      color="text-chart-4"
      badges={[]}
      pending={structuredResult.pending}
      pendingText="Editing..."
      expandedContent={expandedContent}
      collapsedPreview={collapsedPreview}
    />
  );
}
