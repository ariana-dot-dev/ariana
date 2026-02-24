import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { ask } from '@tauri-apps/plugin-dialog';

export function useAutoUpdate() {
  const checkForUpdates = async () => {
    try {
      // Only check for updates in production builds
      if (process.env.NODE_ENV !== 'production') {
        return;
      }

      const update = await check();
      
      if (update?.available) {
        const yes = await ask(
          `Update ${update.version} is available!\n\nWould you like to install it now?`,
          { 
            title: 'Update Available', 
            kind: 'info' 
          }
        );
        
        if (yes) {
          
          await update.downloadAndInstall((event) => {
            switch (event.event) {
              case 'Started':
                break;
              case 'Progress':
                break;
              case 'Finished':
                break;
            }
          });
          
          await relaunch();
        }
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      // Don't show error to user as updates are optional
    }
  };
  
  // Check for updates on app launch with a delay
  useEffect(() => {
    const timer = setTimeout(checkForUpdates, 3000);
    return () => clearTimeout(timer);
  }, []);
  
  return { checkForUpdates };
}