import { useState, useCallback, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ServicePreviewView } from './ServicePreviewView';
import type { PreviewablePort } from './hooks/useServicePreviewability';
import WebAiUse from '../ui/icons/WebAiUse';

interface WebPreviewsViewProps {
  previewablePorts: PreviewablePort[];
  className?: string;
  onActivePortChange?: (port: number | null) => void;
}

export function WebPreviewsView({
  previewablePorts,
  className,
  onActivePortChange,
}: WebPreviewsViewProps) {

  const [activePort, setActivePort] = useState<number | null>(null);
  const [titles, setTitles] = useState<Map<number, string>>(new Map());

  // Auto-select first previewable port if none selected or current is gone
  const effectiveActivePort = useMemo(() => {
    if (previewablePorts.length === 0) return null;
    if (activePort !== null && previewablePorts.some(p => p.port === activePort)) {
      return activePort;
    }
    return previewablePorts[0].port;
  }, [activePort, previewablePorts]);

  // Notify parent of active port changes
  useEffect(() => {
    onActivePortChange?.(effectiveActivePort);
  }, [effectiveActivePort, onActivePortChange]);

  const handleTitleChange = useCallback((port: number, title: string) => {
    setTitles(prev => {
      const next = new Map(prev);
      next.set(port, title);
      return next;
    });
  }, []);

  const activePortInfo = previewablePorts.find(p => p.port === effectiveActivePort);

  if (previewablePorts.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <div className="text-center text-muted-foreground">
          <div className="w-8 h-8 mx-auto mb-3 opacity-40">
            <WebAiUse className="max-h-full max-w-full" />
          </div>
          <p className="text-sm">No web previews yet</p>
          <p className="text-xs mt-1.5 text-muted-foreground/60">
            Web pages will appear here once the agent's computer starts hosting them
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full w-full", className)}>
      {/* Browser-like tab bar */}
      {previewablePorts.length > 1 && (
        <div className="flex items-end gap-0 px-2 pt-1 shrink-0 overflow-x-auto overflow-y-hidden">
          {previewablePorts.map((port) => {
            const isActive = port.port === effectiveActivePort;
            const title = titles.get(port.port) || `${port.program}:${port.port}`;

            return (
              <button
                key={port.port}
                onClick={() => setActivePort(port.port)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-1.5 text-xs max-w-[180px] min-w-[80px] transition-colors rounded-t-md",
                  isActive
                    ? "bg-background dark:bg-background text-foreground border border-b-0 border-border -mb-px"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                )}
              >
                <div className="w-3.5 h-3.5 shrink-0">
                  <WebAiUse className="max-h-full max-w-full text-inherit" />
                </div>
                <span className="truncate">{title}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active service preview */}
      {activePortInfo && (
        <ServicePreviewView
          key={activePortInfo.port}
          baseUrl={activePortInfo.previewUrl}
          port={String(activePortInfo.port)}
          programName={activePortInfo.program}
          onTitleChange={(title) => handleTitleChange(activePortInfo.port, title)}
          className="flex-1 min-h-0"
        />
      )}
    </div>
  );
}
