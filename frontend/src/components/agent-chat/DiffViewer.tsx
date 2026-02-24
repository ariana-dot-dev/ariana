import { memo, useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useFullDiffTheme } from '@/lib/diffsTheme';
import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type { FileDiffMetadata, DiffLineAnnotation, Hunk, ContextContent, ChangeContent } from '@pierre/diffs';
import SendPlane from '../ui/icons/SendPlane';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

const MAX_VISIBLE_LINES = 15;

interface DiffViewerProps {
  diff: string;
  className?: string;
  sendPrompt?: (prompt: string, model?: 'opus' | 'sonnet' | 'haiku') => Promise<boolean>;
  interruptAgent?: () => Promise<void>;
  canInterrupt?: boolean;
  canSendPrompts?: boolean;
}

interface ActiveComment {
  fileIndex: number;
  fileName: string;
  lineNumber: number;
  side: 'deletions' | 'additions';
}

/** Extract the unified diff section for a single file from the full multi-file diff */
function extractFileDiff(fullDiff: string, fileName: string): string {
  const sections = fullDiff.split(/(?=^diff --git )/m);
  for (const section of sections) {
    if (section.includes(`b/${fileName}`) || section.includes(`a/${fileName}`)) {
      return section.trim();
    }
  }
  return '';
}

/** Count total visible lines in a FileDiffMetadata */
function countDiffLines(file: FileDiffMetadata): number {
  let count = 0;
  for (const hunk of file.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        count += content.lines.length;
      } else {
        count += content.deletions.length + content.additions.length;
      }
    }
  }
  return count;
}

/** Truncate a FileDiffMetadata's hunks to maxLines visible lines */
function truncateFileDiff(file: FileDiffMetadata, maxLines: number): FileDiffMetadata {
  let remaining = maxLines;
  const truncatedHunks: Hunk[] = [];

  for (const hunk of file.hunks) {
    if (remaining <= 0) break;

    const truncatedContent: (ContextContent | ChangeContent)[] = [];

    for (const content of hunk.hunkContent) {
      if (remaining <= 0) break;

      if (content.type === 'context') {
        if (content.lines.length <= remaining) {
          truncatedContent.push(content);
          remaining -= content.lines.length;
        } else {
          truncatedContent.push({
            ...content,
            lines: content.lines.slice(0, remaining),
          });
          remaining = 0;
        }
      } else {
        // change type
        const totalLines = content.deletions.length + content.additions.length;
        if (totalLines <= remaining) {
          truncatedContent.push(content);
          remaining -= totalLines;
        } else {
          // Truncate deletions first, then additions
          const delLines = Math.min(content.deletions.length, remaining);
          remaining -= delLines;
          const addLines = Math.min(content.additions.length, remaining);
          remaining -= addLines;
          truncatedContent.push({
            ...content,
            deletions: content.deletions.slice(0, delLines),
            additions: content.additions.slice(0, addLines),
          });
        }
      }
    }

    if (truncatedContent.length > 0) {
      // Recalculate hunk counts
      let splitCount = 0;
      let unifiedCount = 0;
      let addCount = 0;
      let delCount = 0;
      for (const c of truncatedContent) {
        if (c.type === 'context') {
          splitCount += c.lines.length;
          unifiedCount += c.lines.length;
        } else {
          splitCount += Math.max(c.deletions.length, c.additions.length);
          unifiedCount += c.deletions.length + c.additions.length;
          addCount += c.additions.length;
          delCount += c.deletions.length;
        }
      }

      truncatedHunks.push({
        ...hunk,
        hunkContent: truncatedContent,
        splitLineCount: splitCount,
        unifiedLineCount: unifiedCount,
        additionCount: addCount,
        additionLines: addCount,
        deletionCount: delCount,
        deletionLines: delCount,
      });
    }
  }

  // Recalculate file-level counts
  let totalSplit = 0;
  let totalUnified = 0;
  for (const h of truncatedHunks) {
    totalSplit += h.splitLineCount;
    totalUnified += h.unifiedLineCount;
  }

  return {
    ...file,
    hunks: truncatedHunks,
    splitLineCount: totalSplit,
    unifiedLineCount: totalUnified,
  };
}

function InlineDiffPrompt({
  fileName,
  lineNumber,
  fileDiffText,
  onSend,
  onCancel,
  canSend,
}: {
  fileName: string;
  lineNumber: number;
  fileDiffText: string;
  onSend: (prompt: string) => Promise<void>;
  onCancel: () => void;
  canSend: boolean;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [text]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const contextPrefix = `[File: ${fileName}, Line: ${lineNumber}]\n\`\`\`diff\n${fileDiffText}\n\`\`\`\n\n`;
      await onSend(contextPrefix + text.trim());
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="my-1 rounded-lg bg-background border-(length:--border-width) border-foreground/10 p-3 shadow-sm">
      <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
        <span className="font-mono">{fileName}:{lineNumber}</span>
      </div>
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Comment on this line..."
          rows={1}
          disabled={sending}
          className={cn(
            "flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50",
            "outline-none border-none focus:ring-0 min-h-[1.5rem] max-h-40 overflow-y-auto"
          )}
        />
        <div className="flex items-end gap-1">
          <Button
            variant="transparent"
            size="sm"
            onClick={onCancel}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSend}
            disabled={!text.trim() || sending || !canSend}
            className="h-7 px-2 text-xs flex items-center gap-1"
          >
            <SendPlane className="!min-h-3.5 !min-w-3.5 text-inherit" />
            send
          </Button>
        </div>
      </div>
    </div>
  );
}

interface FileDiffBlockProps {
  file: FileDiffMetadata;
  fileIndex: number;
  activeComment: ActiveComment | null;
  onLineClick: (fileIndex: number, fileName: string, lineNumber: number, side: 'deletions' | 'additions') => void;
  getDiff: () => string;
  onSendComment: (prompt: string) => Promise<void>;
  onCancelComment: () => void;
  canSendPrompts: boolean;
  styles: React.CSSProperties;
  options: Record<string, unknown>;
}

const FileDiffBlock = memo(function FileDiffBlock({
  file,
  fileIndex,
  activeComment,
  onLineClick,
  getDiff,
  onSendComment,
  onCancelComment,
  canSendPrompts,
  styles,
  options,
}: FileDiffBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const totalLines = useMemo(() => countDiffLines(file), [file]);
  const isTruncatable = totalLines > MAX_VISIBLE_LINES;

  const displayFile = useMemo(() => {
    if (!isTruncatable || expanded) return file;
    return truncateFileDiff(file, MAX_VISIBLE_LINES);
  }, [file, isTruncatable, expanded]);

  const handleLineClick = useCallback((props: { lineNumber: number; annotationSide: 'deletions' | 'additions' }) => {
    onLineClick(fileIndex, file.name, props.lineNumber, props.annotationSide);
  }, [fileIndex, file.name, onLineClick]);

  const isCommentActive = activeComment?.fileIndex === fileIndex;

  const fileDiffText = useMemo(() => {
    if (!isCommentActive) return '';
    return extractFileDiff(getDiff(), file.name);
  }, [isCommentActive, getDiff, file.name]);

  const mergedOptions = useMemo(() => ({
    ...options,
    onLineClick: canSendPrompts ? handleLineClick : undefined,
  }), [options, canSendPrompts, handleLineClick]);

  const lineAnnotations = useMemo<DiffLineAnnotation[] | undefined>(() => {
    if (!isCommentActive || !activeComment) return undefined;
    return [{ side: activeComment.side, lineNumber: activeComment.lineNumber }];
  }, [isCommentActive, activeComment]);

  const renderAnnotation = useCallback(() => {
    if (!activeComment) return null;
    return (
      <InlineDiffPrompt
        fileName={activeComment.fileName}
        lineNumber={activeComment.lineNumber}
        fileDiffText={fileDiffText}
        onSend={onSendComment}
        onCancel={onCancelComment}
        canSend={canSendPrompts}
      />
    );
  }, [activeComment, fileDiffText, onSendComment, onCancelComment, canSendPrompts]);

  return (
    <div className="relative">
      <FileDiff
        fileDiff={displayFile}
        options={mergedOptions}
        style={styles}
        lineAnnotations={lineAnnotations}
        renderAnnotation={isCommentActive ? renderAnnotation : undefined}
      />
      {isTruncatable && (
        <button
          onClick={() => setExpanded(prev => !prev)}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground",
            "transition-colors border-t border-border/30 bg-background-darker/50 hover:bg-muted/30",
            "rounded-b-md -mt-[1px]"
          )}
        >
          {expanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              show {totalLines - MAX_VISIBLE_LINES} more lines
            </>
          )}
        </button>
      )}
    </div>
  );
});

/** Estimated height per diff line for placeholder sizing */
const ESTIMATED_LINE_HEIGHT = 20;
const PLACEHOLDER_MIN_HEIGHT = 60;

/** Lazy wrapper: only mounts the real FileDiffBlock when near the viewport */
const LazyFileDiffBlock = memo(function LazyFileDiffBlock(props: FileDiffBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' } // start rendering 400px before entering viewport
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!visible) {
    // Placeholder with estimated height based on line count
    const lineCount = countDiffLines(props.file);
    const displayLines = Math.min(lineCount, MAX_VISIBLE_LINES);
    const estimatedHeight = Math.max(PLACEHOLDER_MIN_HEIGHT, displayLines * ESTIMATED_LINE_HEIGHT + 40);

    return (
      <div
        ref={containerRef}
        style={{ height: `${estimatedHeight}px` }}
        className="rounded-md border border-border/30 bg-background-darker/30 flex items-center justify-center"
      >
        <span className="text-[11px] text-muted-foreground/40">{props.file.name}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <FileDiffBlock {...props} />
    </div>
  );
});

export function DiffViewer({
  diff,
  className,
  sendPrompt,
  interruptAgent,
  canInterrupt,
  canSendPrompts,
}: DiffViewerProps) {
  const { styles, options } = useFullDiffTheme();
  const [activeComment, setActiveComment] = useState<ActiveComment | null>(null);
  const activeCommentRef = useRef(activeComment);
  activeCommentRef.current = activeComment;

  // Keep diff in a ref so FileDiffBlock can access it without it being a prop dependency
  const diffRef = useRef(diff);
  diffRef.current = diff;

  const files = useMemo(() => {
    if (!diff || diff.trim() === '') return [];
    const patches = parsePatchFiles(diff);
    return patches.flatMap(p => p.files);
  }, [diff]);

  const handleLineClick = useCallback((
    fileIndex: number,
    fileName: string,
    lineNumber: number,
    side: 'deletions' | 'additions',
  ) => {
    const current = activeCommentRef.current;
    if (
      current?.fileIndex === fileIndex &&
      current?.lineNumber === lineNumber &&
      current?.side === side
    ) {
      setActiveComment(null);
    } else {
      setActiveComment({ fileIndex, fileName, lineNumber, side });
    }
  }, []);

  const handleSendComment = useCallback(async (prompt: string) => {
    if (!sendPrompt) return;
    if (canInterrupt && interruptAgent) {
      await interruptAgent();
    }
    await sendPrompt(prompt);
    setActiveComment(null);
  }, [sendPrompt, canInterrupt, interruptAgent]);

  const handleCancelComment = useCallback(() => {
    setActiveComment(null);
  }, []);

  // Stable getter for the full diff — avoids passing the huge string as a prop
  const getDiff = useCallback(() => diffRef.current, []);

  if (files.length === 0) {
    return (
      <div className={cn('flex flex-col justify-center py-12 mx-auto gap-6 text-muted-foreground text-sm', className)}>
        <div className='font-medium'>
          No committed changes yet.
        </div>
        <div>Agent will auto-commit before stopping. <br /> If a PR is open, he'll also auto-push.</div>
        <div className='text-muted-foreground/80'><i>Did you know that the agent can push, open PRs, triage issues for you? <br /> Ask him to do stuff on your GitHub!</i></div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3 w-full', className)}>
      {files.map((file, index) => (
        <LazyFileDiffBlock
          key={`${file.name}-${index}`}
          file={file}
          fileIndex={index}
          activeComment={activeComment?.fileIndex === index ? activeComment : null}
          onLineClick={handleLineClick}
          getDiff={getDiff}
          onSendComment={handleSendComment}
          onCancelComment={handleCancelComment}
          canSendPrompts={canSendPrompts ?? false}
          styles={styles}
          options={options}
        />
      ))}
    </div>
  );
}
