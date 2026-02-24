import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { routerService } from './router.service';
import { toast } from '@/hooks/use-toast';
import { Route } from '@/types/Route';

/**
 * Auto-update service that handles silent updates with state preservation
 *
 * Flow:
 * 1. On boot, check if update was just installed → show toast
 * 2. Check for available updates in background
 * 3. If update found → save current route → download/install → show toast → relaunch
 * 4. After relaunch → restore saved route → show "installed" toast
 */
class AutoUpdateService {
  private readonly UPDATE_STATUS_KEY = 'ariana_update_status';
  private readonly SAVED_ROUTE_KEY = 'ariana_pre_update_route';

  /**
   * Check if we just completed an update
   * Returns true if we should show "Update installed!" toast
   */
  shouldShowUpdateCompletedToast(): boolean {
    try {
      const status = localStorage.getItem(this.UPDATE_STATUS_KEY);
      return status === 'completed';
    } catch (error) {
      console.error('[AutoUpdate] Failed to check update status:', error);
      return false;
    }
  }

  /**
   * Mark update as completed (clears the flag)
   */
  markUpdateCompleted(): void {
    try {
      localStorage.removeItem(this.UPDATE_STATUS_KEY);
    } catch (error) {
      console.error('[AutoUpdate] Failed to clear update status:', error);
    }
  }

  /**
   * Get the saved pre-update route (if any)
   * Returns the route that was active before the update
   */
  getSavedRoute(): Route | null {
    try {
      const saved = localStorage.getItem(this.SAVED_ROUTE_KEY);
      if (saved) {
        const route = JSON.parse(saved) as Route;
        console.log('[AutoUpdate] Found saved pre-update route:', route);
        return route;
      }
      return null;
    } catch (error) {
      console.error('[AutoUpdate] Failed to get saved route:', error);
      return null;
    }
  }

  /**
   * Clear the saved route after restoration
   */
  clearSavedRoute(): void {
    try {
      localStorage.removeItem(this.SAVED_ROUTE_KEY);
    } catch (error) {
      console.error('[AutoUpdate] Failed to clear saved route:', error);
    }
  }

  /**
   * Check for updates and install if available
   * This runs silently in the background on app boot
   */
  async checkAndInstall(): Promise<void> {
    try {
      console.log('[AutoUpdate] Checking for updates...');
      const availableUpdate = await check();

      if (!availableUpdate) {
        console.log('[AutoUpdate] No updates available');
        return;
      }

      console.log('[AutoUpdate] Update found:', availableUpdate.version, 'Current version:', availableUpdate.currentVersion);

      // Save current route before updating
      const currentRoute = routerService.getCurrentRoute();
      console.log('[AutoUpdate] Saving current route before update:', currentRoute);
      localStorage.setItem(this.SAVED_ROUTE_KEY, JSON.stringify(currentRoute));

      // Mark that we're about to update
      localStorage.setItem(this.UPDATE_STATUS_KEY, 'pending');

      // Download and install (no progress tracking for silent updates)
      console.log('[AutoUpdate] Downloading and installing update...');
      await availableUpdate.downloadAndInstall(() => {
        // Silent - no logging
      });

      // Mark update as completed (will show toast after relaunch)
      localStorage.setItem(this.UPDATE_STATUS_KEY, 'completed');
      console.log('[AutoUpdate] Update downloaded, relaunching app...');

      // Show "reloading" message
      toast({
        title: 'Update available: reloading...',
        duration: 1000,
      });

      // Wait 1 second then relaunch
      setTimeout(async () => {
        try {
          await relaunch();
        } catch (error) {
          console.error('[AutoUpdate] Failed to relaunch:', error);
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error('[AutoUpdate] Relaunch error details:', errorMsg);

          // Clean up if relaunch fails
          localStorage.removeItem(this.UPDATE_STATUS_KEY);
          localStorage.removeItem(this.SAVED_ROUTE_KEY);

          toast({
            title: 'Update Failed',
            description: `Please restart the application manually. Error: ${errorMsg}`,
            variant: 'destructive',
          });
        }
      }, 1000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[AutoUpdate] Update check/install failed:', error);
      console.error('[AutoUpdate] Error details:', errorMsg);

      // Clean up on failure
      localStorage.removeItem(this.UPDATE_STATUS_KEY);
      localStorage.removeItem(this.SAVED_ROUTE_KEY);
    }
  }
}

export const autoUpdateService = new AutoUpdateService();
