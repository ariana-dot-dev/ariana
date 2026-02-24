import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Settings } from 'lucide-react';
import { AccountDropdown } from './AccountDropdown';
import { WindowsControlsIcons } from './WindowsControls/WindowsControlsIcons';
import { useOS } from '@/contexts/OSContext';
import { useAppStore } from '@/stores/useAppStore';
import { cn } from '@/lib/utils';
import { useIsBrowser } from '@/hooks/useIsBrowser';

export function CustomHeader() {
  const user = useAppStore(state => state.user);
  const { isMacOS } = useOS();
  const isBrowser = useIsBrowser();
  // const isMacOS = true;
  const [appWindow, setAppWindow] = useState<any>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);

  useEffect(() => {
    if (isBrowser) return; // Skip window management in browser

    const initWindow = async () => {
      const window = getCurrentWindow();
      setAppWindow(window);
    };

    initWindow();
  }, [isBrowser]);


  // Track maximize state for Windows/Linux
  useEffect(() => {
    if (isBrowser || !appWindow || isMacOS) return;

    const updateMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      setIsWindowMaximized(maximized);
    };

    updateMaximized();

    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await appWindow.onResized(() => {
        updateMaximized();
      });
    };

    setupListener();
    return () => unlisten?.();
  }, [appWindow, isMacOS, isBrowser]);

  const handleMinimize = () => appWindow?.minimize();
  const handleToggleMaximize = () => appWindow?.toggleMaximize();
  const handleClose = () => appWindow?.close();

  return (
    <div 
      data-tauri-drag-region
      className="absolute top-0 left-0 w-full z-10 h-9 flex items-center justify-between select-none"
    >
      {/* LEFT SECTION: macOS controls OR empty space */}
      <div
        className={cn(
          "space-x-2 flex items-center text-foreground active:text-foreground dark:text-foreground pointer-events-auto",
          isMacOS && !isBrowser ? 'ml-4' : ''
        )}
      >
        {!isMacOS && (
          <>
            <div onMouseDown={(e) => e.stopPropagation()}>
              <AccountDropdown />
            </div>
          </>
        )}
        {isMacOS && !isBrowser && (
          <>
            <button
              onClick={handleClose}
              className="group flex pr-[1px] cursor-default items-center justify-center aspect-square h-3 w-3 content-center self-center rounded-full border-(length:--border-width) border-foreground/[.12] bg-[#ff544d] text-center text-foreground/60 hover:bg-[#ff544d] active:bg-[#bf403a] active:text-foreground/60 dark:border-none"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className='group-hover:opacity-100 opacity-0'>
                <WindowsControlsIcons.closeMac />
              </div>
            </button>
            <button
              onClick={handleMinimize}
              className="group flex cursor-default items-center justify-center aspect-square h-3 w-3 content-center self-center rounded-full border-(length:--border-width) border-foreground/[.12] bg-[#ffbd2e] text-center text-foreground/60 hover:bg-[#ffbd2e] active:bg-[#bf9122] active:text-foreground/60 dark:border-none"
              onMouseDown={(e) => e.stopPropagation()}
            >
               <div className='group-hover:opacity-100 opacity-0'>
                <WindowsControlsIcons.minMac />
              </div>
            </button>
            <button
              onClick={async () => {
                if (appWindow) {
                  const isFullscreen = await appWindow.isFullscreen();
                  await appWindow.setFullscreen(!isFullscreen);
                }
              }}
              className="group flex cursor-default pr-[1px] items-center justify-center aspect-square h-3 w-3 content-center self-center rounded-full border-(length:--border-width) border-foreground/[.12] bg-[#28c93f] text-center text-foreground/60 hover:bg-[#28c93f] active:bg-[#1e9930] active:text-foreground/60 dark:border-none"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className='group-hover:opacity-100 opacity-0'>
                <WindowsControlsIcons.fullMac />
              </div>
            </button>
            <div className='ml-1' onMouseDown={(e) => e.stopPropagation()}>
              <AccountDropdown />
            </div>
          </>
        )}
        {isMacOS && isBrowser && (
          <div className='ml-1' onMouseDown={(e) => e.stopPropagation()}>
            <AccountDropdown />
          </div>
        )}
      </div>


      {/* RIGHT SECTION: User controls + Windows controls (if not macOS) */}
      <div className="flex transition-all items-center rounded-tr-lg h-full space-x-2 pointer-events-auto">
        {/* Windows/Linux controls on the RIGHT - EXACT COPY from tauri-controls */}
        {!isMacOS && !isBrowser && (
          <div className="h-8 flex self-start">
            <button
              onClick={handleMinimize}
              className="inline-flex cursor-default items-center justify-center max-h-8 w-[46px] rounded-none bg-transparent text-foreground/90 hover:bg-foreground/[.05] active:bg-foreground/[.03] dark:text-foreground dark:hover:bg-foreground/[.06] dark:active:bg-foreground/[.04]"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <WindowsControlsIcons.minimize />
            </button>
            <button
              onClick={handleToggleMaximize}
              className="max-h-8 w-[46px] cursor-default rounded-none bg-transparent text-foreground/90 hover:bg-foreground/[.05] active:bg-foreground/[.03] dark:text-foreground dark:hover:bg-foreground/[.06] dark:active:bg-foreground/[.04] inline-flex items-center justify-center"
              onMouseDown={(e) => e.stopPropagation()}
            >
              {!isWindowMaximized ? (
                <WindowsControlsIcons.maximize />
              ) : (
                <WindowsControlsIcons.restore />
              )}
            </button>
            <button
              onClick={handleClose}
              className="max-h-8 w-[46px] rounded-tr-lg cursor-default rounded-none bg-transparent text-foreground/90 dark:hover:bg-[#c42b1c] hover:bg-[#ec9e97] hover:text-foreground dark:active:bg-[#c42b1c]/90 active:bg-[#ec9e97]/90 dark:text-foreground inline-flex items-center justify-center"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <WindowsControlsIcons.close />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}