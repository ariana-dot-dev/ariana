import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { MainScreen } from './components/MainScreen';
import { CustomHeader } from './components/CustomHeader';
import { Toaster } from './components/ui/toaster';
import { ConnectionStatus } from './components/ConnectionStatus';
import { OSProvider, useOS } from './contexts/OSContext';
import { LimitProvider } from './contexts/LimitContext';
import { useAppStore } from './stores/useAppStore';
import { completeGitHubLogin } from './lib/auth';
import { useIsTouchDevice } from './hooks/useIsTouchDevice';
import "./App.css";
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { cn } from './lib/utils';
import Background from './components/ui/BackgroundNew';
import { useLoggedInUserRepositories } from './hooks/useLoggedInUserRepositories';
import { useIsBrowser } from './hooks/useIsBrowser';
import { AuthScreen } from './components/AuthScreen';
import { routerService } from './services/router.service';
import { useRouter } from './hooks/useRouter';
import { initializeDeepLinkHandler } from './lib/deepLinkHandler';
import { projectService } from './services/project.service';
import { fetchAgentLifetimeUnit } from './services/agent.service';
import { AccessAgentDialog } from './components/AccessAgentDialog';
import { PollingActivityOverlay } from './components/PollingActivityOverlay';
import { usePollingTrackerStore } from './stores/usePollingTrackerStore';
import { ProfilePage } from './components/ProfilePage';
import { useProviderStore } from './stores/useProviderStore';
import { useToast } from './hooks/use-toast';
import { autoUpdateService } from './services/autoUpdate.service';
import { posthog } from './lib/posthog';
import { useGitHubTokenHealthStore } from './stores/useGitHubTokenHealthStore';
import { useUpdateAvailabilityStore } from './stores/useUpdateAvailabilityStore';
import { agentKeepAliveService } from './services/agentKeepAlive.service';
import { wsService } from './services/websocket.service';

function AppContent() {
  // Check if store has been rehydrated from storage
  const hasHydrated = useAppStore(state => state._hasHydrated);

  // Don't render anything until store is hydrated
  if (!hasHydrated) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-lightest dark:bg-darkest text-foreground">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return <AppContentHydrated />;
}

function AppContentHydrated() {
  const user = useAppStore(state => state.user);
  const setUser = useAppStore(state => state.setUser);
  const setSessionToken = useAppStore(state => state.setSessionToken);
  const setAgentLifetimeUnitMinutes = useAppStore(state => state.setAgentLifetimeUnitMinutes);
  const theme = useAppStore(state => state.theme);
  const backgroundMode = useAppStore(state => state.backgroundMode);
  const { isMacOS } = useOS();
  const isBrowser = useIsBrowser();
  const isTouchDevice = useIsTouchDevice();
  const { route } = useRouter();
  const [appWindow, setAppWindow] = useState<any>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(isBrowser);
  const [loading, setLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showAccessDialog, setShowAccessDialog] = useState(false);
  const { toast } = useToast();

  // Initialize user repositories when logged in
  useLoggedInUserRepositories();

  // Initialize provider config
  const loadProviderConfig = useProviderStore(state => state.loadConfig);

  useEffect(() => {
    const reinitAppAtUserChange = async () => {
      // Fetch agent lifetime unit
      try {
        const lifetimeUnit = await fetchAgentLifetimeUnit();
        if (lifetimeUnit) {
          setAgentLifetimeUnitMinutes(lifetimeUnit);
        }
      } catch (error) {
        console.error('[App] Failed to fetch agent lifetime unit:', error);
      }

      if (user) {
        // Load provider config
        loadProviderConfig();

        // Connect WebSocket for real-time updates
        const sessionToken = useAppStore.getState().sessionToken;
        if (sessionToken) {
          wsService.connect(sessionToken);
        }

        // Start GitHub token health polling
        useGitHubTokenHealthStore.getState().startPolling();

        // Start keep-alive service for all logged in users
        // console.log('[App] Starting agent keep-alive service');
        agentKeepAliveService.start();
      } else {
        // Stop WebSocket connection
        wsService.disconnect();

        // Stop polling if user logs out
        useGitHubTokenHealthStore.getState().stopPolling();

        // Stop keep-alive service
        // console.log('[App] Stopping agent keep-alive service');
        agentKeepAliveService.stop();
        agentKeepAliveService.clear();
      }
    }

    reinitAppAtUserChange()
  }, [user])

  // Initialize router and deep links
  useEffect(() => {
    const initApp = async () => {
      // console.log('[App] Initializing app - current user:', user);

      // Initialize router
      await routerService.initialize();

      // Track app opened
      const lastOpenedProjectId = useAppStore.getState().lastOpenedProjectId;
      // const lastSelectedAgentPerProject = useAppStore.getState().lastSelectedAgentPerProject;

      if (user) {
        posthog.capture('app_opened', {
          platform: isBrowser ? 'browser' : 'desktop',
          is_touch_device: isTouchDevice,
          user_type: 'returning_authenticated',
          user_id: user.id,
          has_saved_route: Boolean(lastOpenedProjectId),
          has_saved_project: Boolean(lastOpenedProjectId),
          has_saved_agent: Boolean(lastOpenedProjectId)
        });
        posthog.identify(user.id);
      }

      // Initialize deep link handler (Tauri only)
      if (!isBrowser) {
        await initializeDeepLinkHandler();

        // Initialize window
        const window = getCurrentWindow();
        setAppWindow(window);

        // Auto-update: Check if we just updated and show toast
        if (autoUpdateService.shouldShowUpdateCompletedToast()) {
          toast({
            title: 'Update installed!',
            duration: 3000,
          });
          autoUpdateService.markUpdateCompleted();
        }

        // Auto-update: Disabled to prevent conflict with manual update button
        // autoUpdateService.checkAndInstall().catch(err => {
        //   console.error('[App] Auto-update check failed:', err);
        // });

        // Start polling for updates (5 minute interval)
        // console.log('[App] Starting update availability polling');
        useUpdateAvailabilityStore.getState().startPolling();
      }

      // console.log('[App] Init complete - user:', useAppStore.getState().user, 'route:', routerService.getCurrentRoute());
      setLoading(false);
    };

    initApp();
  }, []);

  // Handle route changes (auth callback, create project, etc.)
  useEffect(() => {
    const handleRouteChange = async () => {
      // console.log('[App] Route change detected:', route);

      if (!isBrowser) {
        getCurrentWindow().setFocus();
      }

      // Check for pending access-agent route when landing on main menu
      if (route.type === 'main-menu' && isBrowser && user) {
        const pendingAccessAgent = sessionStorage.getItem('pendingAccessAgent');
        if (pendingAccessAgent) {
          try {
            const pending = JSON.parse(pendingAccessAgent);
            // console.log('[App] Restoring pending access-agent route:', pending);
            sessionStorage.removeItem('pendingAccessAgent');
            routerService.navigateTo({
              type: 'access-agent',
              token: pending.token,
              projectId: pending.projectId,
              agentId: pending.agentId
            });
            return;
          } catch (error) {
            console.error('[App] Failed to restore pending access-agent route:', error);
            sessionStorage.removeItem('pendingAccessAgent');
          }
        }
      }

      // Auth callback route
      if (route.type === 'auth-callback') {
        // console.log('[App] Processing auth-callback with token:', route.token.substring(0, 3) + '... (length: ' + route.token.length + ')');
        setRouteLoading(true);
        try {
          setSessionToken(route.token);
          await completeGitHubLogin(route.token);
          // console.log('[App] Auth callback completed successfully');
          // completeGitHubLogin handles navigation to return route or main menu
        } catch (error) {
          console.error('[App] Auth callback failed:', error);
          routerService.navigateTo({ type: 'auth' });
        } finally {
          setRouteLoading(false);
        }
        return;
      }

      // Create project from CLI path
      if (route.type === 'create-project') {
        if (!user) {
          // No user, redirect to auth
          console.error('[App] No user found for create-project route, redirecting to auth');
          routerService.navigateTo({ type: 'auth' });
          return;
        }

        // User exists, create the project
        setRouteLoading(true);
        try {
          // console.log('[App] Creating project from path:', route.localPath);
          posthog.capture('project_creation_started', {
            source: 'cli',
            local_path: route.localPath
          });
          const projectWorkspace = await projectService.createProjectFromPath(route.localPath);

          if (projectWorkspace) {
            posthog.capture('project_creation_success', {
              project_id: projectWorkspace.id,
              source: 'cli'
            });
            // Navigate to the new project
            routerService.navigateTo({ type: 'project', projectId: projectWorkspace.id });
          } else {
            console.error('[App] Failed to create project from path');
            routerService.navigateTo({ type: 'main-menu' });
          }
        } catch (error) {
          console.error('[App] Error creating project from path:', error);
          routerService.navigateTo({ type: 'main-menu' });
        } finally {
          setRouteLoading(false);
        }
        return;
      }

      // Access agent via share link
      if (route.type === 'access-agent') {
        // console.log('[App] Processing access-agent with token');

        posthog.capture('share_link_detected', {
          agent_id: route.agentId,
          project_id: route.projectId,
          platform: isBrowser ? 'browser' : 'desktop'
        });

        // Save pending route for browser users (so it's restored after GitHub login)
        if (isBrowser && user) {
          sessionStorage.setItem('pendingAccessAgent', JSON.stringify({
            token: route.token,
            projectId: route.projectId,
            agentId: route.agentId
          }));
        }

        // Show the access dialog (will prompt for GitHub login if not authenticated)
        setShowAccessDialog(true);
        return;
      }
    };

    handleRouteChange();
  }, [route, setUser, setSessionToken]);

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove("light", "dark")

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light"

      root.classList.add(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  // Apply global font size
  const globalFontSize = useAppStore(state => state.globalFontSize);
  const setGlobalFontSize = useAppStore(state => state.setGlobalFontSize);
  useEffect(() => {
    const root = window.document.documentElement;
    root.style.fontSize = `${globalFontSize}px`;
  }, [globalFontSize]);

  // Global keyboard shortcuts for font size adjustment and polling overlay
  const togglePollingOverlay = usePollingTrackerStore(state => state.toggleOverlay);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+Shift+O (or Cmd+Shift+O on Mac) for polling overlay
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        togglePollingOverlay();
        return;
      }

      // Check for Ctrl+ (or Cmd+ on Mac) with + or -
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=' || e.key === '-')) {
        e.preventDefault();

        const currentSize = useAppStore.getState().globalFontSize;

        if (e.key === '+' || e.key === '=') {
          // Increment font size (max 17)
          const newSize = Math.min(currentSize + 1, 32);
          setGlobalFontSize(newSize);
        } else if (e.key === '-') {
          // Decrement font size (min 5)
          const newSize = Math.max(currentSize - 1, 5);
          setGlobalFontSize(newSize);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setGlobalFontSize, togglePollingOverlay]);

  // Apply theme variables (only for light theme)
  const themeVariables = useAppStore(state => state.themeVariables);
  useEffect(() => {
    const root = window.document.documentElement;
    const isDark = root.classList.contains('dark');

    // Only apply custom variables if not in dark mode
    if (!isDark) {
      root.style.setProperty('--saturation', `${themeVariables.saturation}%`);
      root.style.setProperty('--lightness', `${themeVariables.lightness}%`);
      root.style.setProperty('--hue', `${themeVariables.hue}`);
      root.style.setProperty('--contrast', `${themeVariables.contrast}`);
    }
  }, [themeVariables, theme]);

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

  // console.log('[App] Render - loading:', loading, 'routeLoading:', routeLoading, 'route:', route, 'user:', user?.id, 'hasOnboarding:', hasCompletedOnboarding, 'hasProvider:', !!defaultAgentProvider);

  // Save current route to sessionStorage when user needs to auth (browser only)
  useEffect(() => {
    if (isBrowser && !user && route.type !== 'auth' && route.type !== 'auth-callback') {
      // Save the current route so we can return to it after login
      sessionStorage.setItem('returnRoute', JSON.stringify(route));
      // console.log('[App] Saved return route for post-auth:', route);
    }
  }, [isBrowser, user, route]);

  return (
    <div className={cn(
      "relative bg-muted/30 border-(length:--border-width) border-muted/20 text-foreground overflow-hidden w-screen selection:bg-accent/50 dark:selection:bg-accent-darker/50 selection:text-lightest",
      isWindowMaximized ? " h-screen border-none" : "rounded-lg"
    )} style={{
      height: isWindowMaximized ? '100svh' : '100svh'
    }}>
      <div className="absolute top-0 left-0 w-full h-full" style={{ zIndex: 0 }}>
        <Background background={backgroundMode} />
      </div>
      <div className="relative w-full h-full z-10">
        {(loading || routeLoading) ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        ) : route.type === 'auth-callback' ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-muted-foreground">Completing authentication...</div>
          </div>
        ) : route.type === 'auth' || !user ? (
          <div className="h-full flex flex-col">
            <CustomHeader />
            <div className="flex items-center justify-center flex-1 w-full">
              <AuthScreen/>
            </div>
          </div>
        ) : route.type === 'profile' ? (
          <ProfilePage />
        ) : route.type === 'onboarding' /*|| !hasCompletedOnboarding || !defaultAgentProvider*/ ? (
          <OnboardingFlow />
        ) : (
          <MainScreen />
        )}
        <Toaster />
        <ConnectionStatus />
        <PollingActivityOverlay />

        {/* Access Agent Dialog */}
        {showAccessDialog && route.type === 'access-agent' && (
          <AccessAgentDialog
            isOpen={showAccessDialog}
            onClose={() => {
              setShowAccessDialog(false);
              sessionStorage.removeItem('pendingAccessAgent');
              routerService.navigateTo({ type: 'main-menu' });
            }}
            token={route.token}
            projectId={route.projectId}
            agentId={route.agentId}
          />
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <OSProvider>
      <LimitProvider>
        <AppContent />
      </LimitProvider>
    </OSProvider>
  );
}

export default App;
