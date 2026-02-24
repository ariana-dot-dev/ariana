import type { Route, RouteChangeCallback, MainMenuTab } from '@/types/Route';
import { getTauriAPI } from '@/lib/tauri-api';
import { useAppStore } from '@/stores/useAppStore';
import { autoUpdateService } from './autoUpdate.service';
import { posthog } from '@/lib/posthog';

const isBrowser = typeof window !== 'undefined' && !('__TAURI__' in window);

/**
 * Centralized router service
 * Handles navigation from browser URLs, deep links, and CLI arguments
 */
class RouterService {
  private currentRoute: Route = { type: 'main-menu' };
  private listeners: Set<RouteChangeCallback> = new Set();
  private isBrowser: boolean;
  private isInitialized = false;
  private cliListenerReady: Promise<void>;

  constructor() {
    this.isBrowser = typeof window !== 'undefined' && !('__TAURI__' in window);

    // Register CLI args listener immediately (before initialization)
    // Store the promise so initialization can await it
    if (!this.isBrowser && typeof window !== 'undefined') {
      this.cliListenerReady = this.setupCliArgsListener();
    } else {
      this.cliListenerReady = Promise.resolve();
    }
  }

  /**
   * Set up CLI args listener (called immediately in constructor)
   * This listener stays active and will navigate whenever CLI args are received
   */
  private async setupCliArgsListener(): Promise<void> {
    // Skip if in browser mode
    if (isBrowser) {
      // console.log('[Router] Skipping CLI args listener - browser mode');
      return;
    }

    try {
      // Get TauriAPI instance (lazily evaluated to ensure __TAURI__ is available)
      const tauriAPI = getTauriAPI();

      const unlisten = await tauriAPI.listen('cli-args', (event: any) => {
        // console.log('[Router] CLI args event received - raw event:', event);
        const args = event.payload as string[];
        // console.log('[Router] Parsed payload as args:', args);

        posthog.capture('cli_args_received', {
          args_count: args.length,
          first_arg: args[0] || null,
          is_auth_command: args[0] === 'auth'
        });

        const route = this.parseCliArgs(args);
        if (route) {
          // console.log('[Router] CLI args received:', args, '→', route);

          if (route.type === 'create-project') {
            posthog.capture('cli_project_opened', {
              project_path: route.localPath,
              is_relative_path: route.localPath?.startsWith('.') ?? false,
              platform: 'desktop'
            });
          }

          this.setRoute(route);
        } else {
          console.warn('[Router] Failed to parse CLI args into route:', args);
        }
      });
      // console.log('[Router] CLI args listener registered successfully via abstraction layer');
    } catch (error) {
      console.error('[Router] Failed to listen for CLI args:', error);
    }
  }

  /**
   * Initialize the router
   * Sets up listeners for URL changes, deep links, and CLI args
   */
  async initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // Wait for CLI listener to be ready (desktop only)
    if (!this.isBrowser) {
      await this.cliListenerReady;
    }

    // Parse initial route from URL
    if (this.isBrowser) {
      const initialRoute = this.parseUrl(window.location.pathname, window.location.search);
      this.setRoute(initialRoute, false); // Don't push to history, just notify listeners
    } else {
      // In desktop mode, check for saved route from update first
      const savedRoute = autoUpdateService.getSavedRoute();

      if (savedRoute) {
        // console.log('[Router] Restoring pre-update route:', savedRoute);
        this.setRoute(savedRoute, false);
        autoUpdateService.clearSavedRoute();
      } else {
        // No saved route, restore last opened view from appStore
        await this.restoreLastRoute();
      }
    }

    // Listen for browser back/forward navigation
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', () => {
        const route = this.parseUrl(window.location.pathname, window.location.search);
        this.setRoute(route, false); // Don't push to history again
      });
    }

    // console.log('[Router] Initialized with route:', this.currentRoute);
  }

  /**
   * Get current route
   */
  getCurrentRoute(): Route {
    return this.currentRoute;
  }

  /**
   * Navigate to a route
   * Updates state, URL (browser), and notifies listeners
   */
  navigateTo(route: Route, pushHistory = true) {
    // console.log('[Router] Navigating to:', route);
    this.setRoute(route, pushHistory);
  }

  /**
   * Subscribe to route changes
   * Returns unsubscribe function
   */
  onRouteChange(callback: RouteChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Parse browser URL into route
   */
  parseUrl(pathname: string, search: string): Route {
    // Remove /app prefix
    const path = pathname.startsWith('/app') ? pathname.slice(4) : pathname;
    const parts = path.split('/').filter(Boolean);
    const params = new URLSearchParams(search);

    // /app or /app/main-menu or /app/main-menu/:tab
    if (parts.length === 0 || parts[0] === 'main-menu') {
      const tab = parts[1] as MainMenuTab | undefined;
      // Validate tab
      const validTabs: MainMenuTab[] = ['quick-launch', 'projects', 'agents'];
      if (tab && validTabs.includes(tab)) {
        return { type: 'main-menu', tab };
      }
      return { type: 'main-menu' };
    }

    // /app/auth or /app/auth?token=...
    if (parts[0] === 'auth') {
      const token = params.get('token');
      if (token) {
        return { type: 'auth-callback', token };
      }
      return { type: 'auth' };
    }

    // /app/onboarding
    if (parts[0] === 'onboarding') {
      return { type: 'onboarding' };
    }

    // /app/profile
    if (parts[0] === 'profile') {
      return { type: 'profile' };
    }

    // /app/project/:projectId
    if (parts[0] === 'project' && parts[1]) {
      const expectedUsername = params.get('username') || undefined;
      // /app/project/:projectId/agent/:agentId
      if (parts[2] === 'agent' && parts[3]) {
        return { type: 'agent', projectId: parts[1], agentId: parts[3], expectedUsername };
      }
      return { type: 'project', projectId: parts[1], expectedUsername };
    }

    // /app/access-agent?token=...&projectId=...&agentId=...
    if (parts[0] === 'access-agent') {
      const token = params.get('token');
      const projectId = params.get('projectId');
      const agentId = params.get('agentId');
      if (token && projectId && agentId) {
        return { type: 'access-agent', token, projectId, agentId };
      }
    }

    // Default to main menu
    return { type: 'main-menu' };
  }

  /**
   * Parse deep link URL into route
   */
  parseDeepLink(url: string): Route | null {
    try {
      const parsedUrl = new URL(url);

      // Check protocol - support both production and development schemes
      if (parsedUrl.protocol !== 'ariana-ide:' && parsedUrl.protocol !== 'ariana-ide-dev:') {
        return null;
      }

      // For ariana-ide://auth/callback or ariana-ide-dev://auth/callback, hostname is 'auth' and pathname is '/callback'
      const hostname = parsedUrl.hostname;
      const pathname = parsedUrl.pathname;
      const searchParams = parsedUrl.searchParams;

      // ariana-ide://main-menu or ariana-ide-dev://main-menu/:tab
      if (hostname === 'main-menu') {
        const tab = pathname.slice(1) as MainMenuTab | undefined; // Remove leading /
        const validTabs: MainMenuTab[] = ['quick-launch', 'projects', 'agents'];
        if (tab && validTabs.includes(tab)) {
          return { type: 'main-menu', tab };
        }
        return { type: 'main-menu' };
      }

      // ariana-ide://auth or ariana-ide-dev://auth?token=...
      if (hostname === 'auth') {
        const token = searchParams.get('token');
        if (token) {
          return { type: 'auth-callback', token };
        }
        return { type: 'auth' };
      }

      // ariana-ide://onboarding or ariana-ide-dev://onboarding
      if (hostname === 'onboarding') {
        return { type: 'onboarding' };
      }

      // ariana-ide://project/:projectId or ariana-ide-dev://project/:projectId/agent/:agentId
      if (hostname === 'project' && pathname) {
        const parts = pathname.slice(1).split('/'); // Remove leading / and split
        const projectId = parts[0];
        const expectedUsername = searchParams.get('username') || undefined;

        if (projectId) {
          // ariana-ide://project/:projectId/agent/:agentId or ariana-ide-dev://...
          if (parts[1] === 'agent' && parts[2]) {
            return { type: 'agent', projectId, agentId: parts[2], expectedUsername };
          }
          // ariana-ide://project/:projectId or ariana-ide-dev://project/:projectId
          return { type: 'project', projectId, expectedUsername };
        }
      }

      // ariana-ide://access-agent?token=...&projectId=...&agentId=... or ariana-ide-dev://...
      if (hostname === 'access-agent') {
        const token = searchParams.get('token');
        const projectId = searchParams.get('projectId');
        const agentId = searchParams.get('agentId');
        if (token && projectId && agentId) {
          return { type: 'access-agent', token, projectId, agentId };
        }
      }

      return null;
    } catch (error) {
      console.error('[Router] Failed to parse deep link:', url, error);
      return null;
    }
  }

  /**
   * Parse CLI arguments into route
   */
  parseCliArgs(args: string[]): Route | null {
    if (args.length === 0) {
      return { type: 'main-menu' };
    }

    const firstArg = args[0];

    // Handle null/undefined firstArg
    if (!firstArg) {
      return { type: 'main-menu' };
    }

    // ariana auth
    if (firstArg === 'auth') {
      return { type: 'auth' };
    }

    // ariana <local-path> - treat as create project
    // Check if it looks like a path:
    // - Contains / or \ (e.g., "./folder", "C:\path", "/absolute")
    // - Is "." or ".." (current/parent directory)
    // - Starts with ./ or .\ (relative path)
    // - Starts with drive letter on Windows (e.g., "C:")
    if (
      firstArg.includes('/') ||
      firstArg.includes('\\') ||
      firstArg === '.' ||
      firstArg === '..' ||
      firstArg.startsWith('./') ||
      firstArg.startsWith('.\\') ||
      /^[a-zA-Z]:/.test(firstArg) // Windows drive letter (C:, D:, etc.)
    ) {
      return { type: 'create-project', localPath: firstArg };
    }

    // Unknown command, go to main menu
    console.warn('[Router] Unknown CLI command:', firstArg);
    return { type: 'main-menu' };
  }

  /**
   * Convert route to browser URL path
   */
  routeToUrl(route: Route): string {
    switch (route.type) {
      case 'auth':
        return '/app/auth';
      case 'auth-callback':
        return `/app/auth?token=${encodeURIComponent(route.token)}`;
      case 'main-menu':
        return route.tab ? `/app/main-menu/${route.tab}` : '/app/main-menu';
      case 'onboarding':
        return '/app/onboarding';
      case 'profile':
        return '/app/profile';
      case 'project':
        return `/app/project/${route.projectId}${route.expectedUsername ? `?username=${encodeURIComponent(route.expectedUsername)}` : ''}`;
      case 'agent':
        return `/app/project/${route.projectId}/agent/${route.agentId}${route.expectedUsername ? `?username=${encodeURIComponent(route.expectedUsername)}` : ''}`;
      case 'create-project':
        // This route doesn't have a URL representation
        return '/app/main-menu';
      case 'access-agent':
        return `/app/access-agent?token=${encodeURIComponent(route.token)}&projectId=${route.projectId}&agentId=${route.agentId}`;
    }
  }

  /**
   * Restore last opened route from appStore (desktop only)
   */
  private async restoreLastRoute() {
    try {
      // Dynamically import to avoid circular dependencies
      const state = useAppStore.getState();

      // Try to restore from project tabs first
      const focusedProjectId = state.focusedProjectId;
      const lastProjectId = focusedProjectId || state.lastOpenedProjectId;
      const lastMainMenuTab = state.lastMainMenuTab;

      if (lastProjectId) {
        posthog.capture('route_restored', {
          route_type: 'project',
          project_id: lastProjectId,
          agent_id: null
        });
        this.setRoute({ type: 'project', projectId: lastProjectId }, false);
      } else {
        // No last route, go to main menu with last tab
        this.setRoute({ type: 'main-menu', tab: lastMainMenuTab }, false);
      }
    } catch (error) {
      console.error('[Router] Failed to restore last route:', error);
      this.setRoute({ type: 'main-menu' }, false);
    }
  }

  /**
   * Internal: Set route and notify listeners
   */
  private setRoute(route: Route, pushHistory = true) {
    this.currentRoute = route;

    // Update browser URL if in browser mode
    if (this.isBrowser && pushHistory) {
      const url = this.routeToUrl(route);
      window.history.pushState({}, '', url);
    }

    // Save route to appStore for restoration on next launch (desktop only)
    if (!this.isBrowser) {
      this.saveRouteToStore(route);
    }

    // Notify all listeners
    this.listeners.forEach(callback => {
      try {
        callback(route);
      } catch (error) {
        console.error('[Router] Listener error:', error);
      }
    });
  }

  /**
   * Save current route to appStore for restoration (desktop only)
   */
  private async saveRouteToStore(route: Route) {
    try {
      const { useAppStore } = await import('@/stores/useAppStore');
      const state = useAppStore.getState();

      if (route.type === 'project') {
        state.setLastOpenedProjectId(route.projectId);
        state.setFocusedProjectTab(route.projectId);
      } else if (route.type === 'agent') {
        state.setLastOpenedProjectId(route.projectId);
        state.setFocusedProjectTab(route.projectId);
      } else if (route.type === 'main-menu') {
        // Clear last opened state when navigating to main menu
        // This ensures we start at main menu next time instead of auto-restoring
        state.setLastOpenedProjectId(null);
        state.setFocusedProjectTab(null);
        // Save the tab if specified
        if (route.tab) {
          state.setLastMainMenuTab(route.tab);
        }
      }
    } catch (error) {
      console.error('[Router] Failed to save route to store:', error);
    }
  }
}

// Singleton instance
export const routerService = new RouterService();
