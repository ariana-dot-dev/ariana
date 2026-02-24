import { memo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommitInfo } from '@/stores/useDiffsStore';

interface DiffCommitMapProps {
  commits: CommitInfo[];
  selectedShas: Set<string>;
  onToggleCommit: (sha: string) => void;
  onToggleAll: () => void;
}

export const DiffCommitMap = memo(function DiffCommitMap({ commits, selectedShas, onToggleCommit, onToggleAll }: DiffCommitMapProps) {
  const [collapsed, setCollapsed] = useState(false);

  const isNoneSelected = selectedShas.size === 0;

  return (
    <div className="rounded-md border border-border/50 bg-background overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>Filter Commits</span>
          <span className="text-muted-foreground/60">({commits.length})</span>
        </div>
        {!collapsed && (
          <div className="flex items-center" onClick={e => e.stopPropagation()}>
            <button
              onClick={onToggleAll}
              className={cn(
                "text-[10px] transition-colors",
                selectedShas.size > 0 ? "text-accent hover:text-accent/80" : "text-muted-foreground/60 hover:text-foreground"
              )}
            >
              all
            </button>
          </div>
        )}
      </button>

      {/* Commit list */}
      {!collapsed && (
        <div className="px-3 pb-2.5 flex flex-col max-h-[400px] overflow-y-auto">
          {commits.map((commit, index) => {
            const isSelected = selectedShas.has(commit.sha);
            const isLast = index === commits.length - 1;
            const isFirst = index === 0;

            return (
              <button
                key={commit.sha}
                onClick={() => onToggleCommit(commit.sha)}
                className={cn(
                  "flex items-start gap-2.5 text-left group transition-colors rounded px-1 py-0.5 -mx-1",
                  "hover:bg-muted/40",
                  isSelected && "bg-muted/30"
                )}
              >
                {/* Metro line with dot */}
                <div className="flex flex-col items-center flex-shrink-0 pt-[3px]">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full border-[1.5px] flex-shrink-0 transition-colors",
                      isSelected
                        ? "border-accent bg-accent"
                        : isNoneSelected
                        ? "border-muted-foreground/40 bg-muted-foreground/20"
                        : "border-muted-foreground/20 bg-transparent"
                    )}
                  />
                  {!isLast && (
                    <div className={cn(
                      "w-[1.5px] flex-1 min-h-[12px] transition-colors",
                      (isSelected || isNoneSelected) ? "bg-muted-foreground/25" : "bg-muted-foreground/10"
                    )} />
                  )}
                </div>

                {/* Commit info */}
                <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2 py-[1px]">
                  <span className={cn(
                    "text-[11px] truncate transition-colors",
                    isSelected ? "text-foreground" : isNoneSelected ? "text-muted-foreground" : "text-muted-foreground/50"
                  )}>
                    {commit.message.split('\n')[0]}
                    {isFirst && <span className="text-muted-foreground/40 ml-1">(oldest)</span>}
                    {isLast && commits.length > 1 && <span className="text-muted-foreground/40 ml-1">(latest)</span>}
                  </span>
                  <span className="flex-shrink-0 text-[10px] tabular-nums whitespace-nowrap">
                    {commit.additions > 0 && (
                      <span className="text-constructive-foreground">+{commit.additions}</span>
                    )}
                    {commit.additions > 0 && commit.deletions > 0 && <span className="text-muted-foreground/30 mx-0.5"> </span>}
                    {commit.deletions > 0 && (
                      <span className="text-destructive-foreground">-{commit.deletions}</span>
                    )}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
