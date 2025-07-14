import { load, type Store } from "@tauri-apps/plugin-store";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Command } from "../scripting/baseScript";
import { OsSession, osSessionEquals } from "../bindings/os";
import { GitProject } from "../types/GitProject";

// Define the shape of the state
interface AppState {
	theme: string;
	showOnboarding: boolean;
	currentInterpreterScript: string;
	gitProjects: GitProject[];
}

// Define the shape of the store, including state and actions
export interface IStore extends AppState {
	setTheme: (theme: string) => void;
	setShowOnboarding: (show: boolean) => void;
	setCurrentInterpreterScript: (script: string) => void;
	isLightTheme: boolean;
	addGitProject: (project: GitProject) => string;
	removeGitProject: (projectId: string) => void;
	getGitProject: (projectId: string) => GitProject | null;
	updateGitProject: (projectId: string) => void;
	clearAllGitProjects: () => void;
	resetStore: () => Promise<void>;
	gitProjects: GitProject[];
	processCommand: (command: Command) => void;
	revertCommand: () => void;
}

// Create the context
const StoreContext = createContext<IStore | null>(null);

// Provider component
export function StoreProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState("light");
	const [showOnboarding, setShowOnboardingState] = useState(false);
	const [currentInterpreterScript, setCurrentInterpreterScriptState] =
		useState("");
	const [processedCommandsStack, setProcessedCommandsStack] = useState<
		Command[]
	>([]);
	const [gitProjects, setGitProjects] = useState<GitProject[]>([]);
	const [tauriStore, setTauriStore] = useState<Store | null>(null);

	// Load state from disk on initial render
	useEffect(() => {
		const loadState = async () => {
			try {
				const tauriStore = await load("store.json", { autoSave: false });
				setTauriStore(tauriStore);
				
				// Set up persistence callback for BackgroundAgentManager
				// This ensures timer-based agent cleanup triggers persistence
				const { BackgroundAgentManager } = await import('../services/BackgroundAgentManager');
				BackgroundAgentManager.setPersistenceCallback((projectId: string) => {
					console.log(`[Store] Persistence triggered by BackgroundAgentManager for project ${projectId}`);
					// Force re-render to trigger the save useEffect
					setGitProjects((prev) => [...prev]);
				});
				const savedState = await tauriStore.get<AppState>("appState");
				if (savedState) {
					setThemeState(savedState.theme);
					setShowOnboardingState(savedState.showOnboarding);
					setCurrentInterpreterScriptState(savedState.currentInterpreterScript);
					// Handle migration from old osSessions to new gitProjects structure
					if (savedState.gitProjects) {
						console.log('Store: Loading saved GitProjects:', savedState.gitProjects.length);
						const projects = savedState.gitProjects.map((projectData: any) => 
							GitProject.fromJSON(projectData)
						).filter((p) => {
							// Keep all valid projects, including those with empty canvases
							// Only filter out projects that are fundamentally invalid
							return p && p.root && p.id;
						});
						console.log('Store: Loaded projects after filtering:', projects.length, projects);
						
						// SECURITY: Ensure all projects have repository IDs if they have git URLs
						console.log('🔍 [Store] Ensuring repository IDs for all loaded projects...');
						projects.forEach(async (project) => {
							try {
								console.log(`🔍 [Store] Checking project ${project.name} - gitOriginUrl: ${project.gitOriginUrl}, repositoryId: ${project.repositoryId}`);
								await project.ensureRepositoryId();
							} catch (error) {
								console.error(`❌ [Store] Failed to ensure repository ID for project ${project.name}:`, error);
							}
						});
						
						setGitProjects(projects);
					} else if ((savedState as any).osSessions) {
						// Migration: convert old OsSessions to GitProjects
						const oldSessions = (savedState as any).osSessions;
						const migratedProjects = Object.values(oldSessions).map((session: any) => 
							new GitProject(session as OsSession)
						);
						setGitProjects(migratedProjects);
					}
				}
			} catch (error) {
				console.error("Failed to load state:", error);
			}
		};
		loadState();
	}, []);

	// Save state to disk whenever it changes
	useEffect(() => {
		const saveState = async () => {
			try {
				if (!tauriStore) return;
				const stateToSave: AppState = {
					theme,
					showOnboarding,
					currentInterpreterScript,
					gitProjects: gitProjects.map(project => project.toJSON()),
				};
				await tauriStore.set("appState", stateToSave);
				await tauriStore.save();
			} catch (error) {
				console.error("Failed to save state:", error);
			}
		};
		saveState();
	}, [
		theme,
		showOnboarding,
		currentInterpreterScript,
		gitProjects,
	]);

	const setTheme = (newTheme: string) => setThemeState(newTheme);
	const setShowOnboarding = (show: boolean) => setShowOnboardingState(show);
	const setCurrentInterpreterScript = (script: string) =>
		setCurrentInterpreterScriptState(script);

	const isLightTheme = useMemo(() => theme.startsWith("light"), [theme]);

	const processCommand = (command: Command) => {
		setProcessedCommandsStack((prev) => [...prev, command]);
		if (command.$type === "Onboarding:show") {
			setShowOnboarding(true);
		}
		if (command.$type === "Onboarding:hide") {
			setShowOnboarding(false);
		}
		if (command.$type === "Theme:set") {
			setTheme(command.themeName);
		}
	};

	const revertCommand = () => {
		if (processedCommandsStack.length === 0) return;

		const newStack = [...processedCommandsStack];
		const commandToRevert = newStack.pop()!;
		setProcessedCommandsStack(newStack);

		if (commandToRevert.$type === "Onboarding:show") {
			setShowOnboarding(false);
		}
		if (commandToRevert.$type === "Onboarding:hide") {
			setShowOnboarding(true);
		}
		if (commandToRevert.$type === "Theme:set") {
			let previousTheme = "light";
			for (let i = newStack.length - 1; i >= 0; i--) {
				const prevCommand = newStack[i];
				if (prevCommand.$type === "Theme:set") {
					previousTheme = prevCommand.themeName;
					break;
				}
			}
			setTheme(previousTheme);
		}
	};

	const store: IStore = {
		theme,
		setTheme,
		showOnboarding,
		setShowOnboarding,
		currentInterpreterScript,
		setCurrentInterpreterScript,
		isLightTheme,
		processCommand,
		revertCommand,
		gitProjects,
		addGitProject: (project: GitProject) => {
			let projectId = null;
			setGitProjects((prev) => {
				let identicalProject = prev.find(p => osSessionEquals(p.root, project.root));
				if (!identicalProject) {
					projectId = project.id;
					console.log('Store: Adding new GitProject:', project.name, project.id);
					return [...prev, project]
				}
				projectId = identicalProject.id;
				console.log('Store: Found existing GitProject:', identicalProject.name, identicalProject.id);
				return prev
			});
			if (projectId == null) {
				throw new Error("projectId is null");
			}
			return projectId;
		},
		removeGitProject: (projectId: string) => {
			setGitProjects((prev) => prev.filter(p => p.id !== projectId));
		},
		getGitProject: (projectId: string) => {
			return gitProjects.find(p => p.id === projectId) || null;
		},
		updateGitProject: (projectId: string) => {
			// Force React to re-render and save by creating a new array
			setGitProjects((prev) => [...prev]);
		},
		clearAllGitProjects: () => {
			setGitProjects([]);
		},
		resetStore: async () => {
			try {
				if (tauriStore) {
					// Clear the store completely
					await tauriStore.clear();
					await tauriStore.save();
				}
				// Reset all state to defaults
				setThemeState("light");
				setShowOnboardingState(false);
				setCurrentInterpreterScriptState("");
				setGitProjects([]);
				setProcessedCommandsStack([]);
				console.log("[Store] Store reset successfully");
			} catch (error) {
				console.error("[Store] Failed to reset store:", error);
				throw error;
			}
		},
	};

	return (
		<StoreContext.Provider value={store}>{children}</StoreContext.Provider>
	);
}

// Custom hook to access the store
export function useStore() {
	const context = useContext(StoreContext);
	if (!context) {
		throw new Error("useStore must be used within a StoreProvider");
	}
	return context;
}
