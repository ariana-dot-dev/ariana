import { memo, useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileEntry } from './DiffView';

interface DiffFileTreeProps {
  files: FileEntry[];
  selectedFiles: Set<string>;
  onToggleFile: (path: string) => void;
  onToggleFolder: (folderPrefix: string) => void;
  onToggleAll: () => void;
}

interface TreeNode {
  name: string;
  fullPath: string; // for folders: "backend/src/", for files: "backend/src/foo.ts"
  children: TreeNode[];
  file?: FileEntry; // only set for leaf nodes
}

/** Build a tree from flat file paths */
function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', fullPath: '', children: [] };

  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const fullPath = isFile ? file.path : parts.slice(0, i + 1).join('/') + '/';

      let child = current.children.find(c => c.name === part);
      if (!child) {
        child = {
          name: part,
          fullPath,
          children: [],
          file: isFile ? file : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Collapse single-child folder chains: "backend" -> "src" -> files becomes "backend/src" -> files
  function collapse(node: TreeNode): TreeNode {
    // First collapse children
    node.children = node.children.map(collapse);

    // If this is a folder with exactly one child that is also a folder, merge them
    if (!node.file && node.children.length === 1 && !node.children[0].file) {
      const child = node.children[0];
      return {
        name: node.name ? `${node.name}/${child.name}` : child.name,
        fullPath: child.fullPath,
        children: child.children,
      };
    }

    return node;
  }

  const collapsed = collapse(root);
  return collapsed.children;
}

function FileIcon({ isNew, isDeleted }: { isNew: boolean; isDeleted: boolean }) {
  if (isNew) {
    return <span className="text-[10px] font-bold text-constructive-foreground w-3 text-center flex-shrink-0">+</span>;
  }
  if (isDeleted) {
    return <span className="text-[10px] font-bold text-destructive-foreground w-3 text-center flex-shrink-0">-</span>;
  }
  return <span className="text-[10px] font-bold text-accent w-3 text-center flex-shrink-0">o</span>;
}

function TreeNodeRow({
  node,
  depth,
  selectedFiles,
  allFiles,
  onToggleFile,
  onToggleFolder,
}: {
  node: TreeNode;
  depth: number;
  selectedFiles: Set<string>;
  allFiles: FileEntry[];
  onToggleFile: (path: string) => void;
  onToggleFolder: (folderPrefix: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isFile = !!node.file;
  const isNoneSelected = selectedFiles.size === 0;

  if (isFile) {
    const file = node.file!;
    const isSelected = selectedFiles.has(file.path);

    return (
      <button
        onClick={() => onToggleFile(file.path)}
        className={cn(
          "flex items-center gap-1.5 w-full text-left rounded px-1 py-[1px] transition-colors",
          "hover:bg-muted/40",
          isSelected && "bg-muted/30"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <FileIcon isNew={file.isNew} isDeleted={file.isDeleted} />
        <span className={cn(
          "text-[11px] truncate flex-1 transition-colors",
          isSelected ? "text-foreground" : isNoneSelected ? "text-muted-foreground" : "text-muted-foreground/50"
        )}>
          {node.name}
        </span>
        <span className="flex-shrink-0 text-[10px] tabular-nums whitespace-nowrap">
          {file.additions > 0 && (
            <span className="text-constructive-foreground">+{file.additions}</span>
          )}
          {file.additions > 0 && file.deletions > 0 && <span className="text-muted-foreground/30 mx-0.5"> </span>}
          {file.deletions > 0 && (
            <span className="text-destructive-foreground">-{file.deletions}</span>
          )}
        </span>
      </button>
    );
  }

  // Folder node
  const filesInFolder = allFiles.filter(f => f.path.startsWith(node.fullPath));
  const folderAdditions = filesInFolder.reduce((sum, f) => sum + f.additions, 0);
  const folderDeletions = filesInFolder.reduce((sum, f) => sum + f.deletions, 0);
  const allFolderFilesSelected = filesInFolder.length > 0 && filesInFolder.every(f => selectedFiles.has(f.path));
  const someFolderFilesSelected = filesInFolder.some(f => selectedFiles.has(f.path));

  return (
    <div>
      <div
        onClick={() => onToggleFolder(node.fullPath)}
        className={cn(
          "flex items-center gap-1.5 w-full text-left rounded px-1 py-[1px] transition-colors cursor-pointer",
          "hover:bg-muted/40",
          allFolderFilesSelected && "bg-muted/20"
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <span
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex-shrink-0 text-muted-foreground/50 hover:text-muted-foreground cursor-pointer"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
        <span className={cn(
          "text-[11px] truncate flex-1 transition-colors",
          allFolderFilesSelected ? "text-foreground" : someFolderFilesSelected ? "text-foreground/70" : isNoneSelected ? "text-muted-foreground" : "text-muted-foreground/50"
        )}>
          {node.name}
        </span>
        <span className="flex-shrink-0 text-[10px] tabular-nums whitespace-nowrap">
          {folderAdditions > 0 && (
            <span className="text-constructive-foreground">+{folderAdditions}</span>
          )}
          {folderAdditions > 0 && folderDeletions > 0 && <span className="text-muted-foreground/30 mx-0.5"> </span>}
          {folderDeletions > 0 && (
            <span className="text-destructive-foreground">-{folderDeletions}</span>
          )}
        </span>
      </div>
      {expanded && (
        <div>
          {node.children.map(child => (
            <TreeNodeRow
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              selectedFiles={selectedFiles}
              allFiles={allFiles}
              onToggleFile={onToggleFile}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const DiffFileTree = memo(function DiffFileTree({ files, selectedFiles, onToggleFile, onToggleFolder, onToggleAll }: DiffFileTreeProps) {
  const [collapsed, setCollapsed] = useState(false);
  const tree = useMemo(() => buildTree(files), [files]);

  if (files.length === 0) return null;

  return (
    <div className="rounded-md border border-border/50 bg-background overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(prev => !prev)}
        className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <div className="flex items-center gap-1.5">
          {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>Filter Files</span>
          <span className="text-muted-foreground/60">({files.length})</span>
        </div>
        {!collapsed && (
          <div className="flex items-center" onClick={e => e.stopPropagation()}>
            <button
              onClick={onToggleAll}
              className={cn(
                "text-[10px] transition-colors",
                selectedFiles.size > 0 ? "text-accent hover:text-accent/80" : "text-muted-foreground/60 hover:text-foreground"
              )}
            >
              all
            </button>
          </div>
        )}
      </button>

      {/* Tree */}
      {!collapsed && (
        <div className="px-2 pb-2.5 max-h-[400px] overflow-y-auto">
          {tree.map(node => (
            <TreeNodeRow
              key={node.fullPath}
              node={node}
              depth={0}
              selectedFiles={selectedFiles}
              allFiles={files}
              onToggleFile={onToggleFile}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
});
