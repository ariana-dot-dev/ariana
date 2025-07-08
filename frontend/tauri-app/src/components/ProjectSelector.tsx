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
	const [selectedPath, setSelectedPath] = useState<string | undefined>();
	
	// Create project flow state
	const [isCreatingProject, setIsCreatingProject] = useState(false);
	const [createProjectStep, setCreateProjectStep] = useState<'selectLocation' | 'enterName' | 'creating'>('selectLocation');
	const [selectedParentDir, setSelectedParentDir] = useState<string>('');
	const [projectName, setProjectName] = useState<string>('');
	const [createProjectError, setCreateProjectError] = useState<string>('');

	const handleKindSelect = (kind: OsSessionKind) => {
		setSelectedKind(kind);
		setSelectedPath(undefined); // Reset path when kind changes
	};

	const handlePathSelect = (path: string) => {
		setSelectedPath(path);
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

				setSelectedPath(convertedPath);
			}
		} catch (error) {
			console.error("Failed to open directory picker:", error);
			alert("Failed to open directory picker. Please try again.");
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

	const handleCreateSession = async () => {
		if (!selectedKind || !selectedPath) return;

		// Check if git init is needed before creating session
		await handleGitInitIfNeeded(selectedPath);

		// First, check if there's an existing project that covers this path
		const existingProject = findExistingProjectForPath(selectedPath);
		if (existingProject) {
			console.log("Found existing project for path:", selectedPath, existingProject);
			onProjectCreated(existingProject.id);
			return;
		}

		// Create OsSession based on selected kind and path
		let osSession: OsSession;
		if (selectedKind === "Local") {
			osSession = { Local: selectedPath };
		} else if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
			osSession = {
				Wsl: {
					distribution: selectedKind.Wsl,
					working_directory: selectedPath,
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
									className="flex-1 px-4 py-2 bg-[var(--positive-400)] hover:bg-[var(--positive-500)] disabled:bg-[var(--base-300)] disabled:text-[var(--base-500)] text-[var(--whitest)] rounded-lg transition-colors"
								>
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
										className="px-4 w-64 py-2 bg-[var(--base-200-30)] hover:bg-[var(--base-200-70)] text-[var(--blackest)] rounded-xl text-left cursor-pointer border-(length:--border) border-[var(--base-400-50)] transition-colors text-sm"
									>
										Open existing Project
									</button>
									<button
										onClick={handleCreateNewProject}
										className="px-4 w-64 py-2 bg-[var(--positive-200-30)] hover:bg-[var(--positive-200-70)] text-[var(--positive-800)] rounded-xl text-left cursor-pointer border-(length:--border) border-[var(--positive-400)] transition-colors text-sm"
									>
										+ Create new Project
									</button>
								</div>
							)}
						</div>
					</div>

					{/* Selected Path Display and Open Button */}
					{selectedPath && (
						<div className="w-64 flex-shrink-0 flex flex-col items-center gap-3">
							<div className="text-sm text-[var(--base-600)] w-full text-center">
								<div className="font-medium mb-2">Selected: {selectedPath}</div>
							</div>
							<button
								onClick={handleCreateSession}
								className="px-6 py-3 bg-[var(--acc-400)] hover:bg-[var(--acc-500)] text-[var(--whitest)] rounded-md transition-colors"
							>
								Open Project
							</button>
						</div>
					)}
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
