import { useAppStore } from '@/stores/useAppStore';
import { useConnectionStore } from '@/stores/useConnectionStore';
import { API_URL } from '../config';
import type { User } from '../bindings/types';
import type { Route } from '@/types/Route';
import { routerService } from '@/services/router.service';
import { toast } from '@/hooks/use-toast';
import { posthog } from './posthog';


export interface JWTPayload {
  sub: string; // User ID
  iat: number;
  exp: number;
  jti: string;
}

/**
 * Parse JWT payload without verification (for reading user info)
 * WARNING: This is only for reading - never trust this for security
 */
function parseJWTPayload(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    // Add padding if needed
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

/**
 * Make authenticated API request with automatic JWT header injection
 * No cookies, JWT only - calling code handles auth errors
 */
export async function authenticatedFetch(
  url: string, 
  options: RequestInit = {}
): Promise<Response> {
  // Get JWT token from store
  const token = useAppStore.getState().sessionToken ?? '';
  // Prepare headers
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');

  // NO CREDENTIALS - JWT only, no cookies
  const requestOptions: RequestInit = {
    ...options,
    headers,
    credentials: 'omit' // Explicitly no cookies
  };

  // console.debug('Making authenticated request', {
  //   url,
  //   method: options.method || 'GET',
  //   hasToken: !!token,
  //   tokenPreview: token.substring(0, 20) + '...'
  // });

  try {
    const response = await fetch(url, requestOptions);

    // Handle 401 errors with consecutive tracking
    if (response.status === 401) {
      const errorCount = useAppStore.getState().incrementAuthErrors();
      console.warn(`[Auth] 401 error (${errorCount} consecutive)`, { url });

      // After 10 consecutive 401s, trigger re-auth
      if (errorCount >= 15) {
        console.error('[Auth] Too many consecutive 401s, forcing re-authentication');

        // Save current route for return after re-auth
        try {
          // Import router service dynamically to avoid circular deps
          const { routerService } = await import('@/services/router.service');
          const currentRoute = routerService.getCurrentRoute();

          // Don't save auth routes
          if (currentRoute.type !== 'auth' && currentRoute.type !== 'auth-callback') {
            sessionStorage.setItem('returnRoute', JSON.stringify(currentRoute));
          }

          // Clear auth and navigate to auth screen
          useAppStore.getState().clearAuth();
          routerService.navigateTo({ type: 'auth' });
        } catch (error) {
          console.error('[Auth] Failed to handle 401 redirect:', error);
        }
      }
    } else if (response.ok) {
      // Reset error counter on successful response
      useAppStore.getState().resetAuthErrors();
    }

    return response;
  } catch (error) {
    console.error('Authenticated fetch failed', { error, url });

    // Report connection issue instead of showing alert
    useConnectionStore.getState().reportConnectionIssue();

    // Return a fake 503 response so calling code can handle gracefully
    return new Response(JSON.stringify({ error: 'Network error' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Make authenticated API request with JSON response handling
 */
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;
  
  const response = await authenticatedFetch(url, options);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error('API request failed', {
      url,
      status: response.status,
      statusText: response.statusText,
      errorText
    });
    throw new Error(`API_ERROR: ${response.status} ${response.statusText}`);
  }
  
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  
  return response as any;
}

/**
 * Complete OAuth flow by verifying JWT token and fetching user data
 * This is called when user pastes the JWT token manually or via callback
 */
export async function completeGitHubLogin(jwtToken: string): Promise<User> {
  try {
    // Verify token with backend and get user data
    const sessionResponse = await fetch(`${API_URL}/api/auth/session`, {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    });

    if (!sessionResponse.ok) {
      console.error('Invalid JWT token provided');
      throw new Error('OAUTH_INVALID_TOKEN: Cannot verify JWT token');
    }

    const session = await sessionResponse.json();
    if (!session.user) {
      console.error('No user data in session response');
      throw new Error('OAUTH_INVALID_TOKEN: No user data found');
    }

    console.log('Auth callback received: ', session.user);

    // Store JWT token and user info
    useAppStore.getState().setUser(session.user, jwtToken);

    // Reset auth errors on successful login
    useAppStore.getState().resetAuthErrors();

    // Track OAuth completion
    posthog.capture('oauth_flow_completed', {
      user_id: session.user.id,
    });
    posthog.identify(session.user.id);

    // Show welcome toast
    toast({
      title: `Welcome ${session.user.name}!`,
    });

    // Check for pending access agent FIRST (highest priority after OAuth)
    const pendingAccessAgentStr = sessionStorage.getItem('pendingAccessAgent');
    if (pendingAccessAgentStr) {
      try {
        const pending = JSON.parse(pendingAccessAgentStr);
        sessionStorage.removeItem('pendingAccessAgent');
        console.log('[Auth] Restoring pending access-agent route after login:', pending);
        routerService.navigateTo({
          type: 'access-agent',
          token: pending.token,
          projectId: pending.projectId,
          agentId: pending.agentId
        });
        return session.user;
      } catch (error) {
        console.error('[Auth] Failed to restore pending access-agent route:', error);
        sessionStorage.removeItem('pendingAccessAgent');
        // Fall through to other navigation
      }
    }

    // Check for return route after re-auth
    const returnRouteStr = sessionStorage.getItem('returnRoute');
    if (returnRouteStr) {
      try {
        const returnRoute = JSON.parse(returnRouteStr) as Route;
        sessionStorage.removeItem('returnRoute');

        // Navigate back to saved route
        console.log('[Auth] Returning to saved route after re-auth:', returnRoute);
        routerService.navigateTo(returnRoute);
        return session.user;
      } catch (error) {
        console.error('[Auth] Failed to restore return route:', error);
        // Fall through to check appStore
      }
    }

    // Check if user was viewing a project/agent before login (from appStore)
    const lastProjectId = useAppStore.getState().lastOpenedProjectId;
    // const lastAgentMap = useAppStore.getState().lastSelectedAgentPerProject;

    if (lastProjectId) {
      // const lastAgentId = lastAgentMap.get(lastProjectId);
      console.log('[Auth] Restoring last viewed project after login:', lastProjectId);
      routerService.navigateTo({ type: 'project', projectId: lastProjectId });
    } else {
      // No saved location, navigate to main menu
      console.log('[Auth] No saved location, navigating to main menu');
      routerService.navigateTo({ type: 'main-menu' });
    }

    return session.user;
  } catch (error) {
    console.error('Failed to complete GitHub login', { error });
    throw error;
  }
}

/**
 * Sign out user - revoke token and clear storage
 */
export async function signOut(): Promise<void> {
  const user = useAppStore.getState().user;
  const wasAuthed = !!user;
  useAppStore.getState().clearAuth();

  // Wait for zustand-persist to write to storage before reloading
  // The storage adapter is async, so we need to give it time to persist the null values
  // Otherwise the old user will be restored from storage on reload
  await new Promise(resolve => setTimeout(resolve, 100));

  if (wasAuthed) window.location.reload();
  console.log('Sign out complete');
}
