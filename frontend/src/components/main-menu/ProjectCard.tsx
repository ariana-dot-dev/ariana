import { useState } from "react";
import { GradientPattern } from "@/components/ui/gradient-pattern.tsx";
import { ProjectWorkspace } from "@/stores/useAppStore";
import { MoreHorizontalIcon, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ProjectCardProps {
  projectWorkspace: ProjectWorkspace;
  onClick?: (project: ProjectWorkspace) => void;
  onDelete?: (project: ProjectWorkspace) => void;
}

const COLORS = [
  '#14B8A6', // Teal
  '#993bc2', // Purple
  '#FF6B6B', // Red
  '#c2862c', // Amber
  '#2564c2', // Blue
  '#29c993', // Emerald
  '#696d84', // Showers
];

export function ProjectCard({ projectWorkspace, onClick, onDelete }: ProjectCardProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleClick = () => {
    if (!dropdownOpen) {
      onClick?.(projectWorkspace);
    }
  };

  // Simple hash function to convert string ID to number
  const hashString = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    const result = Math.abs(hash);
    return result;
  };

  // Use project id hash to consistently select a gradient
  const colorIndex = hashString(projectWorkspace.id) % COLORS.length;
  const color = COLORS[colorIndex] || COLORS[0];

  return (
    <div
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDropdownOpen(true);
      }}
      className="group flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 hover:bg-background-darker"
    >
      <div className="flex-shrink-0">
          <GradientPattern className={`w-8 h-8 rounded-md`} baseColor={color}/>
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">
          {projectWorkspace.relativePath && projectWorkspace.relativePath !== '' ? (
            <>
              <span>{projectWorkspace.name}</span>
              <span className="ml-2 text-muted-foreground">{projectWorkspace.relativePath + "/"}</span>
            </>
          ) : (
            projectWorkspace.name
          )}
        </div>
        <div className="text-xs text-muted-foreground capitalize">
          {projectWorkspace.repositoryId ? (
            projectWorkspace.localPath ? 'Local project synced with GitHub' : 'Remote project synced with GitHub'
          ) : (
            projectWorkspace.localPath ? 'Local project not synced with GitHub' : 'Remote project not synced with GitHub'
          ) }
        </div>
      </div>

      <DropdownMenu modal={false} open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className="px-2 z-10 group-hover:text-foreground/50 text-muted-foreground/0"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontalIcon className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px] border-(length:--border-width) border-muted/30">
          <DropdownMenuItem
            variant="transparent"
            hoverVariant="destructive"
            onClick={(e) => {
              e.stopPropagation();
              setDropdownOpen(false);
              onDelete?.(projectWorkspace);
            }}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
