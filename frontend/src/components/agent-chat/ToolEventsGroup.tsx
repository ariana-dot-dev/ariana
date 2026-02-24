import { memo, useState, useMemo } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatEvent } from '@/bindings/types';
import { getToolSummary, type ToolWithResult } from './tools/ToolSummary';
import { ToolExpandedContent } from './tools/ToolExpandedContent';

// Single tool row
export interface ToolRowProps {
  tool: ToolWithResult;
  isExpanded: boolean;
  onToggle: () => void;
  showConnectorAfter?: boolean;
}

export function ToolRow({ tool, isExpanded, onToggle, showConnectorAfter = false }: ToolRowProps) {
  const summary = getToolSummary(tool);

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center gap-1.5 py-1 px-2 cursor-pointer hover:bg-muted/30 transition-colors rounded"
        onClick={onToggle}
      >
        <div className="flex items-center text-muted-foreground/40">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <div className={cn("h-4 w-4 flex-shrink-0", summary.color)}>
          {summary.icon}
        </div>
        <span className={cn("text-sm font-medium", summary.color)}>
          {summary.title}
        </span>
        {summary.subtitle && (
          <span className="text-sm text-muted-foreground truncate font-mono flex-1 min-w-0">
            {summary.subtitle}
          </span>
        )}
        {summary.badge && (
          <span className="text-xs text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded flex-shrink-0">
            {summary.badge}
          </span>
        )}
        {summary.pending && (
          <div className="w-1.5 h-1.5 rounded-full bg-chart-1 animate-pulse flex-shrink-0" />
        )}
      </div>
      {isExpanded && (
        <div className="ml-5 mt-1 mb-2">
          <ToolExpandedContent toolUse={tool.use} toolResult={tool.result} />
        </div>
      )}
      {showConnectorAfter && !isExpanded && (
        <div className=" ml-9 h-4">
          <div className="h-full bg-muted-foreground/20 w-[var(--border-width)]" />
        </div>
      )}
    </div>
  );
}

// Collapsed group header
interface CollapsedHeaderProps {
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  showConnectorAfter?: boolean;
}

function CollapsedHeader({ count, isExpanded, onToggle, showConnectorAfter = false }: CollapsedHeaderProps) {
  return (
    <div className="flex flex-col">
      <div
        className="flex items-center gap-1.5 py-1 px-2 cursor-pointer hover:bg-muted/30 transition-colors rounded"
        onClick={onToggle}
      >
        <div className="flex items-center text-muted-foreground/40">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
        <span className="text-sm text-muted-foreground">
          {count} previous tool calls
        </span>
      </div>
      {showConnectorAfter && !isExpanded && (
        <div className=" ml-9 h-4">
          <div className="h-full bg-muted-foreground/20 w-[var(--border-width)]" />
        </div>
      )}
    </div>
  );
}

interface ToolEventsGroupProps {
  /** All response events in this consecutive group */
  events: ChatEvent[];
  /** Number of tools to show ungrouped at the end */
  showLastN?: number;
  /** Minimum total tools before grouping kicks in */
  groupThreshold?: number;
}

function ToolEventsGroupComponent({
  events,
  showLastN = 3,
  groupThreshold = 5,
}: ToolEventsGroupProps) {
  const [isGroupExpanded, setIsGroupExpanded] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // Flatten all tools from all events
  const allTools = useMemo(() => {
    const tools: ToolWithResult[] = [];
    for (const event of events) {
      if (event.type === 'response' && event.data.tools) {
        tools.push(...event.data.tools);
      }
    }
    return tools;
  }, [events]);

  // Split into grouped (collapsible) and visible (always shown)
  const { groupedTools, visibleTools } = useMemo(() => {
    if (allTools.length <= groupThreshold) {
      return { groupedTools: [], visibleTools: allTools };
    }
    const groupCount = allTools.length - showLastN;
    return {
      groupedTools: allTools.slice(0, groupCount),
      visibleTools: allTools.slice(groupCount),
    };
  }, [allTools, showLastN, groupThreshold]);

  const toggleTool = (toolId: string) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  };

  if (allTools.length === 0) {
    return null;
  }

  const hasVisibleTools = visibleTools.length > 0;

  return (
    <div className="rounded-lg pl-3 opacity-70 dark:opacity-50 hover:opacity-100">
      {groupedTools.length > 0 && (
        <>
          <CollapsedHeader
            count={groupedTools.length}
            isExpanded={isGroupExpanded}
            onToggle={() => setIsGroupExpanded(!isGroupExpanded)}
            showConnectorAfter={hasVisibleTools}
          />
          {isGroupExpanded && (
            <div className="ml-4 pl-1 my-1">
              {groupedTools.map((tool, i) => (
                <ToolRow
                  key={tool.use.id}
                  tool={tool}
                  isExpanded={expandedTools.has(tool.use.id)}
                  onToggle={() => toggleTool(tool.use.id)}
                  showConnectorAfter={i < groupedTools.length - 1}
                />
              ))}
            </div>
          )}
        </>
      )}
      {visibleTools.map((tool, i) => (
        <ToolRow
          key={tool.use.id}
          tool={tool}
          isExpanded={expandedTools.has(tool.use.id)}
          onToggle={() => toggleTool(tool.use.id)}
          showConnectorAfter={i < visibleTools.length - 1}
        />
      ))}
    </div>
  );
}

export const ToolEventsGroup = memo(ToolEventsGroupComponent, (prevProps, nextProps) => {
  // Only re-render if the actual event IDs or their data changed
  if (prevProps.events.length !== nextProps.events.length) return false;
  if (prevProps.showLastN !== nextProps.showLastN) return false;
  if (prevProps.groupThreshold !== nextProps.groupThreshold) return false;

  // Compare event IDs and their tool counts to detect actual changes
  for (let i = 0; i < prevProps.events.length; i++) {
    const prev = prevProps.events[i];
    const next = nextProps.events[i];
    if (prev.id !== next.id) return false;
    // Check if tools changed (new tool added or tool result updated)
    const prevTools = prev.type === 'response' ? prev.data.tools : undefined;
    const nextTools = next.type === 'response' ? next.data.tools : undefined;
    if (prevTools?.length !== nextTools?.length) return false;
    // Check if any tool result changed (pending -> complete)
    if (prevTools && nextTools) {
      for (let j = 0; j < prevTools.length; j++) {
        if (prevTools[j].result?.content !== nextTools[j].result?.content) return false;
      }
    }
  }
  return true;
});

// Helper to check if event breaks tool grouping
export function breaksToolGroup(event: ChatEvent): boolean {
  if (event.type !== 'response') return true; // Non-response always breaks
  // Response with content (even if it also has tools) breaks the group
  if (event.data.content) return true;
  // Response with no tools breaks
  if (!event.data.tools || event.data.tools.length === 0) return true;
  return false;
}
