import { create } from 'zustand';
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware';
import type { User, Project } from '@/bindings/types';
import type { AgentConfig, AgentProvider } from '@/types/AgentConfig';
import type { GithubRepository, LocalGitRepo } from '@/types/github';
import type { ProjectOrigin } from '@/types/ProjectOrigin';
import { getTauriAPI } from '@/lib/tauri-api';
import { BodyTab } from '@/lib/tabs';

export interface AvailableIDE {
  id: string;
  name: string;
  command: string;
  isAvailable: boolean;
}

export interface ProjectWorkspace {
  id: string;
  name: string;
  relativePath?: string;
  repositoryId?: string | null;
  localPath?: string;
  lastOpened?: number;
  createdAt: Date | null | number;
  cloneUrl?: string | null;
}

const tauriAPI = getTauriAPI();

interface LocalProject {
  projectId: string;
  gitRoot: string;
  relativePath: string;
  name: string;
  lastOpened: number;
  createdAt: number;
  openedPath: string;
}

type Theme = 'light' | 'dark' | 'system';

type BackgroundMode =
  | { type: 'pattern'; patternId: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: 'image'; imageId: string; url?: string };

interface ThemeVariables {
  saturation: number; // 0-100%
  lightness: number; // 0-100%
  hue: number; // 0-360
  contrast: number; // 0-2
}

export interface PromptModes {
  webSearch: boolean;
  planMode: boolean;
  ultrathink: boolean;
}

// Draft types for unsaved editor state
export interface EnvironmentDraft {
  name: string;
  envContents: string;
  secretFiles: Array<{ path: string; contents: string }>;
  sshKeyPair: { publicKey: string; privateKey: string; keyName: string } | null;
  automationIds: string[];
  // Pending automation changes from raw JSON editing
  pendingAutomationChanges?: {
    toUninstall: string[]; // IDs of automations to uninstall
    toUpdate: Array<{ id: string; data: any }>; // Automations to update
    toCreate: any[]; // New automations to create and install
  };
}

export interface AutomationDraft {
  name: string;
  trigger: {
    type: string;
    fileGlob?: string;
    commandRegex?: string;
    automationId?: string;
  };
  scriptLanguage: 'bash' | 'javascript' | 'python';
  scripts: {
    bash: string;
    javascript: string;
    python: string;
  };
  blocking: boolean;
  feedOutput: boolean;
}

// Default values for all state - used for initialization and reset
// TypeScript will infer the correct types from these values
const DEFAULTS = {
  _hasHydrated: false,
  availableIDEs: [] as AvailableIDE[],
  availableIDEsLoaded: false,
  user: null as User | null,
  sessionToken: null as string | null,
  authErrors: {
    consecutiveErrors: 0,
    lastErrorTime: 0
  },
  userRepositories: null as GithubRepository[] | null,
  hasCompletedOnboarding: false,
  theme: 'system' as Theme,
  globalFontSize: 16,
  backgroundMode: { type: 'pattern', patternId: 2 } as BackgroundMode,
  themeVariables: {
    saturation: 20,
    lightness: 22,
    hue: 37,
    contrast: 1.07
  },
  defaultAgentProvider: null as AgentProvider | null,
  backendProjects: [] as Project[],
  localProjects: new Map() as Map<string, LocalProject>,
  projectsFetchedAt: null as number | null,
  lastOpenedProjectId: null as string | null,
  projectTabs: new Map() as Map<string, BodyTab[]>,
  projectFocusedTabs: new Map() as Map<string, BodyTab | null>,
  machineIPs: new Map() as Map<string, string>,
  sshUsers: new Map() as Map<string, string>,
  lastAgentConfigs: new Map() as Map<string, AgentConfig>,
  dontShowRevertWarning: false,
  preferredIDEs: new Map() as Map<string, string>,
  agentLifetimeUnitMinutes: null as number | null,
  lastQuickLaunchOrigin: null as ProjectOrigin | null,
  lastQuickLaunchProjectId: null as string | null,
  lastMainMenuTab: 'quick-launch' as 'quick-launch' | 'projects' | 'agents',
  promptModes: new Map() as Map<string, PromptModes>,
  promptDrafts: new Map() as Map<string, string>, // agentId -> prompt text
  selectedModel: 'sonnet' as 'opus' | 'sonnet' | 'haiku', // Global model selection
  environmentEditorMode: 'form' as 'form' | 'json', // Environment editor mode (form or raw JSON)
  environmentDrafts: new Map() as Map<string, EnvironmentDraft>, // "projectId|environmentId" -> environment draft
  automationDrafts: new Map() as Map<string, AutomationDraft>, // "projectId|automationId" -> automation draft
  machineInstallOS: 'linux' as 'linux' | 'macos', // OS preference for machine install command
  lastTemplateVisibility: 'shared' as 'personal' | 'shared', // User's last selected template visibility
  interactedTabs: new Map() as Map<string, Set<string>>, // projectId -> Set of tab keys that have been interacted with
  sidebarWidth: 25 as number, // Sidebar width percentage (0-100)
  openProjectIds: [] as string[], // Ordered list of open project tab IDs
  focusedProjectId: null as string | null // Currently focused project tab
};

interface AppState {
  // Hydration state
  _hasHydrated: boolean;

  // Available IDEs (system-level, not persisted)
  availableIDEs: AvailableIDE[];
  availableIDEsLoaded: boolean;

  // Auth
  user: User | null;
  sessionToken: string | null;

  // Auth Error Tracking (for consecutive 401 detection)
  authErrors: {
    consecutiveErrors: number;
    lastErrorTime: number;
  };

  // User Repositories (cached)
  userRepositories: GithubRepository[] | null;

  // Agent Lifetime
  agentLifetimeUnitMinutes: number | null;
  setAgentLifetimeUnitMinutes: (minutes: number) => void;

  // Onboarding
  hasCompletedOnboarding: boolean;

  // Theme & Appearance
  theme: Theme;
  globalFontSize: number; // in pixels (5-32)
  backgroundMode: BackgroundMode;
  themeVariables: ThemeVariables;

  // Default Agent Provider
  defaultAgentProvider: AgentProvider | null;

  // Projects
  backendProjects: Project[];
  localProjects: Map<string, LocalProject>; // Key is now openedPath + projectId combo
  projectsFetchedAt: number | null;
  lastOpenedProjectId: string | null;
  projectTabs: Map<string, BodyTab[]>;
  projectFocusedTabs: Map<string, BodyTab | null>;

  machineIPs: Map<string, string>;
  sshUsers: Map<string, string>; // agentId -> sshUser ('ariana' | 'ariana-readonly')
  lastAgentConfigs: Map<string, AgentConfig>;
  dontShowRevertWarning: boolean;

  // IDE preference (per-project)
  preferredIDEs: Map<string, string>; // projectId -> ideId

  // QuickLaunch last selected origin/project
  lastQuickLaunchOrigin: ProjectOrigin | null;
  lastQuickLaunchProjectId: string | null;

  // MainMenu last selected tab
  lastMainMenuTab: 'quick-launch' | 'projects' | 'agents';

  // Prompt modes (per-agent per-task)
  promptModes: Map<string, PromptModes>; // key: "agentId|taskId"

  // Prompt drafts (per-agent)
  promptDrafts: Map<string, string>; // agentId -> prompt text

  // Selected model (global setting)
  selectedModel: 'opus' | 'sonnet' | 'haiku';

  // Environment editor mode
  environmentEditorMode: 'form' | 'json';

  // Environment drafts (per-project per-environment)
  environmentDrafts: Map<string, EnvironmentDraft>;

  // Automation drafts (per-project per-automation)
  automationDrafts: Map<string, AutomationDraft>;

  // Machine install OS preference
  machineInstallOS: 'linux' | 'macos';

  // Template visibility preference
  lastTemplateVisibility: 'personal' | 'shared';

  // Interacted tabs tracking (for VS Code-like preview tab behavior)
  interactedTabs: Map<string, Set<string>>; // projectId -> Set of tab keys

  // Sidebar width (percentage)
  sidebarWidth: number;

  // Project tabs (top-level)
  openProjectIds: string[];
  focusedProjectId: string | null;

  // Project tab actions
  openProjectTab: (projectId: string) => void;
  closeProjectTab: (projectId: string) => void;
  setFocusedProjectTab: (projectId: string | null) => void;
  reorderProjectTabs: (activeId: string, overId: string) => void;

  // IDE actions (system-level, fetched once)
  setAvailableIDEs: (ides: AvailableIDE[]) => void;

  // Auth actions
  setUser: (user: User | null, token?: string) => void;
  setSessionToken: (token: string) => void;
  clearAuth: () => void;
  incrementAuthErrors: () => number;
  resetAuthErrors: () => void;
  // User Repositories actions
  setUserRepositories: (repositories: GithubRepository[]) => void;

  // Onboarding actions
  setHasCompletedOnboarding: (value: boolean) => void;

  // Theme & Appearance actions
  setTheme: (theme: Theme) => void;
  setGlobalFontSize: (size: number) => void;
  setBackgroundMode: (mode: BackgroundMode) => void;
  setThemeVariables: (variables: Partial<ThemeVariables>) => void;
  resetThemeVariables: () => void;

  // Provider actions
  setDefaultAgentProvider: (provider: AgentProvider) => void;

  // Project actions
  setBackendProjects: (projects: Project[]) => void;
  trackLocalProject: (path: string, projectId: string, name?: string, relativePath?: string) => void;
  updateProjectLastOpened: (projectId: string) => void;
  setLastOpenedProjectId: (projectId: string | null) => void;
  setProjectTabs: (projectId: string, tabs: BodyTab[]) => void;
  setProjectFocusedTab: (projectId: string, tab: BodyTab | null) => void;
  updateProjectId: (oldProjectId: string, newProjectId: string, openedPath: string) => void;
  getProjectWorkspaces: () => ProjectWorkspace[];

  setMachineIP: (agentId: string, ip: string) => void;
  getMachineIP: (agentId: string) => string | null;
  clearMachineIPs: () => void;
  setSSHUser: (agentId: string, sshUser: string) => void;
  getSSHUser: (agentId: string) => string | null;
  clearSSHUsers: () => void;
  setLastAgentConfig: (projectId: string, config: AgentConfig) => void;
  getLastAgentConfig: (projectId: string) => AgentConfig | null;
  setDontShowRevertWarning: (value: boolean) => void;

  // IDE preference (per-project)
  setPreferredIDE: (projectId: string, ideId: string) => void;
  getPreferredIDE: (projectId: string) => string | null;

  // QuickLaunch origin/project actions
  setLastQuickLaunchOrigin: (origin: ProjectOrigin | null) => void;
  setLastQuickLaunchProjectId: (projectId: string | null) => void;

  // MainMenu tab actions
  setLastMainMenuTab: (tab: 'quick-launch' | 'projects' | 'agents') => void;

  // Prompt modes actions
  setPromptModes: (agentId: string, taskId: string, modes: PromptModes) => void;
  getPromptModes: (agentId: string, taskId: string) => PromptModes;

  // Prompt drafts actions
  setPromptDraft: (agentId: string, prompt: string) => void;
  getPromptDraft: (agentId: string) => string;

  // Model selection action
  setSelectedModel: (model: 'opus' | 'sonnet' | 'haiku') => void;

  // Environment editor mode action
  setEnvironmentEditorMode: (mode: 'form' | 'json') => void;

  // Environment draft actions
  setEnvironmentDraft: (projectId: string, environmentId: string, draft: EnvironmentDraft) => void;
  getEnvironmentDraft: (projectId: string, environmentId: string) => EnvironmentDraft | null;
  clearEnvironmentDraft: (projectId: string, environmentId: string) => void;

  // Automation draft actions
  setAutomationDraft: (projectId: string, automationId: string, draft: AutomationDraft) => void;
  getAutomationDraft: (projectId: string, automationId: string) => AutomationDraft | null;
  clearAutomationDraft: (projectId: string, automationId: string) => void;

  // Machine install OS preference
  setMachineInstallOS: (os: 'linux' | 'macos') => void;

  // Template visibility preference
  setLastTemplateVisibility: (visibility: 'personal' | 'shared') => void;

  // Interacted tabs actions
  markTabInteracted: (projectId: string, tabKey: string) => void;
  isTabInteracted: (projectId: string, tabKey: string) => boolean;
  clearTabInteracted: (projectId: string, tabKey: string) => void;
  getLastInteractedTabIndex: (projectId: string, tabs: BodyTab[], getTabKey: (tab: BodyTab) => string) => number;

  // Sidebar width action
  setSidebarWidth: (width: number) => void;

  // Reset
  reset: () => Promise<void>;
}

// Extract project name from path
function extractNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'Unknown';
}

// Custom Tauri storage adapter
const tauriStorage = {
  getItem: async (name: string) => {
    const store = await tauriAPI.load('app-state.json', { autoSave: false });
    const value = await store.get(name);
    return value ? JSON.stringify(value) : null;
  },
  setItem: async (name: string, value: string) => {
    const store = await tauriAPI.load('app-state.json', { autoSave: false });
    await store.set(name, JSON.parse(value));
    await store.save();
  },
  removeItem: async (name: string) => {
    const store = await tauriAPI.load('app-state.json', { autoSave: false });
    await store.delete(name);
    await store.save();
  }
};

export const useAppStore = create<AppState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // Initial state - use DEFAULTS
        ...DEFAULTS,

        // IDE actions
        setAvailableIDEs: (ides) => {
          set({ availableIDEs: ides, availableIDEsLoaded: true });
        },

        // Auth actions
        setUser: (user, token) => {
          const currentUser = get().user;
          if (JSON.stringify(currentUser) === JSON.stringify(user)) return;
          set({
            user,
            sessionToken: token || get().sessionToken
          })
        },

        setSessionToken: (token) => {
          const currentSessionToken = get().sessionToken;
          if (JSON.stringify(currentSessionToken) === JSON.stringify(token)) return;
          set({ sessionToken: token });
        },

        clearAuth: () => set({
          user: null,
          sessionToken: null,
          userRepositories: null,
          authErrors: {
            consecutiveErrors: 0,
            lastErrorTime: 0
          }
        }),

        incrementAuthErrors: () => {
          const newCount = get().authErrors.consecutiveErrors + 1;
          set({
            authErrors: {
              consecutiveErrors: newCount,
              lastErrorTime: Date.now()
            }
          });
          return newCount;
        },

        resetAuthErrors: () => {
          const currentAuthErrors = get().authErrors;
          if (JSON.stringify(currentAuthErrors) === JSON.stringify({ consecutiveErrors: 0, lastErrorTime: 0 })) return;
          set({
            authErrors: {
              consecutiveErrors: 0,
              lastErrorTime: 0
            }
          })
        },

        // User Repositories actions
        setUserRepositories: (repositories) => {
          const currentRepositories = get().userRepositories;
          if (JSON.stringify(currentRepositories) === JSON.stringify(repositories)) return;
          set({ userRepositories: repositories });
        },

        // Agent Lifetime actions
        setAgentLifetimeUnitMinutes: (minutes) => {
          const currentAgentLifetimeUnitMinutes = get().agentLifetimeUnitMinutes;
          if (JSON.stringify(currentAgentLifetimeUnitMinutes) === JSON.stringify(minutes)) return;
          set({ agentLifetimeUnitMinutes: minutes });
        },

        // Onboarding actions
        setHasCompletedOnboarding: (value) => {
          const currentHasCompletedOnboarding = get().hasCompletedOnboarding;
          if (JSON.stringify(currentHasCompletedOnboarding) === JSON.stringify(value)) return;
          set({ hasCompletedOnboarding: value });
        },

        // Theme & Appearance
        setTheme: (theme) => {
          const currentTheme = get().theme;
          if (JSON.stringify(currentTheme) === JSON.stringify(theme)) return;
          set({ theme })
        },
        setGlobalFontSize: (size) => {
          const currentGlobalFontSize = get().globalFontSize;
          if (JSON.stringify(currentGlobalFontSize) === JSON.stringify(size)) return;
          set({ globalFontSize: Math.max(5, Math.min(32, size)) })
        },
        setBackgroundMode: (mode) => {
          const currentBackgroundMode = get().backgroundMode;
          if (JSON.stringify(currentBackgroundMode) === JSON.stringify(mode)) return;
          set({ backgroundMode: mode });
        },
        setThemeVariables: (variables) => {
          const currentThemeVariables = get().themeVariables;
          if (JSON.stringify(currentThemeVariables) === JSON.stringify(variables)) return;
          set({
            themeVariables: { ...get().themeVariables, ...variables }
          })
        },
        resetThemeVariables: () => set({
          themeVariables: DEFAULTS.themeVariables
        }),

        // Provider
        setDefaultAgentProvider: (provider) => {
          const currentDefaultAgentProvider = get().defaultAgentProvider;
          if (JSON.stringify(currentDefaultAgentProvider) === JSON.stringify(provider)) return;
          set({ defaultAgentProvider: provider })
        },

        // Projects
        setBackendProjects: (projects) => {
          const currentProjects = get().backendProjects;
          if (JSON.stringify(projects) === JSON.stringify(currentProjects)) return;
          set({
            backendProjects: projects,
            projectsFetchedAt: Date.now()
          })
        },

        trackLocalProject: (openedPath, projectId, name, relativePath = '') => {
          const localProjects = new Map(get().localProjects);
          const key = `${openedPath}|${projectId}`; // Unique key for path + project combo

          // Find git root by going up from opened path
          const gitRoot = openedPath; // This should be the git root from Rust
          
          localProjects.set(key, {
            projectId,
            gitRoot,
            relativePath,
            openedPath,
            name: name || extractNameFromPath(gitRoot),
            lastOpened: Date.now(),
            createdAt: localProjects.get(key)?.createdAt || Date.now()
          });
          
          set({ localProjects });
        },

        updateProjectLastOpened: (key) => {
          const localProjects = new Map(get().localProjects);
          const project = localProjects.get(key);

          if (project) {
            project.lastOpened = Date.now();
            set({ localProjects, lastOpenedProjectId: project.projectId });
          }
        },

        setLastOpenedProjectId: (projectId: string | null) => {
          if (projectId === get().lastOpenedProjectId) return;
          set({ lastOpenedProjectId: projectId })
        },

        // setLastSelectedAgentForProject: (projectId: string, agentId: string | null) => {
        //   const lastSelectedAgentPerProject = new Map(get().lastSelectedAgentPerProject);
        //   lastSelectedAgentPerProject.delete(projectId)
        //   set({ lastSelectedAgentPerProject });
        // },

        // getLastSelectedAgentForProject: (projectId) => {
        //   return get().lastSelectedAgentPerProject.get(projectId) || null;
        // },

        setProjectTabs: (projectId, tabs) => {
          const projectTabs = new Map(get().projectTabs);
          if (JSON.stringify(tabs) === JSON.stringify(projectTabs.get(projectId))) return;
          projectTabs.set(projectId, tabs);
          set({ projectTabs });
        },

        setProjectFocusedTab: (projectId, tab) => {
          const projectFocusedTabs = new Map(get().projectFocusedTabs);
          if (JSON.stringify(tab) === JSON.stringify(projectFocusedTabs.get(projectId))) return;
          projectFocusedTabs.set(projectId, tab);
          set({ projectFocusedTabs });
        },

        updateProjectId: (oldProjectId, newProjectId, openedPath) => {
          const localProjects = new Map(get().localProjects);
          const oldKey = `${openedPath}|${oldProjectId}`;
          const newKey = `${openedPath}|${newProjectId}`;

          const project = localProjects.get(oldKey);
          if (project) {
            // Update the project with new ID
            localProjects.delete(oldKey);
            localProjects.set(newKey, {
              ...project,
              projectId: newProjectId
            });
            set({
              localProjects,
              lastOpenedProjectId: newProjectId
            });
          }
        },

        getProjectWorkspaces: () => {
          const { backendProjects, localProjects } = get();
          const projectWorkspaces: ProjectWorkspace[] = [];

          // Add all local projectWorkspaces
          for (const [key, lp] of localProjects) {
            const backendProject = backendProjects.find(p => p.id === lp.projectId);
            projectWorkspaces.push({
              id: lp.projectId,
              name: lp.name,
              relativePath: lp.relativePath,
              repositoryId: backendProject?.repositoryId,
              localPath: lp.gitRoot,
              lastOpened: lp.lastOpened,
              createdAt: backendProject?.createdAt || lp.createdAt,
              cloneUrl: backendProject?.cloneUrl
            });
          }

          // Add backend projectWorkspaces that haven't been opened locally
          for (const bp of backendProjects) {
            const hasLocalOpening = Array.from(localProjects.values()).some(lp => lp.projectId === bp.id);
            if (!hasLocalOpening) {
              projectWorkspaces.push({
                id: bp.id,
                name: bp.name,
                relativePath: undefined,
                repositoryId: bp.repositoryId,
                lastOpened: undefined,
                createdAt: bp.createdAt || null,
                cloneUrl: bp.cloneUrl
              });
            }
          }

          // Sort by last opened (most recent first)
          return projectWorkspaces.sort((a, b) =>
            (b.lastOpened || 0) - (a.lastOpened || 0)
          );
        },

        // Machine IPs
        setMachineIP: (agentId, ip) => {
          const machineIPs = new Map(get().machineIPs);
          if (JSON.stringify(machineIPs.get(agentId)) === JSON.stringify(ip)) return;
          machineIPs.set(agentId, ip);
          set({ machineIPs });
        },

        getMachineIP: (agentId) => {
          return get().machineIPs.get(agentId) || null;
        },

        clearMachineIPs: () => set({ machineIPs: new Map() }),

        // SSH Users
        setSSHUser: (agentId, sshUser) => {
          const sshUsers = new Map(get().sshUsers);
          if (JSON.stringify(sshUsers.get(agentId)) === JSON.stringify(sshUser)) return;
          sshUsers.set(agentId, sshUser);
          set({ sshUsers });
        },

        getSSHUser: (agentId) => {
          return get().sshUsers.get(agentId) || null;
        },

        clearSSHUsers: () => set({ sshUsers: new Map() }),

        setLastAgentConfig: (projectId, config) => {
          const lastAgentConfigs = new Map(get().lastAgentConfigs);
          if (JSON.stringify(lastAgentConfigs.get(projectId)) === JSON.stringify(config)) return;
          lastAgentConfigs.set(projectId, config);
          set({ lastAgentConfigs });
        },

        getLastAgentConfig: (projectId) => {
          return get().lastAgentConfigs.get(projectId) || null;
        },

        setDontShowRevertWarning: (value) => set({ dontShowRevertWarning: value }),

        // IDE preference (per-project)
        setPreferredIDE: (projectId, ideId) => {
          const preferredIDEs = new Map(get().preferredIDEs);
          if (JSON.stringify(preferredIDEs.get(projectId)) === JSON.stringify(ideId)) return;
          preferredIDEs.set(projectId, ideId);
          set({ preferredIDEs });
        },

        getPreferredIDE: (projectId) => {
          return get().preferredIDEs.get(projectId) || null;
        },

        // QuickLaunch origin
        setLastQuickLaunchOrigin: (origin) => set({ lastQuickLaunchOrigin: origin }),
        setLastQuickLaunchProjectId: (projectId) => set({ lastQuickLaunchProjectId: projectId }),

        // MainMenu tab
        setLastMainMenuTab: (tab) => {
          const lastMainMenuTab = get().lastMainMenuTab;
          if (JSON.stringify(tab) === JSON.stringify(lastMainMenuTab)) return;
          set({ lastMainMenuTab: tab });
        },

        // Prompt modes
        setPromptModes: (agentId, taskId, modes) => {
          const promptModes = new Map(get().promptModes);
          const key = `${agentId}|${taskId}`;
          if (JSON.stringify(promptModes.get(key)) === JSON.stringify(modes)) return;
          promptModes.set(key, modes);
          set({ promptModes });
        },

        getPromptModes: (agentId, taskId) => {
          const key = `${agentId}|${taskId}`;
          return get().promptModes.get(key) || {
            webSearch: false,
            planMode: false,
            ultrathink: false
          };
        },

        // Prompt drafts
        setPromptDraft: (agentId, prompt) => {
          const promptDrafts = new Map(get().promptDrafts);
          if (prompt === '') {
            if (promptDrafts.get(agentId) === prompt) return;
            promptDrafts.delete(agentId);
          } else {
            if (promptDrafts.get(agentId) === prompt) return;
            promptDrafts.set(agentId, prompt);
          }
          set({ promptDrafts });
        },

        getPromptDraft: (agentId) => {
          return get().promptDrafts.get(agentId) || '';
        },

        // Model selection
        setSelectedModel: (model) => {
          const selectedModel = get().selectedModel;
          if (JSON.stringify(model) === JSON.stringify(selectedModel)) return;
          set({ selectedModel: model });
        },

        // Environment editor mode
        setEnvironmentEditorMode: (mode) => {
          const environmentEditorMode = get().environmentEditorMode;
          if (JSON.stringify(mode) === JSON.stringify(environmentEditorMode)) return;
          set({ environmentEditorMode: mode });
        },

        // Environment drafts
        setEnvironmentDraft: (projectId, environmentId, draft) => {
          const environmentDrafts = new Map(get().environmentDrafts);
          const key = `${projectId}|${environmentId}`;
          if (JSON.stringify(environmentDrafts.get(key)) === JSON.stringify(draft)) return;
          environmentDrafts.set(key, draft);
          set({ environmentDrafts });
        },

        getEnvironmentDraft: (projectId, environmentId) => {
          const key = `${projectId}|${environmentId}`;
          return get().environmentDrafts.get(key) || null;
        },

        clearEnvironmentDraft: (projectId, environmentId) => {
          const environmentDrafts = new Map(get().environmentDrafts);
          const key = `${projectId}|${environmentId}`;
          if (JSON.stringify(environmentDrafts.get(key)) === JSON.stringify({})) return;
          environmentDrafts.delete(key);
          set({ environmentDrafts });
        },

        // Automation drafts
        setAutomationDraft: (projectId, automationId, draft) => {
          const automationDrafts = new Map(get().automationDrafts);
          const key = `${projectId}|${automationId}`;
          if (JSON.stringify(automationDrafts.get(key)) === JSON.stringify(draft)) return;
          automationDrafts.set(key, draft);
          set({ automationDrafts });
        },

        getAutomationDraft: (projectId, automationId) => {
          const key = `${projectId}|${automationId}`;
          return get().automationDrafts.get(key) || null;
        },

        clearAutomationDraft: (projectId, automationId) => {
          const automationDrafts = new Map(get().automationDrafts);
          const key = `${projectId}|${automationId}`;
          if (JSON.stringify(automationDrafts.get(key)) === JSON.stringify({})) return;
          automationDrafts.delete(key);
          set({ automationDrafts });
        },

        // Machine install OS preference
        setMachineInstallOS: (os) => {
          if (get().machineInstallOS === os) return;
          set({ machineInstallOS: os });
        },

        // Template visibility preference
        setLastTemplateVisibility: (visibility) => {
          if (get().lastTemplateVisibility === visibility) return;
          set({ lastTemplateVisibility: visibility });
        },

        // Interacted tabs
        markTabInteracted: (projectId, tabKey) => {
          const oldSet = get().interactedTabs.get(projectId);
          if (oldSet?.has(tabKey)) return; // Already interacted
          // Create new Set to trigger reactivity
          const newSet = new Set(oldSet);
          newSet.add(tabKey);
          const interactedTabs = new Map(get().interactedTabs);
          interactedTabs.set(projectId, newSet);
          set({ interactedTabs });
        },

        isTabInteracted: (projectId, tabKey) => {
          return get().interactedTabs.get(projectId)?.has(tabKey) || false;
        },

        clearTabInteracted: (projectId, tabKey) => {
          const oldSet = get().interactedTabs.get(projectId);
          if (!oldSet?.has(tabKey)) return; // Not interacted
          // Create new Set to trigger reactivity
          const newSet = new Set(oldSet);
          newSet.delete(tabKey);
          const interactedTabs = new Map(get().interactedTabs);
          interactedTabs.set(projectId, newSet);
          set({ interactedTabs });
        },

        getLastInteractedTabIndex: (projectId, tabs, getTabKey) => {
          const projectInteracted = get().interactedTabs.get(projectId);
          if (!projectInteracted || projectInteracted.size === 0) return -1;
          // Find the rightmost interacted tab
          for (let i = tabs.length - 1; i >= 0; i--) {
            if (projectInteracted.has(getTabKey(tabs[i]))) {
              return i;
            }
          }
          return -1;
        },

        // Sidebar width
        setSidebarWidth: (width) => {
          if (get().sidebarWidth === width) return;
          set({ sidebarWidth: width });
        },

        // Project tabs (top-level)
        openProjectTab: (projectId) => {
          const { openProjectIds, focusedProjectId } = get();
          const isOpen = openProjectIds.includes(projectId);
          if (isOpen && focusedProjectId === projectId) return; // Already open and focused
          if (isOpen) {
            set({ focusedProjectId: projectId });
          } else {
            set({ openProjectIds: [...openProjectIds, projectId], focusedProjectId: projectId });
          }
        },

        closeProjectTab: (projectId) => {
          const { openProjectIds, focusedProjectId } = get();
          const idx = openProjectIds.indexOf(projectId);
          if (idx === -1) return;
          const newIds = openProjectIds.filter(id => id !== projectId);
          let newFocused = focusedProjectId;
          if (focusedProjectId === projectId) {
            // Focus adjacent tab or null
            if (newIds.length === 0) {
              newFocused = null;
            } else if (idx >= newIds.length) {
              newFocused = newIds[newIds.length - 1];
            } else {
              newFocused = newIds[idx];
            }
          }
          set({ openProjectIds: newIds, focusedProjectId: newFocused });
        },

        setFocusedProjectTab: (projectId) => {
          if (get().focusedProjectId === projectId) return;
          set({ focusedProjectId: projectId });
        },

        reorderProjectTabs: (activeId, overId) => {
          const { openProjectIds } = get();
          const oldIndex = openProjectIds.indexOf(activeId);
          const newIndex = openProjectIds.indexOf(overId);
          if (oldIndex === -1 || newIndex === -1) return;
          const newIds = [...openProjectIds];
          newIds.splice(oldIndex, 1);
          newIds.splice(newIndex, 0, activeId);
          set({ openProjectIds: newIds });
        },

        // Reset - properly destroy all persisted state
        reset: async () => {
          console.log('[useAppStore] Starting full reset - destroying all persisted data');

          try {
            // Step 1: Delete persisted storage files FIRST (before state change)
            const storeName = 'app-state';

            // Clear localStorage (browser mode)
            if (typeof localStorage !== 'undefined') {
              console.log('[useAppStore] Clearing localStorage');
              localStorage.clear();
            }

            // Clear sessionStorage
            if (typeof sessionStorage !== 'undefined') {
              console.log('[useAppStore] Clearing sessionStorage');
              sessionStorage.clear();
            }

            // Delete Tauri store file (desktop mode)
            try {
              const store = await tauriAPI.load('app-state.json', { autoSave: false });
              await store.delete(storeName);
              await store.save();
              console.log('[useAppStore] Deleted Tauri store file');
            } catch (error) {
              // Store deletion might fail in browser mode, that's ok
              console.log('[useAppStore] Could not delete Tauri store (probably in browser mode):', error);
            }

            // Step 2: Reset in-memory state to DEFAULTS (excluding _hasHydrated)
            console.log('[useAppStore] Resetting in-memory state to DEFAULTS');
            const { _hasHydrated, ...resetState } = DEFAULTS;
            set(resetState);

            console.log('[useAppStore] Reset complete - all data destroyed');
          } catch (error) {
            console.error('[useAppStore] Error during reset:', error);
            // Even if there's an error, reset in-memory state
            const { _hasHydrated, ...resetState } = DEFAULTS;
            set(resetState);
          }
        }
      }),
      {
        name: 'app-state',
        storage: createJSONStorage(() => tauriStorage),
        partialize: (state) => ({
          // Only persist these fields
          // NOTE: userRepositories is intentionally NOT persisted - it should always be fetched fresh
          // to avoid stale empty arrays blocking refetch (see useLoggedInUserRepositories.ts)
          user: state.user,
          sessionToken: state.sessionToken,
          hasCompletedOnboarding: state.hasCompletedOnboarding,
          theme: state.theme,
          globalFontSize: state.globalFontSize,
          backgroundMode: state.backgroundMode,
          themeVariables: state.themeVariables,
          defaultAgentProvider: state.defaultAgentProvider,
          localProjects: Array.from(state.localProjects.entries()),
          lastOpenedProjectId: state.lastOpenedProjectId,
          projectTabs: Array.from(state.projectTabs.entries()),
          projectFocusedTabs: Array.from(state.projectFocusedTabs.entries()),
          machineIPs: Array.from(state.machineIPs.entries()),
          sshUsers: Array.from(state.sshUsers.entries()),
          lastAgentConfigs: Array.from(state.lastAgentConfigs.entries()),
          dontShowRevertWarning: state.dontShowRevertWarning,
          preferredIDEs: Array.from(state.preferredIDEs.entries()),
          agentLifetimeUnitMinutes: state.agentLifetimeUnitMinutes,
          lastQuickLaunchOrigin: state.lastQuickLaunchOrigin,
          lastQuickLaunchProjectId: state.lastQuickLaunchProjectId,
          lastMainMenuTab: state.lastMainMenuTab,
          promptModes: Array.from(state.promptModes.entries()),
          promptDrafts: Array.from(state.promptDrafts.entries()),
          selectedModel: state.selectedModel,
          environmentEditorMode: state.environmentEditorMode,
          environmentDrafts: Array.from(state.environmentDrafts.entries()),
          automationDrafts: Array.from(state.automationDrafts.entries()),
          interactedTabs: Array.from(state.interactedTabs.entries()).map(([projectId, tabKeys]) => [projectId, Array.from(tabKeys)]),
          sidebarWidth: state.sidebarWidth,
          openProjectIds: state.openProjectIds,
          focusedProjectId: state.focusedProjectId
        }),
        onRehydrateStorage: () => {
          console.log('[useAppStore] Starting rehydration...');
          return (state, error) => {
            if (error) {
              console.error('[useAppStore] Rehydration error:', error);
            } else {
              console.log('[useAppStore] Rehydration completed, state exists:', !!state);
            }

            // Convert arrays back to Maps if state exists
            if (state) {
              if (state.localProjects && Array.isArray(state.localProjects)) {
                state.localProjects = new Map(state.localProjects as any);
              }
              if (state.projectTabs && Array.isArray(state.projectTabs)) {
                state.projectTabs = new Map(state.projectTabs as any);
              }
              if (state.projectFocusedTabs && Array.isArray(state.projectFocusedTabs)) {
                state.projectFocusedTabs = new Map(state.projectFocusedTabs as any);
              }
              if (state.machineIPs && Array.isArray(state.machineIPs)) {
                state.machineIPs = new Map(state.machineIPs as any);
              }
              if (state.sshUsers && Array.isArray(state.sshUsers)) {
                state.sshUsers = new Map(state.sshUsers as any);
              }
              if (state.lastAgentConfigs && Array.isArray(state.lastAgentConfigs)) {
                state.lastAgentConfigs = new Map(state.lastAgentConfigs as any);
              }
              if (state.preferredIDEs && Array.isArray(state.preferredIDEs)) {
                state.preferredIDEs = new Map(state.preferredIDEs as any);
              }
              if (state.promptModes && Array.isArray(state.promptModes)) {
                state.promptModes = new Map(state.promptModes as any);
              }
              if (state.promptDrafts && Array.isArray(state.promptDrafts)) {
                state.promptDrafts = new Map(state.promptDrafts as any);
              }
              if (state.environmentDrafts && Array.isArray(state.environmentDrafts)) {
                state.environmentDrafts = new Map(state.environmentDrafts as any);
              }
              if (state.automationDrafts && Array.isArray(state.automationDrafts)) {
                state.automationDrafts = new Map(state.automationDrafts as any);
              }
              if (state.interactedTabs && Array.isArray(state.interactedTabs)) {
                state.interactedTabs = new Map(
                  (state.interactedTabs as any).map(([projectId, tabKeys]: [string, string[]]) => [projectId, new Set(tabKeys)])
                );
              }

              // Ensure openProjectIds is an array (might be missing from older persisted state)
              if (!Array.isArray(state.openProjectIds)) {
                state.openProjectIds = [];
              }
              if (state.focusedProjectId === undefined) {
                state.focusedProjectId = null;
              }

              // Mark hydration as complete
              state._hasHydrated = true;
            }

            // IMPORTANT: Always mark as hydrated, even if no state was persisted
            // This ensures the app doesn't get stuck on loading screen
            useAppStore.setState({ _hasHydrated: true });
            console.log('[useAppStore] Hydration marked as complete');
          };
        }
      }
    )
  )
);