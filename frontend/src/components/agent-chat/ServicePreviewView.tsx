import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useIsBrowser } from '@/hooks/useIsBrowser';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface ServicePreviewViewProps {
  baseUrl: string;  // e.g. https://machine.a.ariana.dev/service-preview/{token}/{port}/
  port: string;
  programName?: string;
  className?: string;
  onTitleChange?: (title: string) => void;
}

export function ServicePreviewView({ baseUrl, port, programName, className, onTitleChange }: ServicePreviewViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('/');
  const [history, setHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  // Track whether the next navigation is user-initiated (back/forward) so we skip history push
  const isUserNav = useRef(false);
  const isBrowser = useIsBrowser();

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  // Build full URL from path
  const buildUrl = useCallback((path: string) => {
    // baseUrl ends with / (e.g. https://machine.a.ariana.dev/service-preview/{token}/{port}/)
    // path starts with / (e.g. /about)
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    return `${base}${path}`;
  }, [baseUrl]);

  const currentUrl = buildUrl(currentPath);

  const handleGoBack = useCallback(() => {
    if (!canGoBack) return;
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    setCurrentPath(history[newIndex]);
    isUserNav.current = true;
    setIframeKey(k => k + 1);
    setIsLoading(true);
  }, [canGoBack, historyIndex, history]);

  const handleGoForward = useCallback(() => {
    if (!canGoForward) return;
    const newIndex = historyIndex + 1;
    setHistoryIndex(newIndex);
    setCurrentPath(history[newIndex]);
    isUserNav.current = true;
    setIframeKey(k => k + 1);
    setIsLoading(true);
  }, [canGoForward, historyIndex, history]);

  const handleRefresh = useCallback(() => {
    isUserNav.current = true;
    setIframeKey(k => k + 1);
    setIsLoading(true);
  }, []);

  const handleOpenInBrowser = useCallback(async () => {
    if (isBrowser) {
      window.open(currentUrl, '_blank');
    } else {
      await openUrl(currentUrl);
    }
  }, [currentUrl]);

  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    // Reset user-nav flag on load — if a non-HTML page loaded, there won't be
    // an sp-navigate message to clear it
    isUserNav.current = false;
  }, []);

  // Listen for postMessage from the injected script in the proxy
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'sp-navigate') return;

      const { path, title } = data as { path: string; title?: string };

      if (title) {
        setPageTitle(title);
        onTitleChange?.(title);
      }

      if (path && path !== currentPath) {
        setCurrentPath(path);

        // Only push to history if this wasn't a user-initiated back/forward/refresh
        if (!isUserNav.current) {
          setHistory(prev => {
            const newHistory = prev.slice(0, historyIndex + 1);
            newHistory.push(path);
            return newHistory;
          });
          setHistoryIndex(prev => prev + 1);
        }
        isUserNav.current = false;
      } else if (title) {
        // Same path, just title update - already handled above
        isUserNav.current = false;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentPath, historyIndex]);

  const displayTitle = pageTitle || (programName ? `${programName}:${port}` : `Port ${port}`);
  const displayPath = currentPath === '/' ? '' : currentPath;

  return (
    <div className={cn("flex flex-col h-full w-full rounded-lg overflow-hidden", className)}>
      {/* Browser toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-lightest dark:bg-background-darker border-b-(length:--border-width) border-border shrink-0">
        {/* Navigation buttons */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="transparent"
              onClick={handleGoBack}
              disabled={!canGoBack}
              className="h-7 w-7 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Go back</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="transparent"
              onClick={handleGoForward}
              disabled={!canGoForward}
              className="h-7 w-7 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Go forward</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="transparent"
              onClick={handleRefresh}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>

        {/* URL / Title bar */}
        <div className="flex-1 flex items-center gap-2 mx-2 px-3 py-1 rounded-md bg-background dark:bg-background text-xs text-muted-foreground truncate border border-border/50 h-7">
          {isLoading && (
            <div className="w-3 h-3 border-2 border-muted border-t-accent rounded-full animate-spin shrink-0" />
          )}
          <span className="truncate">
            {displayTitle}
            {displayPath && (
              <span className="text-muted-foreground/50 ml-1.5">{displayPath}</span>
            )}
          </span>
        </div>

        {/* Open in browser */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="transparent"
              onClick={handleOpenInBrowser}
              className="h-7 px-2 gap-1.5 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">Open</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open in browser</TooltipContent>
        </Tooltip>
      </div>

      {/* Iframe */}
      <div className="flex-1 min-h-0 relative">
        <iframe
          key={iframeKey}
          ref={iframeRef}
          src={currentUrl}
          className="w-full h-full border-0 bg-white"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-popups-to-escape-sandbox"
          title={`Service on port ${port}`}
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
