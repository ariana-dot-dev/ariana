import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useFocusedVault } from '../hooks/useFocusedVault';
import { requestHighlight } from '../lib/highlight';
import { useConstructionTree } from '../hooks/useConstructionTree';
import { ConstructionTraceTree } from '../bindings/ConstructionTraceTree';
import { getRelativePath } from '../utils/pathUtils';
import { useWorkspaceRoots } from '../hooks/useWorkspaceRoots';
import { Timestamp } from '../bindings/Timestamp';
import { useTheme } from '../hooks/useTheme';

function resolveTimestamp(timeline: { min_ts: number; max_ts: number; }, timestamp: Timestamp, isStart: boolean): number {
  if (timestamp === 'Unknown') {
    return isStart ? timeline.min_ts : timeline.max_ts;
  }
  return timestamp.Known;
}

const SpanComponent: React.FC<{
  timeline: Timeline;
  spanId: string;
  containerWidth: number;
  hoveredSpan: string | null;
  onHover: (spanId: string) => void;
}> = ({ timeline, spanId, containerWidth, hoveredSpan, onHover }) => {
  const span = timeline.spans[spanId];
  if (!span) {
    return null;
  }

  const startTimestamp = resolveTimestamp(timeline, span.start, true);
  const endTimestamp = resolveTimestamp(timeline, span.end, false);

  const timelineStartPos = timeline.timestampsToTimelinePosition.get(startTimestamp) ?? -1;
  let timelineEndPos = timeline.timestampsToTimelinePosition.get(endTimestamp) ?? -1;

  if (timelineStartPos === -1 || timelineEndPos === -1) {
    return null;
  }

  if (timelineStartPos === timelineEndPos) {
    timelineEndPos = Math.min(timelineEndPos + 1, timeline.timestampsToTimelinePosition.size - 1);
  }

  const spanLeft = (timelineStartPos / timeline.timestampsToTimelinePosition.size) * containerWidth;
  const spanWidth = Math.max(
    2,
    ((timelineEndPos - timelineStartPos + 1) / timeline.timestampsToTimelinePosition.size) * containerWidth
  );

  const traces = timeline.spansToTraces.get(spanId);
  if (!traces) {
    return null;
  }

  const enterTrace = timeline.traces.items[traces.enter];

  const startPosition = enterTrace.start_pos;
  const endPosition = enterTrace.end_pos;

  return (
      <div
        key={spanId}
        className={cn(
          'absolute top-1/2 -translate-y-1/2 h-16 bg-[var(--info-muted)] cursor-pointer rounded-md',
          span.is_error && 'bg-[var(--error-muted)]',
          hoveredSpan === spanId && (
            span.is_error ? 'bg-[var(--error-base)] border-2 border-[var(--bg-base)] outline-2 outline-[var(--error-muted)]' : 'bg-[var(--info-base)] border-2 border-[var(--bg-base)] outline-2 outline-[var(--info-muted)]'
          )
        )}
        style={{
          left: `${spanLeft}px`,
          width: `${spanWidth}px`,
        }}
        // title={`${startPosition.filepath}:${startPosition.line}:${startPosition.column} - ${endPosition.filepath}:${endPosition.line}:${endPosition.column}. ${timelineStartPos} - ${timelineEndPos} ${startTimestamp} - ${endTimestamp}`}
        onMouseEnter={() => {
          requestHighlight(startPosition.filepath, startPosition.line, startPosition.column, endPosition.line, endPosition.column);
          onHover(spanId);
        }}
      />
  );
};

const FamilyComponent: React.FC<{
  timeline: Timeline;
  familyId: string;
  containerWidth: number;
}> = ({ timeline, familyId, containerWidth }) => {
  const [hoveredSpan, setHoveredSpan] = useState<string | null>(null);

  const spans = timeline.familiesToSpans.get(familyId);
  if (!spans || spans.size === 0) {
    return null;
  }

  return (
    <div className="flex flex-col w-full"
    onMouseEnter={() => setHoveredSpan(null)}
    onMouseLeave={() => setHoveredSpan(null)}
    >
      <div 
        className='relative min-h-20 h-20 w-full'
      >
        {spans.values().map((spanId, index) => (
          <SpanComponent
            key={index}
            timeline={timeline}
            spanId={spanId}
            containerWidth={containerWidth}
            hoveredSpan={hoveredSpan}
            onHover={setHoveredSpan}
          />
        ))}
      </div>
      {hoveredSpan && (() => {
        const span = timeline.spans[hoveredSpan];
        const subTimeline = {
          ...timeline,
          displayedFamilies: new Set([timeline.familiesToSpans.get(span.trace_id) ? span.trace_id : null, span.indirect_children_family?.[0] || null].filter((f) => f !== null)),
        };

        if (subTimeline.displayedFamilies.size === 0) {
          return null;
        }

        return (
          <div className="w-full border-2 border-[var(--bg-450)] shadow-lg rounded-xl overflow-hidden">
            <TimelineComp timeline={subTimeline} />
          </div>
        );
      })()}
    </div>
  );
};

const TimelineCluster: React.FC<{
  timeline: Timeline;
  filepath: string;
  familyIds: string[];
}> = ({ timeline, filepath, familyIds }) => {
  const [clusterExpanded, setClusterExpanded] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(0);
  const workspaceRoots = useWorkspaceRoots();
  const { isDark } = useTheme();

  useEffect(() => {
    const updateWidth = () => {
      if (ref.current) {
        setWidth(ref.current.getBoundingClientRect().width);
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  return (
    <div className="flex flex-col w-full max-w-full">
      {/* <button
        disabled
        onClick={() => setClusterExpanded(!clusterExpanded)}
        className={cn(
          "flex px-1.5 py-0.5 sticky top-0 z-10",
          isDark ? "bg-[var(--bg-400)]" : "bg-[var(--bg-550)]"
        )}
      >
        {getRelativePath(filepath, workspaceRoots)}
      </button> */}
      {clusterExpanded && (
        <div className="flex flex-col w-full p-3">
          <div className="w-full h-0" ref={ref}></div>
          {familyIds.map((familyId, index) => {
            return (
              <FamilyComponent
                key={index}
                timeline={timeline}
                familyId={familyId}
                containerWidth={width}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

type Timeline = ConstructionTraceTree & {
  // global
  spansToTraces: Map<string, {
    enter: number,
    exitOrError: number
  }>;
  filesToFamilies: Map<string, Set<string>>;
  familiesToSpans: Map<string, Set<string>>;

  // local
  displayedFamilies: Set<string>;
  timestampsToTimelinePosition: Map<number, number>;
};

function computeTimestampsToTimelinePosition(timeline: Timeline): Map<number, number> {
  let uniqueTimestamps: Set<number> = new Set();
  
  timeline.displayedFamilies.forEach((familyId) => {
    const spans = timeline.familiesToSpans.get(familyId);
    if (spans) {
      spans.forEach((spanId) => {
        const span = timeline.spans[spanId];
        if (span) {
          const startTimestamp = resolveTimestamp(timeline, span.start, true);
          const endTimestamp = resolveTimestamp(timeline, span.end, false);
          uniqueTimestamps.add(startTimestamp);
          uniqueTimestamps.add(endTimestamp);
        }
      });
    }
  });

  uniqueTimestamps.add(timeline.min_ts);
  uniqueTimestamps.add(timeline.max_ts);

  const sortedTimestamps = Array.from(uniqueTimestamps).sort((a, b) => a - b);
  const timestampsToTimelinePosition: Map<number, number> = new Map();
  sortedTimestamps.forEach((timestamp, index) => {
    timestampsToTimelinePosition.set(timestamp, index);
  });

  return timestampsToTimelinePosition;
}

const TimelineComp: React.FC<{ timeline: Timeline }> = ({ timeline }) => {
  timeline.timestampsToTimelinePosition = computeTimestampsToTimelinePosition(timeline);
  
  return (
    <div className="bg-[var(--bg-base)] flex flex-col w-full h-full max-w-full max-h-full text-[var(--fg-base)] overflow-auto">
      {timeline.filesToFamilies.keys().map((filepath, index) => {
        const topLevelFamilies = Array.from(timeline.filesToFamilies
          .get(filepath)
          ?.values()
          .filter((familyId) => timeline.displayedFamilies.has(familyId)) || []);
        
        return (
          <TimelineCluster
            key={index}
            timeline={timeline}
            filepath={filepath}
            familyIds={topLevelFamilies}
          />
        );
      })}
    </div>
  );
};

interface VaultTimelineViewProps { }

const VaultTimelineView: React.FC<VaultTimelineViewProps> = ({ }) => {
  const focusedVault = useFocusedVault();
  const tree = useConstructionTree();

  if (!focusedVault) {
    return (
      <div className="bg-[var(--bg-base)] flex items-center justify-center w-full h-full text-[var(--fg-base)]">
        Select a Run in the sidebar to view its timeline.
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="bg-[var(--bg-base)] flex items-center justify-center w-full h-full text-[var(--fg-base)]">
        <div className="animate-pulse">Computing timeline... or No traces recorded...</div>
      </div>
    );
  }

  if (Object.keys(tree.orphan_families).length === 0) {
    return (
      <div className="bg-[var(--bg-base)] flex items-center justify-center w-full h-full text-[var(--fg-base)]">
        No traces found to display in the timeline.
      </div>
    );
  }

  let spansToTraces: Map<string, {
    enter: number,
    exitOrError: number
  }> = new Map();

  tree.traces.items.forEach((trace, index) => {
    const existing = spansToTraces.get(trace.trace_id);
    spansToTraces.set(trace.trace_id, {
      enter: trace.trace_type === "Enter" ? index : existing?.enter ?? -1,
      exitOrError: trace.trace_type === "Exit" || trace.trace_type === "Error" ? index : existing?.exitOrError ?? -1
    });
  });

  let familiesToSpans: Map<string, Set<string>> = new Map();
  let filesToFamilies: Map<string, Set<string>> = new Map();

  spansToTraces.entries().forEach(([traceId, { enter, exitOrError }]) => {
    const trace = tree.traces.items[enter];
    const span = tree.spans[traceId];
    if (trace && span) {
      const familyId = trace.parent_id;
      if (!familiesToSpans.has(familyId)) {
        familiesToSpans.set(familyId, new Set());
      }
      familiesToSpans.get(familyId)!.add(traceId);

      if (!filesToFamilies.has(trace.start_pos.filepath)) {
        filesToFamilies.set(trace.start_pos.filepath, new Set());
      }
      filesToFamilies.get(trace.start_pos.filepath)!.add(familyId);
    }
  });

  let timeline: Timeline = {
    ...tree,
    spansToTraces,
    filesToFamilies,
    familiesToSpans,
    timestampsToTimelinePosition: new Map(),
    displayedFamilies: new Set(tree.orphan_families_with_no_indirect_parent),
  };

  return (
    <TimelineComp timeline={timeline} />
  );
};

export default VaultTimelineView;