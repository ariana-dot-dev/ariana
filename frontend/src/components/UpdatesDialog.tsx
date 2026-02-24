import React, { useEffect, useState } from 'react';
import { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Download, RefreshCw } from 'lucide-react';
import CheckmarkBadge from './ui/icons/CheckmarkBadge';
import { useUpdateAvailabilityStore } from '@/stores/useUpdateAvailabilityStore';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface UpdatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpdatesDialog({ open, onOpenChange }: UpdatesDialogProps) {
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const { toast } = useToast();

  // Use store for update availability
  const availableUpdate = useUpdateAvailabilityStore(state => state.availableUpdate);
  const checkNow = useUpdateAvailabilityStore(state => state.checkNow);
  const lastCheckTime = useUpdateAvailabilityStore(state => state.lastCheckTime);
  const [isManuallyChecking, setIsManuallyChecking] = useState(false);

  useEffect(() => {
    if (open) {
      initializeVersionInfo();
    }
  }, [open]);

  const initializeVersionInfo = async () => {
    try {
      // Get current app version
      const version = await getVersion();
      setCurrentVersion(version);

      // Trigger a check when the dialog opens if we haven't checked recently
      if (!lastCheckTime || Date.now() - lastCheckTime > 60000) {
        checkForUpdates();
      }
    } catch (error) {
      console.error('Failed to get app version:', error);
      setCurrentVersion('Unknown');
    }
  };

  const checkForUpdates = async () => {
    setIsManuallyChecking(true);

    try {
      console.log('[UpdatesDialog] Manually checking for updates...');
      await checkNow();

      // Show feedback toast
      if (availableUpdate) {
        toast({
          title: "Update Available",
          description: `Version ${availableUpdate.version} is ready to install.`,
        });
      }
    } catch (error) {
      console.error('[UpdatesDialog] Failed to check for updates:', error);
    } finally {
      setIsManuallyChecking(false);
    }
  };

  const downloadAndInstall = async () => {
    if (!availableUpdate) return;

    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      console.log('[UpdatesDialog] Starting download...');

      // Track progress - only update when it changes
      let lastProgress = 0;
      let totalBytes = 0;
      let downloadedBytes = 0;
      let lastLoggedChunk = 0;

      // Download and install the update
      await availableUpdate.downloadAndInstall((event) => {
        const data = (event as any).data;

        switch (event.event) {
          case 'Started':
            totalBytes = data?.contentLength || 0;
            console.log('[UpdatesDialog] Download started, total size:', totalBytes, 'bytes');
            setDownloadProgress(0);
            lastProgress = 0;
            downloadedBytes = 0;
            break;
          case 'Progress':
            const chunkLength = data?.chunkLength || 0;
            downloadedBytes += chunkLength;

            // Calculate real percentage
            if (totalBytes > 0) {
              const realProgress = Math.min(Math.floor((downloadedBytes / totalBytes) * 100), 99);
              if (realProgress !== lastProgress) {
                console.log('[UpdatesDialog] Progress:', realProgress + '%', `(${downloadedBytes}/${totalBytes} bytes)`);
                setDownloadProgress(realProgress);
                lastProgress = realProgress;
              }
            }
            break;
          case 'Finished':
            console.log('[UpdatesDialog] Download finished');
            setDownloadProgress(100);
            break;
        }
      });

      console.log('[UpdatesDialog] Update installed, preparing to relaunch');

      toast({
        title: "Update Installed",
        description: "Restarting the application...",
      });

      // Restart the application
      setTimeout(async () => {
        try {
          await relaunch();
        } catch (error) {
          console.error('[UpdatesDialog] Failed to relaunch:', error);
          toast({
            title: "Restart Required",
            description: "Please restart the application manually to complete the update.",
            variant: "destructive"
          });
          setIsDownloading(false);
        }
      }, 1000);

    } catch (error) {
      console.error('[UpdatesDialog] Failed to download and install update:', error);
      toast({
        title: "Update Failed",
        description: `Failed to download and install the update: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
        variant: "destructive"
      });
      setIsDownloading(false);
    }
  };

  const hasUpdateAvailable = !!availableUpdate;
  const isUpToDate = !availableUpdate && lastCheckTime !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[45ch] max-w-[95vw] p-6">
        <DialogHeader>
          <DialogTitle>App Updates</DialogTitle>
          <DialogDescription>
            Check for and install application updates
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Current Version */}
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
            <div>
              <h4 className="font-medium">Current Version</h4>
              <p className="text-sm text-muted-foreground">
                You are running version {currentVersion}
              </p>
            </div>
          </div>

          {/* Update Status */}
          <div className="text-center space-y-4">
            {isManuallyChecking ? (
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="h-16 w-16 animate-spin text-muted-foreground" />
                <p className="text-muted-foreground">Checking for updates...</p>
              </div>
            ) : isUpToDate ? (
              <div className="flex flex-col items-center gap-3">
                <div className="h-16 w-16 text-constructive-foreground">
                  <CheckmarkBadge className="max-h-full max-w-full text-inherit" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-constructive-foreground">You're up to date!</h3>
                  <p className="text-sm text-muted-foreground">
                    You have the latest version of Ariana
                  </p>
                </div>
              </div>
            ) : hasUpdateAvailable ? (
              <div className="space-y-4">
                <div className="text-6xl">🔄</div>
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-accent">Update Available!</h3>
                  <p className="text-sm text-muted-foreground">
                    Version {availableUpdate?.version} is ready to install
                  </p>
                  {availableUpdate?.body && (
                    <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md mt-3">
                      {availableUpdate.body}
                    </p>
                  )}
                </div>

                {isDownloading && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2">
                      <Download className="h-4 w-4 animate-pulse" />
                      <span className="text-sm">Installing update... {downloadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-accent/50 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center gap-3">
            {!hasUpdateAvailable && (
              <Button
                onClick={checkForUpdates}
                disabled={isManuallyChecking}
                className="gap-2"
              >
                {isManuallyChecking ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Check for Updates
                  </>
                )}
              </Button>
            )}
            {hasUpdateAvailable && (
              <Button
                onClick={downloadAndInstall}
                disabled={isDownloading}
                variant="accent"
                className="gap-2"
              >
                {isDownloading ? (
                  <>
                    <Download className="h-4 w-4 animate-pulse" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Install Update
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
