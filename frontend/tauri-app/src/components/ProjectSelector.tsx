import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { OsSession, OsSessionKind } from "../bindings/os";
import { useStore } from "../state";
import { OsSessionKindSelector } from "./OsSessionKindSelector";
import { ProjectDirectoryList } from "./ProjectDirectoryList";
import { GitProject } from "../types/GitProject";

interface ProjectSelectorProps {
	onProjectCreated: (projectId: string) => void;
}

export function ProjectSelector({ onProjectCreated }: ProjectSelectorProps) {
	const store = useStore();
	const [selectedKind, setSelectedKind] = useState<OsSessionKind | undefined>();
	const [selectedPath, setSelectedPath] = useState<string | undefined>();

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
				// For WSL, use Windows path that allows access to WSL content
				defaultPath = `\\\\wsl$\\${selectedKind.Wsl}`;
			}

			// Open directory picker dialog
			const selectedDir = await open({
				directory: true,
				multiple: false,
				defaultPath: defaultPath || undefined,
			});

			if (selectedDir && typeof selectedDir === 'string') {
				let convertedPath = selectedDir;

				// Convert Windows path to WSL format if needed
				if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
					// Handle \\wsl$\distribution\path format
					if (selectedDir.startsWith(`\\\\wsl$\\${selectedKind.Wsl}\\`)) {
						// Convert \\wsl$\distribution\path to /path
						const pathAfterDistribution = selectedDir.substring(`\\\\wsl$\\${selectedKind.Wsl}\\`.length);
						convertedPath = '/' + pathAfterDistribution.replace(/\\/g, '/');
					}
					// Handle regular Windows drive paths (C:\ style)
					else if (selectedDir.match(/^[A-Za-z]:\\/)) {
						const drive = selectedDir.charAt(0).toLowerCase();
						const pathWithoutDrive = selectedDir.substring(3).replace(/\\/g, '/');
						convertedPath = `/mnt/${drive}/${pathWithoutDrive}`;
					}
				}

				setSelectedPath(convertedPath);
			}
		} catch (error) {
			console.error("Failed to open directory picker:", error);
		}
	};

	const handleCreateNewProject = async () => {
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
				defaultPath = `\\\\wsl$\\${selectedKind.Wsl}`;
			}

			// Open directory picker to select parent directory
			const parentDir = await open({
				directory: true,
				multiple: false,
				defaultPath: defaultPath || undefined,
			});

			if (parentDir && typeof parentDir === 'string') {
				// Prompt for new project name
				const projectName = prompt("Enter new project name:");
				if (!projectName || projectName.trim() === '') return;

				const sanitizedName = projectName.trim().replace(/[<>:"/\\|?*]/g, '-');
				
				let convertedParentPath = parentDir;
				let projectPath = "";

				// Convert Windows path to WSL format if needed
				if (typeof selectedKind === "object" && "Wsl" in selectedKind) {
					// Handle \\wsl$\distribution\path format
					if (parentDir.startsWith(`\\\\wsl$\\${selectedKind.Wsl}\\`)) {
						// Convert \\wsl$\distribution\path to /path
						const pathAfterDistribution = parentDir.substring(`\\\\wsl$\\${selectedKind.Wsl}\\`.length);
						convertedParentPath = '/' + pathAfterDistribution.replace(/\\/g, '/');
					}
					// Handle regular Windows drive paths (C:\ style)
					else if (parentDir.match(/^[A-Za-z]:\\/)) {
						const drive = parentDir.charAt(0).toLowerCase();
						const pathWithoutDrive = parentDir.substring(3).replace(/\\/g, '/');
						convertedParentPath = `/mnt/${drive}/${pathWithoutDrive}`;
					}
					projectPath = `${convertedParentPath}/${sanitizedName}`;
				} else {
					// For Local sessions
					const separator = parentDir.includes('/') ? '/' : '\\';
					projectPath = `${convertedParentPath}${separator}${sanitizedName}`;
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
					console.error("Invalid OS session kind");
					return;
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

				// Set the path as selected
				setSelectedPath(projectPath);
			}
		} catch (error) {
			console.error("Failed to create new project:", error);
			alert(`Failed to create new project: ${error}`);
		}
	};

	const handleGitInitIfNeeded = async (path: string) => {
		if (!selectedKind) return;

		try {
			// Check if it's already a git repository
			const isGitRepo = await invoke<boolean>("check_git_repository", { directory: path });
			
			if (!isGitRepo) {
				const shouldInit = confirm("This directory is not a git repository. Would you like to initialize git?");
				if (shouldInit) {
					// Create OsSession for git init
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

	const canProceed = selectedKind && selectedPath;

	return (
		<div className="flex flex-col items-center justify-center w-full h-full max-h-full">
			<div className="flex justify-center items-center gap-8 max-w-4xl w-full h-full max-h-full">
				{/* OS Session Kind Selector */}
				<div
					className="flex-shrink-0"
					style={{ width: selectedKind ? "300px" : "400px" }}
				>
					<OsSessionKindSelector
						onSelect={handleKindSelect}
						selectedKind={selectedKind}
					/>
					
					{/* Filesystem picker buttons - only show when OS kind is selected */}
					{selectedKind && (
						<div className="mt-4 p-4 border-t border-[var(--base-400-50)]">
							<div className="flex flex-col gap-2">
								<button
									onClick={handleSelectFromFilesystem}
									className="px-4 py-2 bg-[var(--base-200-50)] hover:bg-[var(--base-300-50)] text-[var(--blackest)] rounded-md border-2 border-[var(--base-400-50)] transition-colors text-sm"
								>
									📁 Select from Filesystem
								</button>
								<button
									onClick={handleCreateNewProject}
									className="px-4 py-2 bg-[var(--positive-200)] hover:bg-[var(--positive-300)] text-[var(--positive-800)] rounded-md border-2 border-[var(--positive-400)] transition-colors text-sm"
								>
									➕ Create New Project
								</button>
							</div>
						</div>
					)}
				</div>

				{/* Project Directory List - only show when kind is selected */}
				{selectedKind && (
					<div className="flex-1 h-full max-h-full">
						<ProjectDirectoryList
							osSessionKind={selectedKind}
							onSelect={handlePathSelect}
							selectedPath={selectedPath}
							existingProjects={store.gitProjects}
						/>
					</div>
				)}
			</div>

			{/* Selected Path Display and Open Button */}
			{selectedPath && (
				<div className="mt-6 flex flex-col items-center gap-3">
					<div className="text-sm text-[var(--base-600)] max-w-2xl text-center">
						<div className="font-medium">Selected:</div>
						<div className="font-mono text-xs bg-[var(--base-100)] p-2 rounded border">{selectedPath}</div>
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
	);
}
