import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { routerService } from '@/services/router.service';
import { posthog } from './posthog';

/**
 * Initialize deep link handling for all routes
 * Integrates with the router service
 */
export async function initializeDeepLinkHandler() {
  try {
    // Register the deep link handler
    await onOpenUrl((urls) => {
      console.log('[DeepLink] Received URLs:', urls);

      for (const urlString of urls) {
        try {
          posthog.capture('deeplink_received', {
            url_scheme: 'ariana-ide',
            full_url: urlString
          });

          // Parse the URL using router service
          const route = routerService.parseDeepLink(urlString);

          if (route) {
            console.log('[DeepLink] Parsed route:', route);

            posthog.capture('deeplink_parsed', {
              route_type: route.type,
              is_share_link: route.type === 'access-agent'
            });

            // Navigate to the parsed route
            routerService.navigateTo(route);
          } else {
            console.warn('[DeepLink] Could not parse URL:', urlString);
          }
        } catch (error) {
          console.error('[DeepLink] Error handling URL:', urlString, error);
        }
      }
    });

    console.log('[DeepLink] Deep link handler initialized');
    return true;
  } catch (error) {
    console.error('[DeepLink] Failed to initialize deep link handler:', error);
    return false;
  }
}

