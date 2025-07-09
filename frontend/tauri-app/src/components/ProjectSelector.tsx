import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { OsSession, OsSessionKind } from "../bindings/os";
import { useStore } from "../state";
import { OsSessionKindSelector } from "./OsSessionKindSelector";
import { ProjectDirectoryList } from "./ProjectDirectoryList";
import { RecentProjectsList } from "./RecentProjectsList";
import { GitProject } from "../types/GitProject";

interface ProjectSelectorProps {
	onProjectCreated: (projectId: string) => void;
}

export function ProjectSelector({ onProjectCreated }: ProjectSelectorProps) {
	const store = useStore();
	const [selectedKind, setSelectedKind] = useState<OsSessionKind | undefined>();
	
	// Create project flow state
	const [isCreatingProject, setIsCreatingProject] = useState(false);
	const [createProjectStep, setCreateProjectStep] = useState<'selectLocation' | 'enterName' | 'creating'>('selectLocation');
	const [selectedParentDir, setSelectedParentDir] = useState<string>('');
	const [projectName, setProjectName] = useState<string>('');
	const [createProjectError, setCreateProjectError] = useState<string>('');

	const handleKindSelect = (kind: OsSessionKind) => {
		setSelectedKind(kind);
	};

	const findExistingProjectForPath = (path: string): GitProject | null => {
		// Check if any existing project has this path as root or in any canvas
		return store.gitProjects.find(project => {
			// Check if this path is the project root
			const rootPath = 'Local' in project.root ? project.root.Local : 
							'Wsl' in project.root ? project.root.Wsl.working_directory : null;
			
			if (rootPath === path) {
				return true;
			}

			// Check if this path is in any canvas osSession
			return project.canvases.some(canvas => {
				if (!canvas.osSession) return false;
				const canvasPath = 'Local' in canvas.osSession ? canvas.osSession.Local :
								  'Wsl' in canvas.osSession ? canvas.osSession.Wsl.working_directory : null;
				return canvasPath === path;
			});
		}) || null;
	};

	const handleSelectFromFilesystem = async () => {
		if (!selectedKind) return;

		try {
			let defaultPath = "";
			
			// Set appropriate starting directory based on OS session kind
			if (selectedKind === "Local") {
				// For local, use home directory or common paths
				if (typeof window !== 'undefined') {
					// Windows
					if (navigator.platform.indexOf('Win') > -1) {
						defaultPath = "C:\\Users";
					}
					// macOS  
					else if (navigator.platform.indexOf('Mac') > -1) {
						defaultPath = "/Users";
					}
					// Linux
					else {
						defaultPath = "/home";
					}
				}
			} else if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
				// For WSL, start with WSL UNC path - user can navigate to Windows paths if needed
				defaultPath = `\\\\wsl$\\${selectedKind.Wsl}\\home`;
				console.log(`Opening WSL file dialog with path: ${defaultPath}`);
			}

			// Open directory picker dialog
			const selectedDir = await open({
				directory: true,
				multiple: false,
				defaultPath: defaultPath || undefined,
			});

			console.log(`File dialog returned: ${selectedDir}`);

			if (selectedDir && typeof selectedDir === 'string') {
				let convertedPath = selectedDir;

				// Convert path to WSL format if WSL is selected
				if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
					// Handle \\wsl$\distribution\path format
					if (selectedDir.startsWith(`\\\\wsl$\\${selectedKind.Wsl}\\`)) {
						// Convert \\wsl$\distribution\path to /path
						const pathAfterDistribution = selectedDir.substring(`\\\\wsl$\\${selectedKind.Wsl}\\`.length);
						convertedPath = '/' + pathAfterDistribution.replace(/\\/g, '/');
						console.log(`Converted WSL UNC path: ${selectedDir} -> ${convertedPath}`);
					}
					// Handle regular Windows drive paths (C:\ style) - convert to /mnt/c
					else if (selectedDir.match(/^[A-Za-z]:\\/)) {
						const drive = selectedDir.charAt(0).toLowerCase();
						const pathWithoutDrive = selectedDir.substring(3).replace(/\\/g, '/');
						convertedPath = `/mnt/${drive}/${pathWithoutDrive}`;
						console.log(`Converted Windows path to WSL: ${selectedDir} -> ${convertedPath}`);
					}
				}

				// Automatically open the project after path selection
				await openProjectAtPath(convertedPath);
			}
		} catch (error) {
			console.error("Failed to open directory picker:", error);
			alert("Failed to open directory picker. Please try again.");
		}
	};

	const openProjectAtPath = async (projectPath: string) => {
		if (!selectedKind) return;

		try {
			// Check if git init is needed before creating session
			await handleGitInitIfNeeded(projectPath);

			// First, check if there's an existing project that covers this path
			const existingProject = findExistingProjectForPath(projectPath);
			if (existingProject) {
				console.log("Found existing project for path:", projectPath, existingProject);
				onProjectCreated(existingProject.id);
				return;
			}

			// Create OsSession based on selected kind and path
			let osSession: OsSession;
			if (selectedKind === "Local") {
				osSession = { Local: projectPath };
			} else if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
				osSession = {
					Wsl: {
						distribution: selectedKind.Wsl,
						working_directory: projectPath,
					},
				};
			} else {
				console.error("Invalid OS session kind");
				return;
			}

			// Create GitProject with the OsSession as root
			const gitProject = new GitProject(osSession);
			const projectIndex = store.addGitProject(gitProject);

			onProjectCreated(projectIndex);
		} catch (error) {
			console.error("Failed to open project:", error);
			alert("Failed to open project. Please try again.");
		}
	};

	const handleCreateNewProject = async () => {
		if (!selectedKind) return;
		setIsCreatingProject(true);
		setCreateProjectStep('selectLocation');
		setCreateProjectError('');
		setSelectedParentDir('');
		setProjectName('');
	};

	const handleSelectParentDirectory = async () => {
		if (!selectedKind) return;

		try {
			let defaultPath = "";
			
			// Set appropriate starting directory based on OS session kind
			if (selectedKind === "Local") {
				if (typeof window !== 'undefined') {
					if (navigator.platform.indexOf('Win') > -1) {
						defaultPath = "C:\\Users";
					} else if (navigator.platform.indexOf('Mac') > -1) {
						defaultPath = "/Users";
					} else {
						defaultPath = "/home";
					}
				}
			} else if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
				defaultPath = `\\\\wsl$\\${selectedKind.Wsl}\\home`;
			}

			// Open directory picker to select parent directory
			const parentDir = await open({
				directory: true,
				multiple: false,
				defaultPath: defaultPath || undefined,
				title: "Select folder location for your new project"
			});

			if (parentDir && typeof parentDir === 'string') {
				let convertedParentPath = parentDir;

				// Convert path to WSL format if WSL is selected
				if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
					if (parentDir.startsWith(`\\\\wsl$\\${selectedKind.Wsl}\\`)) {
						const pathAfterDistribution = parentDir.substring(`\\\\wsl$\\${selectedKind.Wsl}\\`.length);
						convertedParentPath = '/' + pathAfterDistribution.replace(/\\/g, '/');
					} else if (parentDir.match(/^[A-Za-z]:\\/)) {
						const drive = parentDir.charAt(0).toLowerCase();
						const pathWithoutDrive = parentDir.substring(3).replace(/\\/g, '/');
						convertedParentPath = `/mnt/${drive}/${pathWithoutDrive}`;
					}
				}

				setSelectedParentDir(convertedParentPath);
				setCreateProjectStep('enterName');
			}
		} catch (error) {
			console.error("Failed to open directory picker:", error);
			setCreateProjectError("Failed to open directory picker. Please try again.");
		}
	};

	const handleCreateProjectWithName = async () => {
		if (!selectedKind || !selectedParentDir || !projectName.trim()) return;

		setCreateProjectStep('creating');
		setCreateProjectError('');

		try {
			const sanitizedName = projectName.trim().replace(/[<>:"/\\|?*]/g, '-');
			let projectPath = "";

			// Construct project path
			if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
				projectPath = `${selectedParentDir}/${sanitizedName}`;
			} else {
				const separator = selectedParentDir.includes('/') ? '/' : '\\';
				projectPath = `${selectedParentDir}${separator}${sanitizedName}`;
			}

			// Create OsSession for the operations
			let osSession: OsSession;
			if (selectedKind === "Local") {
				osSession = { Local: projectPath };
			} else if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
				osSession = {
					Wsl: {
						distribution: selectedKind.Wsl,
						working_directory: projectPath,
					},
				};
			} else {
				throw new Error("Invalid OS session kind");
			}

			// Create the directory
			await invoke("create_directory_with_os_session", { 
				path: projectPath, 
				osSession 
			});

			// Initialize git repository
			await invoke("git_init_repository", { 
				directory: projectPath, 
				osSession 
			});

			// Create GitProject with the OsSession as root
			const gitProject = new GitProject(osSession, sanitizedName);
			const projectId = store.addGitProject(gitProject);

			// Reset create project state
			setIsCreatingProject(false);
			setCreateProjectStep('selectLocation');
			setSelectedParentDir('');
			setProjectName('');

			// Navigate to the new project
			onProjectCreated(projectId);

		} catch (error) {
			console.error("Failed to create new project:", error);
			setCreateProjectError(`Failed to create project: ${error}`);
			setCreateProjectStep('enterName'); // Go back to name entry
		}
	};

	const handleCancelCreateProject = () => {
		setIsCreatingProject(false);
		setCreateProjectStep('selectLocation');
		setSelectedParentDir('');
		setProjectName('');
		setCreateProjectError('');
	};

	const handleGitInitIfNeeded = async (path: string) => {
		if (!selectedKind) return;

		try {
			// Create OsSession for git check
			let osSession: OsSession;
			if (selectedKind === "Local") {
				osSession = { Local: path };
			} else if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
				osSession = {
					Wsl: {
						distribution: selectedKind.Wsl,
						working_directory: path,
					},
				};
			} else {
				console.error("Invalid OS session kind");
				return;
			}

			// Check if it's already a git repository
			const isGitRepo = await invoke<boolean>("check_git_repository", { 
				directory: path, 
				osSession 
			});
			
			if (!isGitRepo) {
				const shouldInit = confirm("This directory is not a git repository. Would you like to initialize git?");
				if (shouldInit) {
					await invoke("git_init_repository", { directory: path, osSession });
				}
			}
		} catch (error) {
			console.error("Failed to check/initialize git repository:", error);
		}
	};



	return (
		<div className="flex gap-16 w-full max-w-full h-fit max-h-full px-6 justify-center overflow-hidden">
			{isCreatingProject ? (
				/* Create Project Flow */
				<div className="flex flex-col items-center gap-6 w-full max-w-md">
					<div className="text-center">
						<h2 className="text-xl font-medium text-[var(--base-700)] mb-2">Create New Project</h2>
						<p className="text-sm text-[var(--base-600)]">
							{createProjectStep === 'selectLocation' && "First, select where you want to create your new project"}
							{createProjectStep === 'enterName' && "Now, give your project a name"}
							{createProjectStep === 'creating' && "Creating your project..."}
						</p>
					</div>

					{createProjectError && (
						<div className="w-full p-3 bg-[var(--negative-100)] border border-[var(--negative-300)] rounded-lg text-[var(--negative-700)] text-sm">
							{createProjectError}
						</div>
					)}

					{createProjectStep === 'selectLocation' && (
						<div className="flex flex-col gap-4 w-full">
							<button
								onClick={handleSelectParentDirectory}
								className="px-6 py-4 bg-[var(--acc-400)] hover:bg-[var(--acc-500)] text-[var(--whitest)] rounded-lg transition-colors text-center"
							>
								📁 Select Folder Location
							</button>
							<button
								onClick={handleCancelCreateProject}
								className="px-4 py-2 bg-[var(--base-200)] hover:bg-[var(--base-300)] text-[var(--base-700)] rounded-lg transition-colors text-center"
							>
								Cancel
							</button>
						</div>
					)}

					{createProjectStep === 'enterName' && (
						<div className="flex flex-col gap-4 w-full">
							<div className="text-sm text-[var(--base-600)]">
								<span className="font-medium">Location:</span> {selectedParentDir}
							</div>
							<div className="flex flex-col gap-2">
								<label className="text-sm font-medium text-[var(--base-700)]">
									Project Name:
								</label>
								<input
									type="text"
									value={projectName}
									onChange={(e) => setProjectName(e.target.value)}
									placeholder="Enter project name..."
									className="px-3 py-2 border border-[var(--base-400)] rounded-lg focus:outline-none focus:border-[var(--acc-500)] text-[var(--base-800)]"
									autoFocus
									onKeyDown={(e) => {
										if (e.key === 'Enter' && projectName.trim()) {
											handleCreateProjectWithName();
										}
									}}
								/>
							</div>
							<div className="flex gap-2">
								<button
									onClick={handleCreateProjectWithName}
									disabled={!projectName.trim()}
									className="flex-1 px-4 py-2 bg-[var(--positive-400)] hover:bg-[var(--positive-500)] disabled:bg-[var(--base-300)] disabled:text-[var(--base-500)] text-[var(--whitest)] rounded-lg transition-colors flex items-center justify-center gap-2"
								>
									<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-plus-circle-dotted" viewBox="0 0 16 16">
										<path d="M8 0q-.264 0-.523.017l.064.998a7 7 0 0 1 .918 0l.064-.998A8 8 0 0 0 8 0M6.44.152q-.52.104-1.012.27l.321.948q.43-.147.884-.237L6.44.153zm4.132.271a8 8 0 0 0-1.011-.27l-.194.98q.453.09.884.237zm1.873.925a8 8 0 0 0-.906-.524l-.443.896q.413.205.793.459zM4.46.824q-.471.233-.905.524l.556.83a7 7 0 0 1 .793-.458zM2.725 1.985q-.394.346-.74.74l.752.66q.303-.345.648-.648zm11.29.74a8 8 0 0 0-.74-.74l-.66.752q.346.303.648.648zm1.161 1.735a8 8 0 0 0-.524-.905l-.83.556q.254.38.458.793l.896-.443zM1.348 3.555q-.292.433-.524.906l.896.443q.205-.413.459-.793zM.423 5.428a8 8 0 0 0-.27 1.011l.98.194q.09-.453.237-.884zM15.848 6.44a8 8 0 0 0-.27-1.012l-.948.321q.147.43.237.884zM.017 7.477a8 8 0 0 0 0 1.046l.998-.064a7 7 0 0 1 0-.918zM16 8a8 8 0 0 0-.017-.523l-.998.064a7 7 0 0 1 0 .918l.998.064A8 8 0 0 0 16 8M.152 9.56q.104.52.27 1.012l.948-.321a7 7 0 0 1-.237-.884l-.98.194zm15.425 1.012q.168-.493.27-1.011l-.98-.194q-.09.453-.237.884zM.824 11.54a8 8 0 0 0 .524.905l.83-.556a7 7 0 0 1-.458-.793zm13.828.905q.292-.434.524-.906l-.896-.443q-.205.413-.459.793zm-12.667.83q.346.394.74.74l.66-.752a7 7 0 0 1-.648-.648zm11.29.74q.394-.346.74-.74l-.752-.66q-.302.346-.648.648zm-1.735 1.161q.471-.233.905-.524l-.556-.83a7 7 0 0 1-.793.458zm-7.985-.524q.434.292.906.524l.443-.896a7 7 0 0 1-.793-.459zm1.873.925q.493.168 1.011.27l.194-.98a7 7 0 0 1-.884-.237zm4.132.271a8 8 0 0 0 1.012-.27l-.321-.948a7 7 0 0 1-.884.237l.194.98zm-2.083.135a8 8 0 0 0 1.046 0l-.064-.998a7 7 0 0 1-.918 0zM8.5 4.5a.5.5 0 0 0-1 0v3h-3a.5.5 0 0 0 0 1h3v3a.5.5 0 0 0 1 0v-3h3a.5.5 0 0 0 0-1h-3z"/>
									</svg>
									Create Project
								</button>
								<button
									onClick={handleCancelCreateProject}
									className="px-4 py-2 bg-[var(--base-200)] hover:bg-[var(--base-300)] text-[var(--base-700)] rounded-lg transition-colors"
								>
									Cancel
								</button>
							</div>
						</div>
					)}

					{createProjectStep === 'creating' && (
						<div className="flex flex-col items-center gap-4">
							<div className="w-8 h-8 border-4 border-[var(--acc-300)] border-t-[var(--acc-600)] rounded-full animate-spin"></div>
							<p className="text-sm text-[var(--base-600)]">Creating project directory and initializing git...</p>
						</div>
					)}
				</div>
			) : (
				/* Normal Project Selection */
				<div className="flex flex-wrap w-fit items-start gap-8">
					{/* OS Session Kind Selector */}
					<div className="flex-shrink-0 flex flex-col gap-4">
						<div className="flex items-center justify-between">
							<h2 className="text-lg font-medium text-[var(--base-700)]">Start</h2>
						</div>
						<div className="flex flex-col gap-4">
							<OsSessionKindSelector
								onSelect={handleKindSelect}
								selectedKind={selectedKind}
							/>
							
							{/* Action buttons - always show when selectedKind is available */}
							{selectedKind && (
								<div className="flex flex-col gap-1">
									<button
										onClick={handleSelectFromFilesystem}
										className="px-4 w-64 py-2 bg-[var(--base-200-30)] hover:bg-[var(--base-200-70)] text-[var(--blackest)] rounded-xl text-left cursor-pointer border-(length:--border) border-[var(--base-400-50)] transition-colors text-sm flex items-center gap-2"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-folder" viewBox="0 0 16 16">
											<path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.826a2 2 0 0 1-1.991-1.819l-.637-7a2 2 0 0 1 .342-1.31zM2.19 4a1 1 0 0 0-.996 1.09l.637 7a1 1 0 0 0 .995.91h10.348a1 1 0 0 0 .995-.91l.637-7A1 1 0 0 0 13.81 4zm4.69-1.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139q.323-.119.684-.12h5.396z"/>
										</svg>
										Open Project
									</button>
									<button
										onClick={handleCreateNewProject}
										className="px-4 w-64 py-2 bg-[var(--positive-200-30)] hover:bg-[var(--positive-200-70)] text-[var(--positive-800)] rounded-xl text-left cursor-pointer border-(length:--border) border-[var(--positive-400)] transition-colors text-sm flex items-center gap-2"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-plus-circle-dotted" viewBox="0 0 16 16">
											<path d="M8 0q-.264 0-.523.017l.064.998a7 7 0 0 1 .918 0l.064-.998A8 8 0 0 0 8 0M6.44.152q-.52.104-1.012.27l.321.948q.43-.147.884-.237L6.44.153zm4.132.271a8 8 0 0 0-1.011-.27l-.194.98q.453.09.884.237zm1.873.925a8 8 0 0 0-.906-.524l-.443.896q.413.205.793.459zM4.46.824q-.471.233-.905.524l.556.83a7 7 0 0 1 .793-.458zM2.725 1.985q-.394.346-.74.74l.752.66q.303-.345.648-.648zm11.29.74a8 8 0 0 0-.74-.74l-.66.752q.346.303.648.648zm1.161 1.735a8 8 0 0 0-.524-.905l-.83.556q.254.38.458.793l.896-.443zM1.348 3.555q-.292.433-.524.906l.896.443q.205-.413.459-.793zM.423 5.428a8 8 0 0 0-.27 1.011l.98.194q.09-.453.237-.884zM15.848 6.44a8 8 0 0 0-.27-1.012l-.948.321q.147.43.237.884zM.017 7.477a8 8 0 0 0 0 1.046l.998-.064a7 7 0 0 1 0-.918zM16 8a8 8 0 0 0-.017-.523l-.998.064a7 7 0 0 1 0 .918l.998.064A8 8 0 0 0 16 8M.152 9.56q.104.52.27 1.012l.948-.321a7 7 0 0 1-.237-.884l-.98.194zm15.425 1.012q.168-.493.27-1.011l-.98-.194q-.09.453-.237.884zM.824 11.54a8 8 0 0 0 .524.905l.83-.556a7 7 0 0 1-.458-.793zm13.828.905q.292-.434.524-.906l-.896-.443q-.205.413-.459.793zm-12.667.83q.346.394.74.74l.66-.752a7 7 0 0 1-.648-.648zm11.29.74q.394-.346.74-.74l-.752-.66q-.302.346-.648.648zm-1.735 1.161q.471-.233.905-.524l-.556-.83a7 7 0 0 1-.793.458zm-7.985-.524q.434.292.906.524l.443-.896a7 7 0 0 1-.793-.459zm1.873.925q.493.168 1.011.27l.194-.98a7 7 0 0 1-.884-.237zm4.132.271a8 8 0 0 0 1.012-.27l-.321-.948a7 7 0 0 1-.884.237l.194.98zm-2.083.135a8 8 0 0 0 1.046 0l-.064-.998a7 7 0 0 1-.918 0zM8.5 4.5a.5.5 0 0 0-1 0v3h-3a.5.5 0 0 0 0 1h3v3a.5.5 0 0 0 1 0v-3h3a.5.5 0 0 0 0-1h-3z"/>
										</svg>
										Create New
									</button>
								</div>
							)}
						</div>
					</div>


				</div>
			)}

			{/* Recent Projects Section - only show when not creating project */}
			{!isCreatingProject && (
				<RecentProjectsList 
					projects={store.gitProjects} 
					onProjectSelect={onProjectCreated}
				/>
			)}
		</div>
	);
}
