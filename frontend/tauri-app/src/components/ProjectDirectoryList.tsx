import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, useRef } from "react";
import { OsSessionKind } from "../bindings/os";
import { cn } from "../utils";
import { GitProject } from "../types/GitProject";
import { useStore } from "../state";

interface GitSearchResult {
	directories: string[];
	is_complete: boolean;
}

interface ProjectDirectoryListProps {
	osSessionKind: OsSessionKind;
	onSelect: (path: string) => void;
	selectedPath?: string;
	existingProjects?: GitProject[];
}

export function ProjectDirectoryList({
	osSessionKind,
	onSelect,
	selectedPath,
	existingProjects = [],
}: ProjectDirectoryListProps) {
	const [directories, setDirectories] = useState<string[]>([]);
	const [searchId, setSearchId] = useState<string | null>(null);
	const [isComplete, setIsComplete] = useState(false);
	const [loading, setLoading] = useState(true);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		path: string;
	} | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const { removeGitProject } = useStore();

	useEffect(() => {
		const startSearch = async () => {
			try {
				setLoading(true);
				const id = await invoke<string>("start_git_directories_search", {
					osSessionKind,
				});
				setSearchId(id);
			} catch (error) {
				console.error("Failed to start git directories search:", error);
				setLoading(false);
			}
		};

		startSearch();

		// Reset state when osSessionKind changes
		setDirectories([]);
		setIsComplete(false);
	}, [osSessionKind]);

	useEffect(() => {
		if (!searchId || isComplete) return;

		const pollResults = async () => {
			try {
				console.log("Frontend - Polling for results with searchId:", searchId);
				const result = await invoke<GitSearchResult>(
					"get_found_git_directories_so_far",
					{
						searchId,
					},
				);
				console.log("Frontend - Received result from backend:", result);
				setDirectories(result.directories);
				setIsComplete(result.is_complete);
				setLoading(false);
			} catch (error) {
				console.error("Failed to get search results:", error);
				setLoading(false);
			}
		};

		// Poll immediately
		pollResults();

		// Set up polling interval
		const interval = setInterval(pollResults, 500);

		return () => clearInterval(interval);
	}, [searchId, isComplete]);

	const getDirectoryName = (path: string): string => {
		return path.split("/").pop() || path.split("\\").pop() || path;
	};

	const isPathAlreadyInProject = (path: string): boolean => {
		for (const project of existingProjects) {
			const rootPath =
				"Local" in project.root
					? project.root.Local
					: "Wsl" in project.root
						? project.root.Wsl.working_directory
						: null;

			// Don't filter out the project root - we want users to be able to select it to reopen the project
			if (rootPath === path) {
				return false; // Keep the root directory visible
			}

			// Filter out any path that's a canvas osSession (derived directory)
			for (const canvas of project.canvases) {
				if (!canvas.osSession) continue;
				const canvasPath =
					"Local" in canvas.osSession
						? canvas.osSession.Local
						: "Wsl" in canvas.osSession
							? canvas.osSession.Wsl.working_directory
							: null;
				if (canvasPath === path) {
					return true; // Filter out derived directories
				}
			}
		}
		return false; // Keep paths that aren't in any project
	};

	// Filter out directories that are already in existing projects
	const filteredDirectories = directories.filter((path) => {
		const isFiltered = isPathAlreadyInProject(path);
		console.log(`Directory filter: ${path} - filtered: ${isFiltered}`);
		return !isFiltered;
	});

	console.log("All found directories:", directories);
	console.log("Existing projects count:", existingProjects.length);
	console.log(
		"Existing projects:",
		existingProjects.map((p) => ({
			name: p.name,
			root: "Local" in p.root ? p.root.Local : p.root.Wsl.working_directory,
			canvases: p.canvases.map((c) =>
				c.osSession
					? "Local" in c.osSession
						? c.osSession.Local
						: c.osSession.Wsl.working_directory
					: "no osSession",
			),
		})),
	);
	console.log("Filtered directories:", filteredDirectories);

	// Handle right-click context menu
	const handleContextMenu = (e: React.MouseEvent, path: string) => {
		e.preventDefault();
		e.stopPropagation();
		setContextMenu({
			x: e.clientX,
			y: e.clientY,
			path,
		});
	};

	// Close context menu when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				contextMenuRef.current &&
				!contextMenuRef.current.contains(event.target as Node)
			) {
				setContextMenu(null);
			}
		};

		if (contextMenu) {
			document.addEventListener("mousedown", handleClickOutside);
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [contextMenu]);

	// Show in explorer functionality
	const showInExplorer = async (path: string) => {
		try {
			let explorerPath = path;

			// Handle WSL paths
			if (typeof osSessionKind === "object" && "Wsl" in osSessionKind) {
				// Convert WSL path to Windows explorer path
				// Format: \\wsl$\<distribution>\path
				const distribution = osSessionKind.Wsl;
				explorerPath = `\\\\wsl$\\${distribution}${path.replace(/\//g, "\\")}`;
			}

			// Open in system file explorer
			await invoke("open_path_in_explorer", { path: explorerPath });
		} catch (error) {
			console.error("Failed to open in explorer:", error);
		}
		setContextMenu(null);
	};

	// Delete project functionality
	const deleteProject = async (path: string) => {
		console.log("deleteProject called with path:", path);
		console.log("existingProjects:", existingProjects);
		try {
			// Find project with matching path
			const projectToDelete = existingProjects.find((project) => {
				const projectPath =
					"Local" in project.root
						? project.root.Local
						: "Wsl" in project.root
							? project.root.Wsl.working_directory
							: null;
				return projectPath === path;
			});

			if (projectToDelete) {
				const confirmed = window.confirm(
					`Are you sure you want to permanently delete the project "${projectToDelete.name}" and all its files? This action cannot be undone.`,
				);
				if (confirmed) {
					// Create an osSession based on the osSessionKind
					let projectOsSession;
					if (typeof osSessionKind === "object" && "Wsl" in osSessionKind) {
						projectOsSession = {
							Wsl: {
								distribution: osSessionKind.Wsl,
								working_directory: path,
							},
						};
					} else {
						projectOsSession = { Local: path };
					}

					// Delete from filesystem first using osSession-aware deletion
					await invoke("delete_path_with_os_session", {
						path,
						osSession: projectOsSession,
					});
					// Then remove from workspace
					removeGitProject(projectToDelete.id);
					console.log(
						`Deleted project from filesystem and workspace: ${projectToDelete.name}`,
					);

					setDirectories((prev) => prev.filter((dir) => dir !== path));
				}
			} else {
				// just delete the path if no project found
				const confirmed = window.confirm(
					`Are you sure you want to permanently delete the directory "${path}" and all its files? This action cannot be undone.`,
				);
				if (!confirmed) return;

				// Create an osSession based on the osSessionKind
				let projectOsSession;
				if (typeof osSessionKind === "object" && "Wsl" in osSessionKind) {
					projectOsSession = {
						Wsl: {
							distribution: osSessionKind.Wsl,
							working_directory: path,
						},
					};
				} else {
					projectOsSession = { Local: path };
				}

				// Delete from filesystem first using osSession-aware deletion
				await invoke("delete_path_with_os_session", {
					path,
					osSession: projectOsSession,
				});

				setDirectories((prev) => prev.filter((dir) => dir !== path));
			}
		} catch (error) {
			console.error("Failed to delete project:", error);
			alert(`Failed to delete project: ${error}`);
		}
		setContextMenu(null);
	};

	return (
		<div className="flex flex-col gap-2 p-4 h-fit max-h-full">
			<div className="flex items-center gap-2">
				<h3 className="text-lg font-semibold text-[var(--blackest)]">
					Repositories
				</h3>
				{!isComplete && (
					<div className="w-4 h-4 border-2 border-[var(--acc-400)] border-t-transparent rounded-full animate-spin"></div>
				)}
			</div>

			{loading && filteredDirectories.length === 0 ? (
				<div className="flex justify-center p-4">
					<span className="text-[var(--base-500)]">
						Searching for repositories...
					</span>
				</div>
			) : filteredDirectories.length === 0 ? (
				<div className="flex justify-center p-4">
					<span className="text-[var(--base-500)]">
						{directories.length === 0
							? "No repositories found"
							: "All repositories are already open"}
					</span>
				</div>
			) : (
				<div className="flex flex-col gap-1 h-fit max-h-full overflow-y-auto overflow-x-hidden p-1">
					{filteredDirectories.map((path, index) => (
						<button
							key={index}
							onClick={() => onSelect(path)}
							onContextMenu={(e) => handleContextMenu(e, path)}
							className={cn(
								"p-3 rounded-md text-left transition-colors relative",
								"border-2 border-[var(--base-400-50)]",
								selectedPath === path
									? "bg-[var(--acc-400-50)] text-[var(--acc-900)] border-[var(--acc-500-50)]"
									: "bg-[var(--base-200-50)] hover:bg-[var(--base-300-50)] text-[var(--blackest)] cursor-pointer",
							)}
						>
							<div className="mb-0.5">{getDirectoryName(path)}</div>
							<div className="font-mono text-sm opacity-20">{path}</div>
						</button>
					))}
				</div>
			)}

			{isComplete && (
				<div className="text-sm text-[var(--base-500)] mt-2">
					Search complete • Found {directories.length} project
					{directories.length !== 1 ? "s" : ""}
					{filteredDirectories.length !== directories.length &&
						`• ${directories.length - filteredDirectories.length} already open`}
				</div>
			)}

			{/* Context Menu */}
			{contextMenu && (
				<div
					ref={contextMenuRef}
					className="fixed z-50 bg-[var(--base-100)] border border-[var(--acc-600)]/20 rounded-md shadow-lg py-1 min-w-[150px]"
					style={{
						left: contextMenu.x,
						top: contextMenu.y,
					}}
				>
					<button
						onClick={() => showInExplorer(contextMenu.path)}
						className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--base-200)] text-[var(--blackest)] transition-colors"
					>
						📁 Show in Explorer
					</button>
					<button
						onClick={async () => {
							console.log("Delete button clicked");
							await deleteProject(contextMenu.path);
						}}
						className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--negative-200)] text-[var(--negative-800)] transition-colors"
					>
						🗑️ Delete Project
					</button>
				</div>
			)}
		</div>
	);
}
