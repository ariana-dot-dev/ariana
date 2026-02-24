import { useState, useEffect } from 'react';
import { routerService } from '@/services/router.service';
import type { Route } from '@/types/Route';

/**
 * React hook for accessing current route and navigation
 */
export function useRouter() {
  const [route, setRoute] = useState<Route>(() => routerService.getCurrentRoute());

  useEffect(() => {
    // Subscribe to route changes
    const unsubscribe = routerService.onRouteChange((newRoute) => {
      setRoute(newRoute);
    });

    return unsubscribe;
  }, []);

  return {
    route,
    navigateTo: (newRoute: Route, pushHistory: boolean = true) => routerService.navigateTo(newRoute, pushHistory),
    getCurrentRoute: () => routerService.getCurrentRoute()
  };
}

/**
 * Hook to get specific route params
 */
export function useRouteParams() {
  const { route } = useRouter();

  return {
    projectId: route.type === 'project' ? route.projectId : route.type === 'agent' ? route.projectId : null,
    agentId: route.type === 'agent' ? route.agentId : null,
    localPath: route.type === 'create-project' ? route.localPath : null,
    token: route.type === 'auth-callback' ? route.token : null
  };
}
