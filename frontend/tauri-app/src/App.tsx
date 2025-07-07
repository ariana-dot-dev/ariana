import initSwc from "@swc/wasm-web";
import { invoke } from "@tauri-apps/api/core";
import { type Event, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import React, { useEffect, useRef, useState } from "react";
import CanvasView from "./CanvasView";
import { FileTreeCanvas } from "./canvas/FileTreeCanvas";
import { Terminal } from "./canvas/Terminal";
import type { CanvasElement } from "./canvas/types";
import { ProjectSelector } from "./components/ProjectSelector";
import DiffManagement from "./components/DiffManagement";
import { useUserConfig } from "./hooks/useUserConfig";
import Onboarding from "./Onboarding";
import Repl from "./Repl";
import { Interpreter } from "./scripting/interpreter";
import { useStore } from "./state";
import { cn } from "./utils";
import Logo from "./components/Logo";
import { GitProjectProvider } from "./contexts/GitProjectContext";
import GitProjectView from "./GitProjectView";
import { osSessionGetWorkingDirectory } from "./bindings/os";
import { CommunicationPalette } from "./components/CommunicationPalette";

const appWindow = getCurrentWebviewWindow();

export const InterpreterContext = React.createContext<Interpreter | null>(null);

const THEMES = ["light", "light-sand", "semi-sky", "dark", "ghi", "ghost"];

function App() {
	const store = useStore();
	const { userEmail, loading, error: _error, setUserEmail } = useUserConfig();
	const [isMaximized, setIsMaximized] = useState(false);
	const [interpreter, setInterpreter] = useState<Interpreter | null>(null);
	const [showTitlebar, setShowTitlebar] = useState(false);
	const [selectedGitProjectId, setSelectedGitProjectId] = useState<string | null>(null);
	const [showDiffManagement, setShowDiffManagement] = useState(false);
	const [diffManagementState, setDiffManagementState] = useState<any>(null);
	const [showCommunicationPalette, setShowCommunicationPalette] = useState(false);
	const { isLightTheme } = store;

	const titleBarHoveredRef = useRef(false);

	useEffect(() => {
		const unlistenUserEmail = listen<string>(
			"user-email-changed",
			(event: Event<string>) => {
				setUserEmail(event.payload);
			},
		);

		// Initialize heavy components asynchronously without blocking UI
		async function importAndRunSwcOnMount() {
			try {
				console.log("Starting SWC initialization...");
				await initSwc("/wasm_bg.wasm");
				console.log("SWC initialized, starting interpreter...");

				const newInterpreter = new Interpreter(store);
				await newInterpreter.init();
				console.log("Interpreter initialized");

				setInterpreter(newInterpreter);
			} catch (error) {
				console.error("Failed to initialize:", error);
				// Set a placeholder interpreter to unblock the UI
				setInterpreter(new Interpreter(store));
			}
		}

		// Start initialization after a brief delay to allow UI to render
		setTimeout(importAndRunSwcOnMount, 100);

		return () => {
			unlistenUserEmail.then((unlisten) => unlisten());
		};
	}, []);

	useEffect(() => {
		// Check if window is maximized
		appWindow.isMaximized().then(setIsMaximized);
	}, []);

	const handleMinimize = () => appWindow.minimize();
	const handleMaximize = () => {
		if (isMaximized) {
			appWindow.unmaximize();
		} else {
			appWindow.maximize();
		}
		setIsMaximized(!isMaximized);
	};
	const handleClose = () => appWindow.close();

	const openFileTree = async () => {
		if (selectedGitProjectId !== null) {
			const selectedProject = store.getGitProject(selectedGitProjectId);
			if (selectedProject) {
				try {
					const currentDir = await invoke<string>("get_current_dir", {
						osSession: selectedProject.osSession,
					});
					const fileTreeElement = FileTreeCanvas.canvasElement(
						{
							size: "medium",
							aspectRatio: 0.6,
							area: "left",
						},
						currentDir,
						1,
					);
					
					selectedProject.addToCurrentCanvasElements(fileTreeElement);
				} catch (error) {
					console.error("Failed to get current directory:", error);
				}
			}
		}
	};

	const openNewTerminal = () => {
		if (selectedGitProjectId !== null) {
			const selectedProject = store.getGitProject(selectedGitProjectId);
			if (selectedProject) {
				const terminalElement = Terminal.canvasElement(selectedProject.root, 1);
				selectedProject.addToCurrentCanvasElements(terminalElement)
			}
		}
	};

	const handleResetSessions = () => {
		// Just clear the selection, don't delete the projects from storage
		setSelectedGitProjectId(null);
	};

	const handleResetStore = async () => {
		const confirmed = window.confirm(
			"⚠️ This will permanently delete all your projects, settings, and data. This action cannot be undone.\n\nAre you sure you want to reset the store?"
		);
		
		if (confirmed) {
			try {
				await store.resetStore();
				setSelectedGitProjectId(null);
				alert("✅ Store reset successfully! The application will refresh.");
				window.location.reload();
			} catch (error) {
				alert("❌ Failed to reset store: " + error);
			}
		}
	};

	const toggleDiffManagement = () => {
		setShowDiffManagement(!showDiffManagement);
	};

	const toggleCommunicationPalette = () => {
		setShowCommunicationPalette(!showCommunicationPalette);
	};

	if (loading) {
		return (
			<div
				className={cn(
					"h-screen w-screen items-center justify-center bg-gradient-to-b from-[var(--base-300)] to-[var(--base-200)] flex flex-col rounded-lg overflow-hidden",
				)}
			>
				Loading user config...
			</div>
		);
	}

	return (
		<InterpreterContext value={interpreter}>
			<div
				className={cn(
					"relative font-sans font-[600] h-screen max-h-screen w-screen overflow-hidden selection:bg-[var(--acc-300)] text-[var(--blackest)] bg-[var(--whitest)]",
					isMaximized ? "rounded-none" : "rounded-lg",
					`theme-${store.theme}`,
				)}
			>
				<div
					className="fixed w-full h-full opacity-40 -z-10"
					style={{ background: 'url("assets/noise.png")' }}
				></div>
				<div className="w-full h-full max-h-full flex flex-col justify-between gap-1.5 p-2">
					{/* Custom Titlebar */}
					<div
						onMouseEnter={() => {
							titleBarHoveredRef.current = true;

							setTimeout(() => {
								console.log("titleBarHovered", titleBarHoveredRef.current);
								if (titleBarHoveredRef.current) {
									setShowTitlebar(true);
								}
							}, 400);
						}}
						onMouseLeave={() => {
							titleBarHoveredRef.current = false;

							setTimeout(() => {
								if (!titleBarHoveredRef.current) {
									setShowTitlebar(false);
								}
							}, 1000);
						}}
						className={cn(
							"flex w-full items-center outline-0 justify-center rounded-md select-none relative z-50  transition-[height] border-[var(--acc-400-50)]",
							showTitlebar
								? "h-fit py-1"
								: "h-[3px] hover:h-3 not-hover:bg-[var(--base-400-20)] hover:border-(length:--border)",
						)}
					>
						{showTitlebar && (
							<>
								<span
									data-tauri-drag-region
									className={cn(
										"starting:opacity-0 text-[var(--base-500)] opacity-100 text-sm  font-sans w-full text-center",
									)}
								>
									Ariana IDE
								</span>
								<div className="absolute flex right-0">
									<button
										type="button"
										onClick={openFileTree}
										className={cn(
											"starting:opacity-0 opacity-90 px-1.5 py-1 text-xs bg-[var(--base-400-20)] hover:bg-[var(--acc-400-50)] rounded-l-md transition-colors cursor-pointer",
										)}
									>
										📁
									</button>
									<button
										type="button"
										onClick={openNewTerminal}
										className={cn(
											"starting:opacity-0 opacity-90 px-1.5 py-1 text-xs bg-[var(--base-400-20)] hover:bg-[var(--acc-400-50)] transition-colors cursor-pointer",
											"starting:opacity-0 opacity-90 px-1.5 py-1 text-xs bg-[var(--base-400-20)] hover:bg-[var(--acc-400-50)] transition-colors cursor-pointer",
										)}
									>
										💻
									</button>
									<button
										type="button"
										onClick={handleResetSessions}
										className={cn(
											"starting:opacity-0 opacity-90 px-1.5 py-1 text-xs bg-[var(--base-400-20)] hover:bg-[var(--acc-400-50)] transition-colors cursor-pointer",
										)}
										title="Reset all sessions"
									>
										🔄
									</button>
									<button
										type="button"
										onClick={toggleDiffManagement}
										className={cn(
											"starting:opacity-0 opacity-90 px-1.5 py-1 text-xs bg-[var(--base-400-20)] hover:bg-[var(--acc-400-50)] transition-colors cursor-pointer",
										)}
									>
										🔀
									</button>
									<button
										type="button"
										onClick={handleResetStore}
										className={cn(
											"starting:opacity-0 opacity-90 px-1.5 py-1 text-xs bg-[var(--base-400-20)] hover:bg-red-500 hover:text-white rounded-r-md transition-colors cursor-pointer",
										)}
										title="Reset Store - Delete all data"
									>
										🗑️
									</button>
									<button
										type="button"
										onClick={toggleCommunicationPalette}
										className={cn(
											"starting:opacity-0 opacity-90 px-1.5 py-1 text-xs bg-[var(--base-400-20)] hover:bg-[var(--acc-400-50)] rounded-r-md transition-colors cursor-pointer",
										)}
										title="Open Communication Palette"
									>
										💬
									</button>
								</div>
								<div className={cn("absolute left-2 gap-2 flex items-center")}>
									<button
										type="button"
										onClick={handleClose}
										className={cn(
											"starting:opacity-0 opacity-90 w-3 h-3 rounded-full bg-[var(--base-400-20)] hover:bg-red-400 hover:outline-2 outline-offset-2 outline-red-500/50 hover:opacity-100 transition-colors cursor-pointer",
										)}
									></button>
									<button
										type="button"
										onClick={handleMinimize}
										className={cn(
											"starting:opacity-0 opacity-90 w-3 h-3 rounded-full bg-[var(--base-400-20)] hover:bg-yellow-400 hover:outline-2 outline-offset-2 outline-yellow-500/50 hover:opacity-100 transition-colors cursor-pointer",
										)}
									></button>
									<button
										type="button"
										onClick={handleMaximize}
										className={cn(
											"starting:opacity-0 opacity-90 w-3 h-3 rounded-full  bg-[var(--base-400-20)] hover:bg-green-400 hover:outline-2 outline-offset-2 outline-green-500/50 hover:opacity-100 transition-colors cursor-pointer",
										)}
									></button>
								</div>
							</>
						)}
					</div>

					{/* Show interpreter loading status */}
					{!interpreter && (
						<div
							className={cn(
								"absolute top-16 right-4 bg-[var(--base-800)]/90 text-[var(--acc-300)] px-3 py-2 rounded-md text-sm",
							)}
						>
							Initializing interpreter...
						</div>
					)}

					{/* Show ProjectSelector if no selected project, otherwise show CanvasView */}
					{selectedGitProjectId === null ? (
						<div className="z-10 h-fit w-full max-h-full flex flex-col overflow-hidden gap-12">
							<div className="flex flex-col items-center flex-shrink-0 gap-3 opacity-50 text-[var(--acc-700)]">
								<div className="w-24">
									<Logo className="hover:scale-[108%] cursor-crosshair transition-all" />
								</div>
								<h1 className="text-lg">
									Welcome to the Ariana IDE
								</h1>
							</div>
							<div className="flex w-full overflow-hidden">
								<ProjectSelector onProjectCreated={(projectId: string) => {
								setSelectedGitProjectId(projectId);
							}} />
							</div>
						</div>
					) : (
						<GitProjectProvider gitProject={store.getGitProject(selectedGitProjectId) || null}>
							{/* Diff Management Modal */}
							{showDiffManagement && (
								<div className="fixed inset-0 bg-transparent flex items-center justify-center z-50">
									<div className="bg-[var(--base-100)] rounded-lg w-full h-full flex flex-col">
										<DiffManagement 
											onClose={() => setShowDiffManagement(false)}
											initialState={diffManagementState}
											onStateChange={setDiffManagementState}
											mainTitlebarVisible={showTitlebar}
										/>
									</div>
								</div>
							)}
							
							<GitProjectView onGoHome={() => setSelectedGitProjectId(null)} />
							<Repl />
						</GitProjectProvider>
					)}

					<div></div>

					{/* Communication Palette - Available globally */}
					<CommunicationPalette
						isOpen={showCommunicationPalette}
						onClose={() => setShowCommunicationPalette(false)}
						apiKey="YOUR_API_KEY_HERE"
						provider="anthropic"
						model="claude-3-5-sonnet-20241022"
						systemPrompt="You are a helpful coding assistant integrated into the Ariana IDE."
						onAgentCreate={async (agentName: string, prompt: string) => {
							// Get the current project
							if (selectedGitProjectId) {
								const selectedProject = store.getGitProject(selectedGitProjectId);
								if (selectedProject) {
									try {
										// Create a new canvas copy (agent workspace) with initial prompt
										const initialPrompt = prompt && prompt.trim() !== 'general assistance' ? prompt.trim() : '';
										const result = await selectedProject.addCanvasCopy(undefined, initialPrompt);
										
										if (result.success && result.canvasId) {
											// Rename the canvas to the agent name
											const renamed = selectedProject.renameCanvas(result.canvasId, agentName);
											
											if (renamed) {
												// Set the new canvas as the current one
												const canvasIndex = selectedProject.canvases.findIndex(c => c.id === result.canvasId);
												if (canvasIndex !== -1) {
													selectedProject.setCurrentCanvasIndex(canvasIndex);
												}
												
												// Trigger store update to refresh UI
												store.updateGitProject(selectedProject);
												
												return {
													success: true,
													message: `Agent "${agentName}" created successfully! New workspace canvas created with isolated Git branch.${initialPrompt ? ' Initial prompt will be auto-launched.' : ''}`,
													data: {
														agentName,
														prompt,
														promptPreFilled: !!initialPrompt,
														autoLaunched: !!initialPrompt,
														canvasId: result.canvasId,
														timestamp: new Date().toISOString()
													}
												};
											} else {
												return {
													success: false,
													message: `Agent workspace created but failed to rename canvas. Canvas ID: ${result.canvasId}`
												};
											}
										} else {
											return {
												success: false,
												message: `Failed to create agent workspace: ${result.error || 'Unknown error'}`
											};
										}
									} catch (error) {
										return {
											success: false,
											message: `Error creating agent: ${error instanceof Error ? error.message : String(error)}`
										};
									}
								} else {
									return {
										success: false,
										message: "Selected project not found"
									};
								}
							} else {
								return {
									success: false,
									message: "No project selected. Please select a project first."
								};
							}
						}}
					/>

					<div className="absolute hover:opacity-100 opacity-0 bottom-0 left-2 flex rounded-t-4 pb-2 justify-center gap-1 z-50">
						{THEMES.map((theme) => (
							<button
								type="button"
								key={theme}
								className={cn(
									`theme-${theme}`,
									"rounded-full w-4 h-4 cursor-pointer  bg-gradient-to-br from-[var(--base-500)] to-[var(--acc-500)] hover:outline-2 outline-[var(--acc-600)] transition-all",
									theme === store.theme ? "opacity-100" : "opacity-50",
								)}
								onClick={() => store.setTheme(theme)}
							/>
						))}
					</div>

				</div>
			</div>
		</InterpreterContext>
	);
}

export default App;
