/**
 * Route types for the application
 * Supports browser URLs, deep links, and CLI arguments
 */

export type MainMenuTab = 'quick-launch' | 'projects' | 'agents';

export type Route =
  | { type: 'auth' }
  | { type: 'auth-callback'; token: string }
  | { type: 'main-menu'; tab?: MainMenuTab }
  | { type: 'onboarding' }
  | { type: 'profile' }
  | { type: 'project'; projectId: string; expectedUsername?: string }
  | { type: 'agent'; projectId: string; agentId: string; expectedUsername?: string }
  | { type: 'create-project'; localPath: string }
  | { type: 'access-agent'; token: string; projectId: string; agentId: string };

export type RouteChangeCallback = (route: Route) => void;

/**
 * Route string formats:
 *
 * Browser URLs:
 * - /app/auth
 * - /app/auth/callback?token=...
 * - /app/main-menu
 * - /app/main-menu/:tab (quick-launch, projects, agents)
 * - /app/onboarding
 * - /app/project/:projectId
 * - /app/project/:projectId/agent/:agentId
 *
 * Deep Links:
 * - ariana-ide://auth
 * - ariana-ide://auth/callback?token=...
 * - ariana-ide://main-menu
 * - ariana-ide://main-menu/:tab
 * - ariana-ide://onboarding
 * - ariana-ide://project/:projectId
 * - ariana-ide://project/:projectId/agent/:agentId
 *
 * CLI Args:
 * - ariana auth
 * - ariana <local-path>  (creates project)
 * - (no args = main-menu)
 */
