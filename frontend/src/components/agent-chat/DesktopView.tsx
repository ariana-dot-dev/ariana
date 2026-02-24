import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Maximize2, Minimize2, RefreshCw, Volume2, VolumeX, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authenticatedFetch } from '@/lib/auth';
import { API_URL } from '@/config';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface DesktopViewProps {
  agentId: string;
  className?: string;
}

type ConnectionState = 'idle' | 'starting' | 'connecting' | 'connected' | 'error';

export function DesktopView({ agentId, className }: DesktopViewProps) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Observability: track iframe lifecycle from URL set to stream-connected
  const iframeDiagRef = useRef<{
    t0: number;
    urlSetAt: number;
    domInsertedAt: number;
    iframeLoadAt: number;
    streamConnectedAt: number;
    perfInterval: ReturnType<typeof setInterval> | null;
  }>({ t0: 0, urlSetAt: 0, domInsertedAt: 0, iframeLoadAt: 0, streamConnectedAt: 0, perfInterval: null });

  // Poll for iframe DOM insertion and network activity
  useEffect(() => {
    if (!streamUrl) return;

    const diag = iframeDiagRef.current;
    diag.urlSetAt = performance.now();
    const T = () => `[Desktop-FE T+${Math.round(performance.now() - diag.t0)}ms]`;
    console.log(`${T()} streamUrl state set, watching for iframe DOM insertion and load...`);

    // Poll to detect when iframe actually appears in DOM and starts loading
    let checkCount = 0;
    const pollInterval = setInterval(() => {
      checkCount++;
      const iframe = iframeRef.current;
      if (!iframe) {
        if (checkCount <= 5 || checkCount % 10 === 0) {
          console.log(`${T()} iframe ref not in DOM yet (check #${checkCount})`);
        }
        return;
      }

      // iframe is in DOM
      if (!diag.domInsertedAt) {
        diag.domInsertedAt = performance.now();
        console.log(`${T()} iframe element found in DOM (${Math.round(diag.domInsertedAt - diag.urlSetAt)}ms after URL set)`);
        console.log(`${T()} iframe.src=${iframe.src ? iframe.src.replace(/token=[^&]+/, 'token=***') : 'empty'}`);
        console.log(`${T()} iframe dimensions: ${iframe.offsetWidth}x${iframe.offsetHeight}, visible=${iframe.offsetParent !== null}`);
        console.log(`${T()} iframe style.visibility=${getComputedStyle(iframe).visibility}, display=${getComputedStyle(iframe).display}`);
      }

      // Try to peek at iframe loading state
      try {
        // Cross-origin will throw, but that tells us the page started loading
        const doc = iframe.contentDocument;
        if (doc && doc.readyState) {
          if (checkCount <= 20 || checkCount % 50 === 0) {
            console.log(`${T()} iframe contentDocument.readyState=${doc.readyState} (check #${checkCount})`);
          }
        }
      } catch {
        // Cross-origin blocked = page is loading from remote origin (good sign)
        if (checkCount === 1 || (checkCount <= 10 && checkCount % 5 === 0)) {
          console.log(`${T()} iframe cross-origin (loading remote content, check #${checkCount})`);
        }
      }
    }, 100);

    // Use PerformanceObserver to catch resource timing for the iframe navigation
    let perfObserver: PerformanceObserver | null = null;
    try {
      perfObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Only log entries that match our stream URL domain
          if (streamUrl && entry.name.includes(new URL(streamUrl).hostname)) {
            const re = entry as PerformanceResourceTiming;
            console.log(`${T()} [PerfEntry] ${entry.entryType}: ${entry.name.replace(/token=[^&]+/, 'token=***')}`);
            if (re.domainLookupEnd) {
              console.log(`${T()}   DNS: ${Math.round(re.domainLookupEnd - re.domainLookupStart)}ms, TCP: ${Math.round(re.connectEnd - re.connectStart)}ms, TLS: ${Math.round(re.secureConnectionStart ? re.connectEnd - re.secureConnectionStart : 0)}ms`);
              console.log(`${T()}   TTFB: ${Math.round(re.responseStart - re.requestStart)}ms, Download: ${Math.round(re.responseEnd - re.responseStart)}ms, Total: ${Math.round(re.responseEnd - re.startTime)}ms`);
              console.log(`${T()}   Transfer size: ${re.transferSize}B, Encoded: ${re.encodedBodySize}B`);
            }
          }
        }
      });
      perfObserver.observe({ entryTypes: ['resource', 'navigation'] });
    } catch (e) {
      console.log(`${T()} PerformanceObserver not available: ${e}`);
    }

    return () => {
      clearInterval(pollInterval);
      perfObserver?.disconnect();
    };
  }, [streamUrl]);

  // Start desktop streaming when component mounts
  useEffect(() => {
    startDesktop();

    return () => {
      // Cleanup: notify iframe to disconnect if needed
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'disconnect' }, '*');
      }
    };
  }, [agentId]);

  const startDesktop = useCallback(async () => {
    const t0 = performance.now();
    iframeDiagRef.current.t0 = t0;
    iframeDiagRef.current.urlSetAt = 0;
    iframeDiagRef.current.domInsertedAt = 0;
    iframeDiagRef.current.iframeLoadAt = 0;
    iframeDiagRef.current.streamConnectedAt = 0;
    const T = () => `[Desktop-FE T+${Math.round(performance.now() - t0)}ms]`;
    console.log(`${T()} startDesktop() called for agent ${agentId}`);

    setConnectionState('starting');
    setError(null);
    setIframeLoaded(false);

    try {
      console.log(`${T()} POST /start-desktop sending...`);
      const response = await authenticatedFetch(`${API_URL}/api/agents/${agentId}/start-desktop`, {
        method: 'POST',
      });

      console.log(`${T()} POST /start-desktop response received (status=${response.status})`);
      const result = await response.json();
      console.log(`${T()} Response parsed: success=${result.success}, hasToken=${!!result.token}, hostId=${result.hostId}, desktopUrl=${result.desktopUrl || 'null'}`);

      if (result.success && result.token && result.hostId !== undefined) {
        if (!result.desktopUrl) {
          setError('Desktop streaming URL not available. Agent may need to be reprovisioned.');
          setConnectionState('error');
          return;
        }
        const url = `${result.desktopUrl}/stream.html?hostId=${result.hostId}&appId=${result.appId || 881448767}&token=${encodeURIComponent(result.token)}`;
        console.log(`${T()} Setting iframe URL (React state update)...`);
        console.log(`${T()} URL hostname: ${new URL(url).hostname}`);
        setStreamUrl(url);
        setConnectionState('connecting');

        // Store t0 on window so iframe load and stream-connected can reference it
        (window as any).__desktopStreamT0 = t0;
      } else {
        const errorMsg = typeof result.error === 'string' ? result.error : (typeof result.error === 'object' ? JSON.stringify(result.error) : 'Failed to start desktop');
        console.log(`${T()} ERROR: ${errorMsg}`);
        setError(errorMsg);
        setConnectionState('error');
      }
    } catch (err) {
      console.error(`${T()} Desktop start error:`, err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnectionState('error');
    }
  }, [agentId]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'toggle-mute', muted: !isMuted }, '*');
      setIsMuted(!isMuted);
    }
  }, [isMuted]);

  const handleIframeLoad = useCallback(() => {
    const diag = iframeDiagRef.current;
    diag.iframeLoadAt = performance.now();
    const t0 = diag.t0 || (window as any).__desktopStreamT0;
    if (t0) {
      const T = () => `[Desktop-FE T+${Math.round(performance.now() - t0)}ms]`;
      console.log(`${T()} iframe onLoad fired`);
      console.log(`${T()} TIMELINE: startDesktop→URL_set=${Math.round(diag.urlSetAt - t0)}ms, URL_set→DOM_insert=${Math.round((diag.domInsertedAt || diag.iframeLoadAt) - diag.urlSetAt)}ms, DOM_insert→onLoad=${Math.round(diag.iframeLoadAt - (diag.domInsertedAt || diag.urlSetAt))}ms, TOTAL=${Math.round(diag.iframeLoadAt - t0)}ms`);
    }
    setIframeLoaded(true);
    // Don't set 'connected' here - the iframe HTML loaded but the WebRTC stream
    // hasn't connected yet. Wait for the 'stream-connected' postMessage from
    // moonlight-web instead. This prevents showing the gray "Connecting" UI
    // as if it were the final state.
  }, []);

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!streamUrl) return;

      // Verify origin matches our stream URL
      try {
        const streamOrigin = new URL(streamUrl).origin;
        if (event.origin !== streamOrigin) return;
      } catch {
        return;
      }

      const { type, payload } = event.data || {};

      switch (type) {
        case 'stream-connected': {
          const diag = iframeDiagRef.current;
          diag.streamConnectedAt = performance.now();
          const t0 = diag.t0 || (window as any).__desktopStreamT0;
          if (t0) {
            const T = () => `[Desktop-FE T+${Math.round(performance.now() - t0)}ms]`;
            console.log(`${T()} stream-connected message received`);
            console.log(`${T()} FULL TIMELINE: startDesktop→API=${Math.round(diag.urlSetAt - t0)}ms, API→iframe_load=${Math.round(diag.iframeLoadAt - diag.urlSetAt)}ms, iframe_load→stream_connected=${Math.round(diag.streamConnectedAt - diag.iframeLoadAt)}ms, TOTAL=${Math.round(diag.streamConnectedAt - t0)}ms`);
          }
          setConnectionState('connected');
          break;
        }
        case 'stream-disconnected':
          console.log(`[Desktop-FE] stream-disconnected: ${payload?.reason || 'unknown'}`);
          setConnectionState('error');
          setError(payload?.reason || 'Stream disconnected');
          break;
        case 'stream-error':
          console.log(`[Desktop-FE] stream-error: ${payload?.message || 'unknown'}`);
          setConnectionState('error');
          setError(payload?.message || 'Stream error');
          break;
        case 'mute-changed':
          setIsMuted(payload?.muted ?? false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [streamUrl]);

  // Handle fullscreen change events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Handle keyboard shortcuts when in fullscreen
  useEffect(() => {
    if (!isFullscreen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // F11 toggles fullscreen
      if (e.key === 'F11') {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, toggleFullscreen]);

  const isStreaming = connectionState === 'connecting' || connectionState === 'connected';

  const renderContent = () => {
    return (
      <>
        {/* Loading overlay for idle/starting states */}
        {(connectionState === 'idle' || connectionState === 'starting') && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Starting desktop environment...</p>
            <p className="text-xs text-muted-foreground/70">This may take a few seconds</p>
          </div>
        )}

        {/* Loading overlay while connecting (covers iframe until WebRTC stream-connected) */}
        {connectionState === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background z-10 gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {!iframeLoaded ? 'Connecting to desktop stream...' : 'Establishing video stream...'}
            </p>
            {iframeLoaded && (
              <p className="text-xs text-muted-foreground/70">WebRTC negotiation in progress</p>
            )}
          </div>
        )}

        {/* Toolbar - only shown when connected */}
        {connectionState === 'connected' && (
          <div className={cn(
            "absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg p-1 transition-opacity",
            "bg-background/80 backdrop-blur-sm shadow-lg",
            isFullscreen ? "opacity-0 hover:opacity-100" : "opacity-100"
          )}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="transparent"
                  onClick={toggleMute}
                  className="h-8 w-8 p-0"
                >
                  {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isMuted ? "Unmute" : "Mute"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="transparent"
                  onClick={startDesktop}
                  className="h-8 w-8 p-0"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reconnect</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="transparent"
                  onClick={toggleFullscreen}
                  className="h-8 w-8 p-0"
                >
                  {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Stream iframe - persists across connecting→connected to avoid remount.
            Hidden until connected so the gray moonlight "Connecting" UI isn't visible. */}
        {isStreaming && streamUrl && (
          <iframe
            ref={iframeRef}
            src={streamUrl}
            className={cn(
              "w-full h-full border-0 bg-black",
              connectionState !== 'connected' && "invisible"
            )}
            allow="autoplay; fullscreen; microphone; camera; clipboard-read; clipboard-write"
            allowFullScreen
            onLoad={handleIframeLoad}
          />
        )}

        {/* Error state */}
        {connectionState === 'error' && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <AlertCircle className="h-12 w-12 text-destructive/70" />
            <p className="text-destructive text-sm max-w-md text-center">{error}</p>
            <Button onClick={startDesktop} variant="default" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry Connection
            </Button>
            <p className="text-xs text-muted-foreground max-w-md text-center mt-4">
              If the problem persists, the desktop environment may not be available on this agent.
              Try waiting a moment and retrying, or contact support.
            </p>
          </div>
        )}
      </>
    );
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full flex flex-col h-full bg-black overflow-hidden",
        className
      )}
    >
      <div className="flex-1 relative min-h-0">
        {renderContent()}
      </div>
      {streamUrl && (
        <div className="px-2 py-1 bg-background/90 text-xs text-muted-foreground truncate shrink-0">
          <a href={streamUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{streamUrl.replace(/token=[^&]+/, 'token=***')}</a>
        </div>
      )}
    </div>
  );
}
