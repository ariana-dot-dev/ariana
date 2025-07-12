import { useState, useEffect } from "react";
import { GitProject } from "../types/GitProject";
import { OsSession, OsSessionKind, osSessionGetWorkingDirectory } from "../bindings/os";
import { invoke } from "@tauri-apps/api/core";
import { SingleChoiceList } from './ChoiceList';
import { cn } from "../utils";

interface RecentProjectsListProps {
	projects: GitProject[];
	onProjectSelect: (projectId: string) => void;
}

interface ValidatedProject {
	project: GitProject;
	isValid: boolean;
	displayPath: string;
	osSessionKind: OsSessionKind;
}

export function RecentProjectsList({ projects, onProjectSelect }: RecentProjectsListProps) {
	const [validatedProjects, setValidatedProjects] = useState<ValidatedProject[]>([]);
	const [isValidating, setIsValidating] = useState(false);

	useEffect(() => {
		validateProjects();
	}, [projects]);

	const validateProjects = async () => {
		console.log('RecentProjectsList: Validating projects:', projects.length, projects);
		if (projects.length === 0) return;
		
		setIsValidating(true);
		const validated: ValidatedProject[] = [];

		// Sort projects by lastModified date first (most recent first)
		const sortedProjects = [...projects].sort((a, b) => b.lastModified - a.lastModified);
		
		for (const project of sortedProjects) {
			const displayPath = osSessionGetWorkingDirectory(project.root);
			if (!displayPath) continue;

			// Determine OS session kind
			let osSessionKind: OsSessionKind;
			if ('Local' in project.root) {
				osSessionKind = 'Local';
			} else if ('Wsl' in project.root) {
				osSessionKind = { Wsl: project.root.Wsl.distribution };
			} else {
				continue;
			}

			// Check if directory still exists
			let isValid = false;
			try {
				// Use git repository check as a more reliable indicator
				// If it's a git repo, the directory exists and is accessible
				isValid = await invoke<boolean>('check_git_repository', {
					directory: displayPath,
					osSession: project.root
				});
			} catch (error) {
				// Directory doesn't exist, is inaccessible, or is not a git repo
				isValid = false;
			}

			validated.push({
				project,
				isValid,
				displayPath,
				osSessionKind
			});
		}

		// Only show valid projects (already sorted by lastModified)
		const validProjects = validated.filter(v => v.isValid);

		setValidatedProjects(validProjects);
		setIsValidating(false);
	};

	const formatOsSessionKind = (kind: OsSessionKind): string => {
		if (typeof kind === 'string') {
			return kind;
		} else if ('Wsl' in kind) {
			return `WSL: ${kind.Wsl}`;
		}
		return 'Unknown';
	};

	const formatDate = (timestamp: number): string => {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

		if (diffDays === 0) {
			return 'Today';
		} else if (diffDays === 1) {
			return 'Yesterday';
		} else if (diffDays < 7) {
			return `${diffDays} days ago`;
		} else {
			return date.toLocaleDateString();
		}
	};

	if (projects.length === 0) {
		return null;
	}

	return (
		<div className="w-fit max-w-full">
			<div className="flex flex-col gap-2 mb-4">
				<h2 className="text-lg font-medium text-[var(--base-700)]">Recent Projects</h2>
			</div>

			{validatedProjects.length === 0 && !isValidating ? (
				<div className="text-sm text-[var(--base-500)] italic">
					No recent projects available or all projects are inaccessible
				</div>
			) : (
				<SingleChoiceList
					items={validatedProjects}
					selectedItemId={null} // No selection needed for recent projects
					onSelectItem={(projectId) => {
						if (projectId) {
							const validatedProject = validatedProjects.find(vp => vp.project.id === projectId);
							if (validatedProject) {
								onProjectSelect(validatedProject.project.id);
							}
						}
					}}
					getItemId={(validatedProject) => validatedProject.project.id}
					className={cn("max-h-60 overflow-y-auto pr-2")}
					renderItem={(validatedProject, isSelected) => (
						<div className="flex w-80 max-w-full items-center justify-between">
							<div className="flex-1 min-w-0">
								<div className="font-medium text-[var(--base-800)] truncate">
									{validatedProject.project.name}
								</div>
								<div className="text-sm text-[var(--base-600)] font-mono truncate">
									{validatedProject.displayPath}
								</div>
							</div>
							<div className="flex-shrink-0 text-right">
								<div className="text-xs bg-[var(--base-200)] text-[var(--base-700)] px-2 py-1 rounded mb-1">
									{formatOsSessionKind(validatedProject.osSessionKind)}
								</div>
								<div className="text-xs text-[var(--base-500)]">
									{formatDate(validatedProject.project.lastModified)}
								</div>
							</div>
						</div>
					)}
				/>
			)}
		</div>
	);
}
