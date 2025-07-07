import React, { useState, useEffect, useRef, useCallback, JSX } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DiffSummary, MainLogicChange, DiffChange, SubLogicPath, GitDiffFile, GitDiffLine, GitBranch, GitCommit, BranchComparison, GitDiffHunk } from "../types/diff";
import { diffService } from "../services/DiffService";
import { cn } from "../utils";
import { useGitProject } from "../contexts/GitProjectContext";
import { osSessionGetWorkingDirectory } from "../bindings/os";

interface DiffManagementProps {
  onClose: () => void;
  initialState?: any;
  onStateChange?: (state: any) => void;
  mainTitlebarVisible?: boolean;
}

export default function DiffManagement({ onClose, initialState, onStateChange, mainTitlebarVisible }: DiffManagementProps) {
  console.log("[DIFFMANAGEMENT] Component rendering...");
  
  let { selectedGitProject } = useGitProject();
  console.log("[DIFFMANAGEMENT] Selected git project:", selectedGitProject);
  
  // Add safety check for git project
  if (!selectedGitProject) {
    console.warn("[DIFFMANAGEMENT] No git project available");
    return (
      <div className="flex-1 flex flex-col h-full bg-[var(--base-100)] p-8">
        <h1 className="text-2xl text-[var(--acc-600)] mb-4">No Git Project</h1>
        <p className="text-[var(--base-600)] mb-4">Please select a git repository first.</p>
        <button onClick={onClose} className="px-4 py-2 bg-[var(--acc-500)] text-white rounded">Close</button>
      </div>
    );
  }
  
  // Add global error logging
  useEffect(() => {
    const handleError = (error: ErrorEvent) => {
      console.error("[COMPONENT] Global error caught:", error.error);
      console.error("[COMPONENT] Error message:", error.message);
      console.error("[COMPONENT] Error filename:", error.filename);
      console.error("[COMPONENT] Error line:", error.lineno);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error("[COMPONENT] Unhandled promise rejection:", event.reason);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(initialState?.diffSummary ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChange, setSelectedChange] = useState<string | null>(initialState?.selectedChange ?? null);
  const [selectedSubLogic, setSelectedSubLogic] = useState<string | null>(initialState?.selectedSubLogic ?? null);
  const [viewMode, setViewMode] = useState<'overview' | 'detailed'>(initialState?.viewMode ?? 'overview');
  const [currentFileIndex, setCurrentFileIndex] = useState(initialState?.currentFileIndex ?? 0);
  const [currentLineIndex, setCurrentLineIndex] = useState(initialState?.currentLineIndex ?? 0);
  
  // Branch selection state
  const [showBranchSelection, setShowBranchSelection] = useState(initialState?.showBranchSelection ?? true);
  const [branches, setBranches] = useState<GitBranch[]>(initialState?.branches ?? []);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [selectedBaseBranch, setSelectedBaseBranch] = useState<string>(initialState?.selectedBaseBranch ?? "");
  const [selectedTargetBranch, setSelectedTargetBranch] = useState<string>(initialState?.selectedTargetBranch ?? "");
  const [selectedBaseCommit, setSelectedBaseCommit] = useState<string>(initialState?.selectedBaseCommit ?? "");
  const [selectedTargetCommit, setSelectedTargetCommit] = useState<string>(initialState?.selectedTargetCommit ?? "");
  const [baseBranchCommits, setBaseBranchCommits] = useState<GitCommit[]>(initialState?.baseBranchCommits ?? []);
  const [targetBranchCommits, setTargetBranchCommits] = useState<GitCommit[]>(initialState?.targetBranchCommits ?? []);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [showUnifiedDiff, setShowUnifiedDiff] = useState(false);
  const [unifiedDiffContent, setUnifiedDiffContent] = useState<string>("");
  const [showHeader, setShowHeader] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<{ changeId: string, fileIndex: number, hunkIndex: number, hunk: GitDiffHunk, context: string }[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Initialize diff service with current git project directory
  useEffect(() => {
    console.log("[COMPONENT] Git project:", selectedGitProject);
    if (selectedGitProject?.root) {
      const workingDirectory = osSessionGetWorkingDirectory(selectedGitProject.root);
      if (workingDirectory) {
        console.log("[COMPONENT] Setting diff service working directory to:", workingDirectory);
        diffService.setWorkingDirectory(workingDirectory);
        // Auto-load branches when git project is available
        loadBranches();
      } else {
        console.warn("[COMPONENT] Could not extract working directory from git project");
        setBranchesError("Could not extract working directory from git project.");
      }
    } else {
      console.warn("[COMPONENT] No git project available");
      setBranchesError("No git project selected. Please select a git repository first.");
    }
  }, [selectedGitProject]);

  // Log state restoration for debugging
  useEffect(() => {
    if (initialState) {
      console.log("DiffManagement initialized with saved state:", initialState);
    }
  }, []);

  // Load commits when base branch changes
  useEffect(() => {
    if (selectedBaseBranch) {
      console.log(`Loading commits for base branch: ${selectedBaseBranch}`);
      loadBranchCommits(selectedBaseBranch, true);
    }
  }, [selectedBaseBranch]);

  // Load commits when target branch changes
  useEffect(() => {
    if (selectedTargetBranch) {
      console.log(`Loading commits for target branch: ${selectedTargetBranch}`);
      loadBranchCommits(selectedTargetBranch, false);
    }
  }, [selectedTargetBranch]);

  // Save state whenever it changes
  useEffect(() => {
    if (onStateChange) {
      const currentState = {
        diffSummary,
        selectedChange,
        selectedSubLogic,
        viewMode,
        currentFileIndex,
        currentLineIndex,
        showBranchSelection,
        branches,
        selectedBaseBranch,
        selectedTargetBranch,
        selectedBaseCommit,
        selectedTargetCommit
      };
      onStateChange(currentState);
    }
  }, [
    diffSummary,
    selectedChange,
    selectedSubLogic,
    viewMode,
    currentFileIndex,
    currentLineIndex,
    showBranchSelection,
    branches,
    selectedBaseBranch,
    selectedTargetBranch,
    selectedBaseCommit,
    selectedTargetCommit,
    onStateChange
  ]);

  // Add keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadBranches = async () => {
    console.log("[COMPONENT] loadBranches method entry");
    try {
      console.log("[COMPONENT] loadBranches called for git project:", selectedGitProject?.root);
      setBranchesLoading(true);
      setBranchesError(null);
      
      console.log("[COMPONENT] About to call getGitBranches...");
      const gitBranches = await diffService.getGitBranches();
      console.log("[COMPONENT] getGitBranches returned successfully");
      console.log("[COMPONENT] Got branches:", gitBranches.length);
      console.log("[COMPONENT] Branch data:", gitBranches);
      
      console.log("[COMPONENT] Setting branches state...");
      setBranches(gitBranches);
      console.log("[COMPONENT] Branches state set successfully");
      
      // Set default selections - main/master as base, current branch as target
      console.log("[COMPONENT] Finding default branch selections...");
      const mainBranch = gitBranches.find(b => b.name === 'main' || b.name === 'master');
      const currentBranch = gitBranches.find(b => b.isCurrentBranch);
      console.log("[COMPONENT] Main branch found:", mainBranch?.name);
      console.log("[COMPONENT] Current branch found:", currentBranch?.name);
      
      if (mainBranch && currentBranch && mainBranch.name !== currentBranch.name) {
        console.log("[COMPONENT] Setting main as base, current as target");
        setSelectedBaseBranch(mainBranch.name);
        setSelectedTargetBranch(currentBranch.name);
      } else if (gitBranches.length >= 2) {
        console.log("[COMPONENT] Setting first two branches as defaults");
        setSelectedBaseBranch(gitBranches[0].name);
        setSelectedTargetBranch(gitBranches[1].name);
      }
      console.log("[COMPONENT] Default selections complete");
    } catch (err) {
      console.error("[COMPONENT] Error in loadBranches:", err);
      console.error("[COMPONENT] Error stack:", err instanceof Error ? err.stack : "No stack");
      setBranchesError(err instanceof Error ? err.message : "Failed to load branches");
    } finally {
      console.log("[COMPONENT] loadBranches finally block");
      setBranchesLoading(false);
    }
  };

  const loadBranchCommits = async (branchName: string, isBaseBranch: boolean) => {
    if (!branchName) return;
    
    try {
      setLoadingCommits(true);
      const commits = await diffService.getBranchCommits(branchName, 20);
      
      if (isBaseBranch) {
        setBaseBranchCommits(commits);
        setSelectedBaseCommit("");
      } else {
        setTargetBranchCommits(commits);
        setSelectedTargetCommit("");
      }
    } catch (error) {
      console.error(`Failed to load commits for ${branchName}:`, error);
    } finally {
      setLoadingCommits(false);
    }
  };

  const loadDiffData = async (baseBranch?: string, targetBranch?: string, baseCommit?: string, targetCommit?: string) => {
    try {
      setLoading(true);
      setError(null);
      
      let diffText: string;
      
      // Handle special cases for unstaged/staged changes
      if (targetCommit === 'UNSTAGED') {
        diffText = await diffService.getUnstagedChanges();
      } else if (targetCommit === 'STAGED') {
        diffText = await diffService.getStagedChanges();
      } else if (baseCommit === 'UNSTAGED') {
        diffText = await diffService.getUnstagedChanges();
      } else if (baseCommit === 'STAGED') {
        diffText = await diffService.getStagedChanges();
      } else if (baseBranch && targetBranch) {
        diffText = await diffService.getBranchComparison(baseBranch, targetBranch, baseCommit, targetCommit);
      } else {
        diffText = await diffService.getGitDiff();
      }
      
      const parsedFiles = diffService.parseDiff(diffText);
      const summary = diffService.categorizeChanges(parsedFiles);
      setDiffSummary(summary);
      setShowBranchSelection(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diff data");
    } finally {
      setLoading(false);
    }
  };

  const handleCompareBranches = () => {
    if (selectedBaseBranch && selectedTargetBranch) {
      loadDiffData(selectedBaseBranch, selectedTargetBranch, selectedBaseCommit, selectedTargetCommit);
    }
  };

  const generateUnifiedDiff = async () => {
    try {
      setLoading(true);
      let unifiedDiff: string;
      
      // Check if we're comparing with unstaged or staged changes
      if (selectedTargetCommit === 'UNSTAGED') {
        unifiedDiff = await diffService.getUnstagedChanges();
      } else if (selectedTargetCommit === 'STAGED') {
        unifiedDiff = await diffService.getStagedChanges();
      } else if (selectedBaseCommit === 'UNSTAGED') {
        // If base is unstaged, swap the comparison
        unifiedDiff = await diffService.getUnstagedChanges();
      } else if (selectedBaseCommit === 'STAGED') {
        // If base is staged, swap the comparison  
        unifiedDiff = await diffService.getStagedChanges();
      } else if (selectedBaseBranch && selectedTargetBranch) {
        unifiedDiff = await diffService.getUnifiedDiff(
          selectedBaseBranch, 
          selectedTargetBranch, 
          selectedBaseCommit, 
          selectedTargetCommit
        );
      } else {
        throw new Error("No comparison selected");
      }
      
      setUnifiedDiffContent(unifiedDiff);
      setShowUnifiedDiff(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to generate unified diff");
    } finally {
      setLoading(false);
    }
  };

  const backToBranchSelection = () => {
    setShowBranchSelection(true);
    setDiffSummary(null);
    setError(null);
    setViewMode('overview');
  };

  // Directory selection removed - using git project from context

  // Back to directory selection removed - using git project from context

  const validateChange = async (changeId: string) => {
    if (!diffSummary) return;

    try {
      const updatedSummary = { ...diffSummary };
      
      // Find the change to validate
      const mainChange = updatedSummary.mainLogicChanges.find(c => c.id === changeId);
      const smallChange = updatedSummary.smallChanges.find(c => c.id === changeId);
      const change = mainChange || smallChange;
      
      if (change) {
        // Get file paths from the change
        const filePaths = change.files.map(file => file.filePath);
        
        // Add files to git
        await diffService.addFilesToGit(filePaths);
        console.log(`[VALIDATE] Successfully added files to git for change ${changeId}:`, filePaths);
        
        // Mark as validated
        change.validated = true;
        
        // Mark all subLogicPaths as validated if they exist
        if (change.subLogicPaths) {
          change.subLogicPaths.forEach(subPath => {
            subPath.validated = true;
          });
        }
      }

      // Check if all changes are validated
      const allValidated = [...updatedSummary.mainLogicChanges, ...updatedSummary.smallChanges]
        .every(change => change.validated);
      
      updatedSummary.validationState.allValidated = allValidated;
      setDiffSummary(updatedSummary);
    } catch (error) {
      console.error("Failed to validate change:", error);
      setError(`Failed to validate change: ${error}`);
    }
  };

  const validateAllChanges = async () => {
    if (!diffSummary) return;

    try {
      const updatedSummary = { ...diffSummary };
      
      // Collect all file paths from all changes
      const allFilePaths: string[] = [];
      [...updatedSummary.mainLogicChanges, ...updatedSummary.smallChanges].forEach(change => {
        change.files.forEach(file => {
          if (!allFilePaths.includes(file.filePath)) {
            allFilePaths.push(file.filePath);
          }
        });
      });
      
      // Add all files to git
      await diffService.addFilesToGit(allFilePaths);
      console.log(`[VALIDATE_ALL] Successfully added all files to git:`, allFilePaths);
      
      // Mark all changes as validated
      updatedSummary.mainLogicChanges.forEach(change => {
        change.validated = true;
        if (change.subLogicPaths) {
          change.subLogicPaths.forEach(subPath => {
            subPath.validated = true;
          });
        }
      });
      updatedSummary.smallChanges.forEach(change => {
        change.validated = true;
        if (change.subLogicPaths) {
          change.subLogicPaths.forEach(subPath => {
            subPath.validated = true;
          });
        }
      });
      updatedSummary.validationState.allValidated = true;
      
      setDiffSummary(updatedSummary);
    } catch (error) {
      console.error("Failed to validate all changes:", error);
      setError(`Failed to validate all changes: ${error}`);
    }
  };

  const discardFileChanges = async (filePaths: string[]) => {
    try {
      setLoading(true);
      await diffService.discardFileChanges(filePaths);
      
      // Reload diff data to reflect the discarded changes
      await loadDiffData(selectedBaseBranch, selectedTargetBranch, selectedBaseCommit, selectedTargetCommit);
    } catch (error) {
      console.error("Failed to discard file changes:", error);
      setError(`Failed to discard file changes: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const discardHunkChanges = async (filePath: string, hunk: GitDiffHunk) => {
    try {
      setLoading(true);
      await diffService.discardHunkChanges(filePath, hunk);
      
      // Reload diff data to reflect the discarded changes
      await loadDiffData(selectedBaseBranch, selectedTargetBranch, selectedBaseCommit, selectedTargetCommit);
    } catch (error) {
      console.error("Failed to discard hunk changes:", error);
      setError(`Failed to discard hunk changes: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const validateHunkChanges = async (filePath: string, hunk: GitDiffHunk) => {
    try {
      setLoading(true);
      await diffService.validateHunkChanges(filePath, hunk);
      
      // Reload diff data to reflect the validated changes
      await loadDiffData(selectedBaseBranch, selectedTargetBranch, selectedBaseCommit, selectedTargetCommit);
    } catch (error) {
      console.error("Failed to validate hunk changes:", error);
      setError(`Failed to validate hunk changes: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const validateSingleFileChanges = async (filePath: string) => {
    try {
      setLoading(true);
      await diffService.validateFileChanges(filePath);
      
      // Reload diff data to reflect the validated changes
      await loadDiffData(selectedBaseBranch, selectedTargetBranch, selectedBaseCommit, selectedTargetCommit);
    } catch (error) {
      console.error("Failed to validate file changes:", error);
      setError(`Failed to validate file changes: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const discardSingleFileChanges = async (filePath: string) => {
    try {
      setLoading(true);
      await diffService.discardFileChanges([filePath]);
      
      // Reload diff data to reflect the discarded changes
      await loadDiffData(selectedBaseBranch, selectedTargetBranch, selectedBaseCommit, selectedTargetCommit);
    } catch (error) {
      console.error("Failed to discard file changes:", error);
      setError(`Failed to discard file changes: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const enterDetailedView = (changeId: string) => {
    setSelectedChange(changeId);
    setViewMode('detailed');
    setCurrentFileIndex(0);
    setCurrentLineIndex(0);
  };

  const selectSubLogic = (subLogicId: string) => {
    console.log("selectSubLogic called with:", subLogicId, "currently selected:", selectedSubLogic);
    
    // Extract hunk index from block ID (format: "hunk-{index}")
    const hunkIndexMatch = subLogicId.match(/hunk-(\d+)/);
    if (hunkIndexMatch) {
      const hunkIndex = parseInt(hunkIndexMatch[1]);
      console.log("Navigating to hunk index:", hunkIndex);
      
      // Find the change that contains this sublogic path
      const parentChange = [...(diffSummary?.mainLogicChanges ?? []), ...(diffSummary?.smallChanges ?? [])].find(change => 
        change.subLogicPaths?.some(path => path.id === subLogicId)
      );
      
      if (parentChange) {
        console.log("Found parent change:", parentChange.id);
        // Switch to detailed view with the correct change and hunk
        setSelectedChange(parentChange.id);
        setViewMode('detailed');
        setCurrentFileIndex(0); // Assume first file for now
        setCurrentLineIndex(hunkIndex);
      }
    }
    
    const newSelection = selectedSubLogic === subLogicId ? null : subLogicId;
    console.log("Setting selectedSubLogic to:", newSelection);
    setSelectedSubLogic(newSelection);
  };

  const searchHunks = (query: string) => {
    if (!diffSummary || !query.trim()) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      return;
    }

    const results: { changeId: string, fileIndex: number, hunkIndex: number, hunk: GitDiffHunk, context: string }[] = [];
    const allChanges = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges];

    allChanges.forEach(change => {
      change.files.forEach((file, fileIndex) => {
        file.hunks.forEach((hunk, hunkIndex) => {
          // Search in hunk lines
          const matchingLines = hunk.lines.filter(line => 
            line.content.toLowerCase().includes(query.toLowerCase())
          );
          
          if (matchingLines.length > 0) {
            const context = `${file.filePath} - ${matchingLines.length} match${matchingLines.length > 1 ? 'es' : ''}`;
            results.push({
              changeId: change.id,
              fileIndex,
              hunkIndex,
              hunk,
              context
            });
          }
        });
      });
    });

    setSearchResults(results);
    setCurrentSearchIndex(results.length > 0 ? 0 : -1);
  };

  const navigateToSearchResult = (index: number) => {
    if (index < 0 || index >= searchResults.length) return;
    
    const result = searchResults[index];
    setSelectedChange(result.changeId);
    setViewMode('detailed');
    setCurrentFileIndex(result.fileIndex);
    setCurrentLineIndex(result.hunkIndex);
    setCurrentSearchIndex(index);
    
    // Trigger scroll to make search result visible as second line
    setTimeout(() => {
      const searchResultElements = document.querySelectorAll('.search-highlight');
      if (searchResultElements.length > 0) {
        const targetElement = searchResultElements[0] as HTMLElement;
        const scrollContainer = document.querySelector('.absolute.inset-0.overflow-auto') as HTMLElement;
        
        if (targetElement && scrollContainer) {
          // Calculate position to show search result as second visible line
          const lineHeight = 24; // Approximate line height
          const targetTop = targetElement.offsetTop - (lineHeight * 1); // Show as second line
          
          scrollContainer.scrollTo({
            top: Math.max(0, targetTop),
            behavior: 'smooth'
          });
        }
      }
    }, 100); // Small delay to ensure DOM is updated
  };

  const nextSearchResult = () => {
    if (searchResults.length === 0) return;
    const nextIndex = (currentSearchIndex + 1) % searchResults.length;
    navigateToSearchResult(nextIndex);
  };

  const previousSearchResult = () => {
    if (searchResults.length === 0) return;
    const prevIndex = currentSearchIndex <= 0 ? searchResults.length - 1 : currentSearchIndex - 1;
    navigateToSearchResult(prevIndex);
  };

  const navigateToNextChange = () => {
    if (!diffSummary || !selectedChange) return;
    
    const allChanges = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges];
    const currentIndex = allChanges.findIndex(c => c.id === selectedChange);
    const nextIndex = (currentIndex + 1) % allChanges.length;
    
    setSelectedChange(allChanges[nextIndex].id);
    setCurrentFileIndex(0);
    setCurrentLineIndex(0);
  };

  const navigateToNextFile = () => {
    if (!diffSummary || !selectedChange) return;
    
    // Get all files from all changes
    const allChanges = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges];
    const allFiles: { changeId: string, fileIndex: number, file: GitDiffFile }[] = [];
    
    // Build a flat list of all files with their change and file indices
    allChanges.forEach(change => {
      change.files.forEach((file, fileIndex) => {
        allFiles.push({ changeId: change.id, fileIndex, file });
      });
    });
    
    // Find current file position in the flat list
    const currentGlobalIndex = allFiles.findIndex(item => 
      item.changeId === selectedChange && item.fileIndex === currentFileIndex
    );
    
    // Navigate to next file
    if (currentGlobalIndex < allFiles.length - 1) {
      const nextFile = allFiles[currentGlobalIndex + 1];
      setSelectedChange(nextFile.changeId);
      setCurrentFileIndex(nextFile.fileIndex);
      setCurrentLineIndex(0);
    }
  };

  const navigateToPreviousFile = (): boolean => {
    if (!diffSummary || !selectedChange) return false;
    
    // Get all files from all changes
    const allChanges = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges];
    const allFiles: { changeId: string, fileIndex: number, file: GitDiffFile }[] = [];
    
    // Build a flat list of all files with their change and file indices
    allChanges.forEach(change => {
      change.files.forEach((file, fileIndex) => {
        allFiles.push({ changeId: change.id, fileIndex, file });
      });
    });
    
    // Find current file position in the flat list
    const currentGlobalIndex = allFiles.findIndex(item => 
      item.changeId === selectedChange && item.fileIndex === currentFileIndex
    );
    
    // Navigate to previous file
    if (currentGlobalIndex > 0) {
      const prevFile = allFiles[currentGlobalIndex - 1];
      setSelectedChange(prevFile.changeId);
      setCurrentFileIndex(prevFile.fileIndex);
      setCurrentLineIndex(0);
      return true;
    }
    return false;
  };

  const navigateToPreviousChange = () => {
    if (!diffSummary || !selectedChange) return;
    
    const allChanges = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges];
    const currentIndex = allChanges.findIndex(c => c.id === selectedChange);
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : allChanges.length - 1;
    
    setSelectedChange(allChanges[prevIndex].id);
    setCurrentFileIndex(0);
    setCurrentLineIndex(0);
  };

  const navigateToNextHunk = () => {
    if (!diffSummary || !selectedChange) return;
    
    const change = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges]
      .find(c => c.id === selectedChange);
    
    if (change && change.files[currentFileIndex]) {
      const currentFile = change.files[currentFileIndex];
      console.log(`[HUNK_NAV] Current hunk index: ${currentLineIndex}, Total hunks: ${currentFile.hunks.length}`);
      if (currentLineIndex < currentFile.hunks.length - 1) {
        const newIndex = currentLineIndex + 1;
        console.log(`[HUNK_NAV] Moving to next hunk: ${newIndex}`);
        setCurrentLineIndex(newIndex);
      } else {
        console.log(`[HUNK_NAV] At last hunk, attempting to navigate to next file`);
        // At last hunk of current file, try to navigate to next file
        navigateToNextFile();
      }
    }
  };

  const navigateToPreviousHunk = () => {
    console.log(`[HUNK_NAV] Current hunk index: ${currentLineIndex}`);
    if (currentLineIndex > 0) {
      const newIndex = currentLineIndex - 1;
      console.log(`[HUNK_NAV] Moving to previous hunk: ${newIndex}`);
      setCurrentLineIndex(newIndex);
    } else {
      console.log(`[HUNK_NAV] At first hunk, attempting to navigate to previous file`);
      // At first hunk of current file, try to navigate to previous file
      const prevFileResult = navigateToPreviousFile();
      // If we successfully moved to previous file, go to its last hunk
      if (prevFileResult) {
        setTimeout(() => {
          if (!diffSummary || !selectedChange) return;
          const change = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges]
            .find(c => c.id === selectedChange);
          if (change && change.files[currentFileIndex]) {
            const newFile = change.files[currentFileIndex];
            setCurrentLineIndex(Math.max(0, newFile.hunks.length - 1));
          }
        }, 0);
      }
    }
  };

  const getCurrentFile = (): GitDiffFile | null => {
    if (!diffSummary || !selectedChange) return null;
    
    const change = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges]
      .find(c => c.id === selectedChange);
    
    return change?.files[currentFileIndex] || null;
  };

  // Directory selection removed - using git project from context

  console.log("[DIFFMANAGEMENT] Current state:", {
    showBranchSelection,
    loading,
    error,
    diffSummary: !!diffSummary,
    branches: branches.length,
    branchesLoading,
    branchesError
  });

  // Show branch selection landing page
  if (showBranchSelection) {
    console.log("[DIFFMANAGEMENT] Rendering BranchSelectionPage");
    return (
      <BranchSelectionPage
        branches={branches}
        loading={branchesLoading}
        error={branchesError}
        selectedBaseBranch={selectedBaseBranch}
        selectedTargetBranch={selectedTargetBranch}
        selectedBaseCommit={selectedBaseCommit}
        selectedTargetCommit={selectedTargetCommit}
        baseBranchCommits={baseBranchCommits}
        targetBranchCommits={targetBranchCommits}
        loadingCommits={loadingCommits}
        selectedDirectory={selectedGitProject?.root ? (osSessionGetWorkingDirectory(selectedGitProject.root) || "") : ""}
        onBaseBranchChange={(branch) => {
          setSelectedBaseBranch(branch);
          if (branch) loadBranchCommits(branch, true);
        }}
        onTargetBranchChange={(branch) => {
          setSelectedTargetBranch(branch);
          if (branch) loadBranchCommits(branch, false);
        }}
        onBaseCommitChange={setSelectedBaseCommit}
        onTargetCommitChange={setSelectedTargetCommit}
        onCompare={handleCompareBranches}
        onClose={onClose}
        onRetry={() => loadBranches()}
        onBackToDirectory={() => {/* Directory selection removed */}}
        isComparing={loading}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-[var(--border)] border-[var(--acc-500)] mx-auto mb-4"></div>
          <p className="text-[var(--base-600)]">Loading diff data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-4">⚠️</div>
          <h2 className="text-xl  text-[var(--base-700)] mb-2">Error Loading Diff</h2>
          <p className="text-[var(--base-600)] mb-4">{error}</p>
          <button
            onClick={() => loadDiffData()}
            className="px-4 py-2 bg-[var(--acc-500)] text-white rounded-lg hover:bg-[var(--acc-600)] transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!diffSummary) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-[var(--base-600)]">No diff data available</p>
      </div>
    );
  }

  // Handle case where there are no changes
  if (diffSummary.totalFiles === 0) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[var(--base-100)] relative">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--base-300)]">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-black text-[var(--acc-600)]">Diff Management</h1>
          </div>
          
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[var(--base-400)] text-[var(--base-700)] rounded-lg hover:bg-[var(--base-500)] transition-colors"
          >
            Close
          </button>
        </div>

        {/* No changes content */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-xl  text-[var(--base-700)] mb-2">No Changes Found</h2>
            <p className="text-[var(--base-600)] mb-4">
              Your working directory is clean - there are no uncommitted changes to review.
            </p>
            <button
              onClick={() => loadDiffData()}
              className="px-4 py-2 bg-[var(--acc-500)] text-white rounded-lg hover:bg-[var(--acc-600)] transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--base-100)] relative">
      {/* Header - Always Visible */}
      <div 
        className={cn(
          "flex items-center justify-between border-b border-[var(--base-300)] p-4 h-auto opacity-100 relative",
          mainTitlebarVisible && "mt-12"
        )}
      >
        <>
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-black text-[var(--acc-600)]">Diff Management</h1>
              <div className="flex items-center space-x-2 text-sm text-[var(--base-600)]">
                <span>{diffSummary.totalFiles} files</span>
                <span className="text-green-500">+{diffSummary.totalAdditions}</span>
                <span className="text-red-500">-{diffSummary.totalDeletions}</span>
              </div>
              
              {/* Search Bar */}
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search files and content..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    searchHunks(e.target.value);
                  }}
                  className="px-3 py-2 border border-[var(--base-300)] rounded text-sm w-64 focus:outline-none focus:border-[var(--acc-500)]"
                />
                {searchResults.length > 0 && (
                  <div className="absolute right-8 top-1/2 transform -translate-y-1/2 text-xs text-[var(--base-600)]">
                    {currentSearchIndex + 1}/{searchResults.length}
                  </div>
                )}
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSearchResults([]);
                      setCurrentSearchIndex(-1);
                    }}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-[var(--base-500)] hover:text-[var(--base-700)]"
                  >
                    ✕
                  </button>
                )}
              </div>
              
              {/* Search Navigation */}
              {searchResults.length > 0 && (
                <div className="flex items-center space-x-1">
                  <button
                    onClick={previousSearchResult}
                    className="px-2 py-1 bg-[var(--base-200)] text-[var(--base-700)] rounded hover:bg-[var(--base-300)] transition-colors text-sm"
                  >
                    ↑
                  </button>
                  <button
                    onClick={nextSearchResult}
                    className="px-2 py-1 bg-[var(--base-200)] text-[var(--base-700)] rounded hover:bg-[var(--base-300)] transition-colors text-sm"
                  >
                    ↓
                  </button>
                </div>
              )}
            </div>

            
            <div className="flex items-center space-x-2">
              <button
                onClick={backToBranchSelection}
                className="px-3 py-1 bg-[var(--base-200)] text-[var(--base-700)] rounded hover:bg-[var(--base-300)] transition-colors"
              >
                ← Change Branches
              </button>
              
              <button
                onClick={() => setViewMode(viewMode === 'overview' ? 'detailed' : 'overview')}
                className="px-3 py-1 bg-[var(--base-200)] text-[var(--base-700)] rounded hover:bg-[var(--base-300)] transition-colors"
              >
                {viewMode === 'overview' ? 'Detailed View' : 'Overview'}
              </button>
              
              <button
                onClick={generateUnifiedDiff}
                className="px-4 py-2 bg-[var(--base-400)] text-[var(--base-700)] rounded-lg hover:bg-[var(--base-500)] transition-colors"
              >
                View Unified Diff
              </button>
              
              <button
                onClick={validateAllChanges}
                disabled={diffSummary.validationState.allValidated}
                className={cn(
                  "px-4 py-2 rounded-lg  transition-colors",
                  diffSummary.validationState.allValidated
                    ? "bg-green-500 text-white"
                    : "bg-[var(--acc-500)] text-white hover:bg-[var(--acc-600)]"
                )}
              >
                {diffSummary.validationState.allValidated ? "✓ All Validated" : "Validate All"}
              </button>
            </div>
        </>
      </div>

      {/* Unified Diff Modal */}
      {showUnifiedDiff && (
        <UnifiedDiffModal
          content={unifiedDiffContent}
          onClose={() => setShowUnifiedDiff(false)}
          baseBranch={selectedBaseBranch}
          targetBranch={selectedTargetBranch}
          baseCommit={selectedBaseCommit}
          targetCommit={selectedTargetCommit}
        />
      )}

      {/* Content */}
      {viewMode === 'overview' ? (
        <OverviewMode
          diffSummary={diffSummary}
          onValidateChange={validateChange}
          onEnterDetailed={enterDetailedView}
          onSelectSubLogic={selectSubLogic}
          selectedSubLogic={selectedSubLogic}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onDiscardFileChanges={discardFileChanges}
        />
      ) : (
        <DetailedMode
          diffSummary={diffSummary}
          selectedChange={selectedChange}
          currentFile={getCurrentFile()}
          currentFileIndex={currentFileIndex}
          currentLineIndex={currentLineIndex}
          onValidateChange={validateChange}
          onNextChange={navigateToNextChange}
          onPreviousChange={navigateToPreviousChange}
          onNextFile={navigateToNextFile}
          onPreviousFile={navigateToPreviousFile}
          onNextHunk={navigateToNextHunk}
          onPreviousHunk={navigateToPreviousHunk}
          onBackToOverview={() => setViewMode('overview')}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchResults={searchResults}
          currentSearchIndex={currentSearchIndex}
          searchHunks={searchHunks}
          nextSearchResult={nextSearchResult}
          previousSearchResult={previousSearchResult}
          onDiscardFileChanges={discardFileChanges}
          onDiscardHunkChanges={discardHunkChanges}
          onValidateHunkChanges={validateHunkChanges}
          onDiscardSingleFile={discardSingleFileChanges}
          onValidateSingleFile={validateSingleFileChanges}
        />
      )}
    </div>
  );
}

// Overview Mode Component
interface OverviewModeProps {
  diffSummary: DiffSummary;
  onValidateChange: (changeId: string) => void;
  onEnterDetailed: (changeId: string) => void;
  onSelectSubLogic: (subLogicId: string) => void;
  selectedSubLogic: string | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onDiscardFileChanges: (filePaths: string[]) => Promise<void>;
}

function OverviewMode({ 
  diffSummary, 
  onValidateChange, 
  onEnterDetailed, 
  onSelectSubLogic, 
  selectedSubLogic,
  searchQuery,
  setSearchQuery,
  onDiscardFileChanges
}: OverviewModeProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter changes based on search query
  const filterChanges = (changes: (MainLogicChange | DiffChange)[]) => {
    if (!searchQuery.trim()) return changes;
    
    return changes.filter(change => {
      // Search in file names
      const fileMatches = change.files.some(file => 
        file.filePath.toLowerCase().includes(searchQuery.toLowerCase())
      );
      
      // Search in file content (hunks)
      const contentMatches = change.files.some(file =>
        file.hunks.some(hunk =>
          hunk.lines.some(line =>
            line.content.toLowerCase().includes(searchQuery.toLowerCase())
          )
        )
      );
      
      return fileMatches || contentMatches;
    });
  };

  const filteredMainChanges = filterChanges(diffSummary.mainLogicChanges);
  const filteredSmallChanges = filterChanges(diffSummary.smallChanges);

  // Add keyboard shortcut for Cmd/Ctrl+F
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Search Bar */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black text-[var(--acc-600)]">Overview</h1>
          <div className="flex items-center space-x-4">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search files and content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-2 border border-[var(--base-300)] rounded text-sm w-64 focus:outline-none focus:border-[var(--acc-500)]"
              />
              {searchQuery && (
                <div className="absolute right-8 top-1/2 transform -translate-y-1/2 text-xs text-[var(--base-600)]">
                  {filteredMainChanges.length + filteredSmallChanges.length} result{filteredMainChanges.length + filteredSmallChanges.length !== 1 ? 's' : ''}
                </div>
              )}
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-[var(--base-500)] hover:text-[var(--base-700)]"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
        {/* Main Logic Changes */}
        {filteredMainChanges.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl  text-[var(--acc-600)]">
              Main Logic Changes 
              {searchQuery && (
                <span className="text-sm font-normal text-[var(--base-600)]">
                  ({filteredMainChanges.length} of {diffSummary.mainLogicChanges.length})
                </span>
              )}
            </h2>
            {filteredMainChanges.map((change) => (
              <MainLogicChangeCard
                key={change.id}
                change={change as MainLogicChange}
                onValidate={() => onValidateChange(change.id)}
                onEnterDetailed={() => onEnterDetailed(change.id)}
                onSelectSubLogic={onSelectSubLogic}
                selectedSubLogic={selectedSubLogic}
                searchQuery={searchQuery}
                onDiscardFileChanges={onDiscardFileChanges}
              />
            ))}
          </div>
        )}

        {/* Small Changes */}
        {filteredSmallChanges.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl  text-[var(--acc-600)]">
              Small Changes
              {searchQuery && (
                <span className="text-sm font-normal text-[var(--base-600)]">
                  ({filteredSmallChanges.length} of {diffSummary.smallChanges.length})
                </span>
              )}
            </h2>
            {filteredSmallChanges.map((change) => (
              <SmallChangeCard
                key={change.id}
                change={change}
                onValidate={() => onValidateChange(change.id)}
                onEnterDetailed={() => onEnterDetailed(change.id)}
                onSelectSubLogic={onSelectSubLogic}
                selectedSubLogic={selectedSubLogic}
                searchQuery={searchQuery}
                onDiscardFileChanges={onDiscardFileChanges}
              />
            ))}
          </div>
        )}
        
        {/* No Results Message */}
        {searchQuery && filteredMainChanges.length === 0 && filteredSmallChanges.length === 0 && (
          <div className="text-center py-8">
            <div className="text-4xl mb-4">🔍</div>
            <h3 className="text-lg  text-[var(--base-700)] mb-2">No results found</h3>
            <p className="text-[var(--base-600)]">
              No files or content match "{searchQuery}". Try a different search term.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// Main Logic Change Card Component
interface MainLogicChangeCardProps {
  change: MainLogicChange;
  onValidate: () => void;
  onEnterDetailed: () => void;
  onSelectSubLogic: (subLogicId: string) => void;
  selectedSubLogic: string | null;
  searchQuery?: string;
  onDiscardFileChanges: (filePaths: string[]) => Promise<void>;
}

function MainLogicChangeCard({ 
  change, 
  onValidate, 
  onEnterDetailed, 
  onSelectSubLogic, 
  selectedSubLogic,
  searchQuery = "",
  onDiscardFileChanges
}: MainLogicChangeCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div 
      className={cn(
        "border rounded-lg p-4 space-y-4 transition-colors group",
        change.validated 
          ? "border-green-400 bg-green-50" 
          : "border-[var(--base-300)] bg-[var(--base-200)]"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className=" text-[var(--base-700)]">
            {highlightSearchTerm(change.title, searchQuery)}
          </h3>
          {isHovered && (
            <p className="text-sm text-[var(--base-600)]">
              {highlightSearchTerm(change.description, searchQuery)}
            </p>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={onEnterDetailed}
            className="px-3 py-1 bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] transition-colors text-sm"
          >
            Detailed View
          </button>
          
          <button
            onClick={() => {
              const filePaths = change.files.map(file => file.filePath);
              onDiscardFileChanges(filePaths);
            }}
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors text-sm"
            title="Discard all changes in this change set"
          >
            Discard
          </button>
          
          <button
            onClick={onValidate}
            disabled={change.validated}
            className={cn(
              "px-3 py-1 rounded text-sm  transition-colors",
              change.validated
                ? "bg-green-500 text-white"
                : "bg-[var(--base-400)] text-[var(--base-700)] hover:bg-[var(--base-500)]"
            )}
          >
            {change.validated ? "✓ Validated" : "Validate"}
          </button>
        </div>
      </div>

      {/* Blocks (only visible on hover) */}
      {isHovered && (
        <div className="space-y-2">
          <h4 className="text-sm  text-[var(--base-600)]">Blocks:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {change.subLogicPaths.map((subPath) => (
              <SubLogicPathCard
                key={subPath.id}
                subPath={subPath}
                isSelected={selectedSubLogic === subPath.id}
                onSelect={() => onSelectSubLogic(subPath.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Sub Logic Path Card Component
interface SubLogicPathCardProps {
  subPath: SubLogicPath;
  isSelected: boolean;
  onSelect: () => void;
}

function SubLogicPathCard({ subPath, isSelected, onSelect }: SubLogicPathCardProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("SubLogicPathCard clicked:", subPath.id, "currently selected:", isSelected);
    onSelect();
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "p-3 border rounded cursor-pointer transition-colors select-none",
        isSelected 
          ? "border-[var(--acc-400)] bg-[var(--acc-100)]" 
          : "border-[var(--base-300)] bg-[var(--base-100)] hover:bg-[var(--base-150)]",
        subPath.validated ? "border-green-400" : ""
      )}
    >
      <div className="flex items-center justify-between">
        <h5 className="text-sm  text-[var(--base-700)]">{subPath.title}</h5>
        {subPath.validated && <span className="text-green-500 text-xs">✓</span>}
      </div>
      <p className="text-xs text-[var(--base-600)] mt-1">{subPath.description}</p>
      <div className="text-xs text-[var(--acc-600)] mt-1">
        Prompt: {subPath.promptSegment}
      </div>
    </div>
  );
}

// Small Change Card Component
interface SmallChangeCardProps {
  change: DiffChange;
  onValidate: () => void;
  onEnterDetailed: () => void;
  onSelectSubLogic?: (subLogicId: string) => void;
  selectedSubLogic?: string | null;
  searchQuery?: string;
  onDiscardFileChanges: (filePaths: string[]) => Promise<void>;
}

function SmallChangeCard({ change, onValidate, onEnterDetailed, onSelectSubLogic, selectedSubLogic, searchQuery = "", onDiscardFileChanges }: SmallChangeCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div 
      className={cn(
        "border rounded-lg p-4 space-y-4 transition-colors",
        change.validated 
          ? "border-green-400 bg-green-50" 
          : "border-[var(--base-300)] bg-[var(--base-200)]"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className=" text-[var(--base-700)]">
            {highlightSearchTerm(change.title, searchQuery)}
          </h3>
          {isHovered && (
            <p className="text-sm text-[var(--base-600)]">
              {highlightSearchTerm(change.description, searchQuery)}
            </p>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={onEnterDetailed}
            className="px-3 py-1 bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] transition-colors text-sm"
          >
            View
          </button>
          
          <button
            onClick={() => {
              const filePaths = change.files.map(file => file.filePath);
              onDiscardFileChanges(filePaths);
            }}
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors text-sm"
            title="Discard all changes in this change set"
          >
            Discard
          </button>
          
          <button
            onClick={onValidate}
            disabled={change.validated}
            className={cn(
              "px-3 py-1 rounded text-sm  transition-colors",
              change.validated
                ? "bg-green-500 text-white"
                : "bg-[var(--base-400)] text-[var(--base-700)] hover:bg-[var(--base-500)]"
            )}
          >
            {change.validated ? "✓ Validated" : "Validate"}
          </button>
        </div>
      </div>

      {/* Blocks (only visible on hover) */}
      {isHovered && change.subLogicPaths && change.subLogicPaths.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm  text-[var(--base-600)]">Blocks:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {change.subLogicPaths.map((subPath) => (
              <SubLogicPathCard
                key={subPath.id}
                subPath={subPath}
                isSelected={selectedSubLogic === subPath.id}
                onSelect={() => onSelectSubLogic?.(subPath.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Detailed Mode Component
interface DetailedModeProps {
  diffSummary: DiffSummary;
  selectedChange: string | null;
  currentFile: GitDiffFile | null;
  currentFileIndex: number;
  currentLineIndex: number;
  onValidateChange: (changeId: string) => void;
  onNextChange: () => void;
  onPreviousChange: () => void;
  onNextFile: () => void;
  onPreviousFile: () => void;
  onNextHunk: () => void;
  onPreviousHunk: () => void;
  onBackToOverview: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchResults: { changeId: string, fileIndex: number, hunkIndex: number, hunk: GitDiffHunk, context: string }[];
  currentSearchIndex: number;
  searchHunks: (query: string) => void;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
  onDiscardFileChanges: (filePaths: string[]) => Promise<void>;
  onDiscardHunkChanges: (filePath: string, hunk: GitDiffHunk) => Promise<void>;
  onValidateHunkChanges: (filePath: string, hunk: GitDiffHunk) => Promise<void>;
  onDiscardSingleFile: (filePath: string) => Promise<void>;
  onValidateSingleFile: (filePath: string) => Promise<void>;
}

function DetailedMode({
  diffSummary,
  selectedChange,
  currentFile,
  currentFileIndex,
  currentLineIndex,
  onValidateChange,
  onNextChange,
  onPreviousChange,
  onNextFile,
  onPreviousFile,
  onNextHunk,
  onPreviousHunk,
  onBackToOverview,
  searchQuery,
  setSearchQuery,
  searchResults,
  currentSearchIndex,
  searchHunks,
  nextSearchResult,
  previousSearchResult,
  onDiscardFileChanges,
  onDiscardHunkChanges,
  onValidateHunkChanges,
  onDiscardSingleFile,
  onValidateSingleFile
}: DetailedModeProps) {
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Keyboard navigation
  React.useEffect(() => {
    let lastKeyPress: { key: string; timestamp: number } | null = null;
    const doubleTapThreshold = 300; // milliseconds
    
    const handleKeyDown = (event: KeyboardEvent) => {
      const currentTime = Date.now();
      
      // Get the scroll container for manual scrolling
      const scrollContainer = document.querySelector('.absolute.inset-0.overflow-auto') as HTMLElement;
      
      // Check for double-tap
      const isDoubleTap = lastKeyPress && 
        lastKeyPress.key === event.key && 
        (currentTime - lastKeyPress.timestamp) < doubleTapThreshold;
      
      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case 'ArrowUp':
            event.preventDefault();
            onPreviousHunk();
            break;
          case 'ArrowDown':
            event.preventDefault();
            onNextHunk();
            break;
          case 'f':
            event.preventDefault();
            searchInputRef.current?.focus();
            break;
        }
      } else {
        switch (event.key) {
          case 'ArrowUp':
            event.preventDefault();
            if (isDoubleTap) {
              // Double-tap up arrow = previous hunk
              onPreviousHunk();
              lastKeyPress = null; // Reset to prevent triple-tap
            } else {
              // Single tap up arrow = scroll up manually
              if (scrollContainer) {
                scrollContainer.scrollBy({ top: -100, behavior: 'smooth' });
              }
              lastKeyPress = { key: event.key, timestamp: currentTime };
            }
            break;
          case 'ArrowDown':
            event.preventDefault();
            if (isDoubleTap) {
              // Double-tap down arrow = next hunk
              onNextHunk();
              lastKeyPress = null; // Reset to prevent triple-tap
            } else {
              // Single tap down arrow = scroll down manually
              if (scrollContainer) {
                scrollContainer.scrollBy({ top: 100, behavior: 'smooth' });
              }
              lastKeyPress = { key: event.key, timestamp: currentTime };
            }
            break;
          case 'ArrowLeft':
            event.preventDefault();
            // Single tap left arrow = previous file
            onPreviousFile();
            break;
          case 'ArrowRight':
            event.preventDefault();
            // Single tap right arrow = next file
            onNextFile();
            break;
          case 'p':
            event.preventDefault();
            onPreviousChange();
            break;
        }
      }
      
      // Clean up old key presses
      if (!isDoubleTap && event.key.startsWith('Arrow')) {
        lastKeyPress = { key: event.key, timestamp: currentTime };
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNextChange, onPreviousChange, onNextFile, onPreviousFile, onNextHunk, onPreviousHunk]);

  if (!selectedChange || !currentFile) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[var(--base-600)]">No change selected</p>
      </div>
    );
  }

  const change = [...diffSummary.mainLogicChanges, ...diffSummary.smallChanges]
    .find(c => c.id === selectedChange);

  if (!change) return null;

  return (
    <div className="flex-1 flex flex-col">

      {/* File Diff Content */}
      <div className="flex-1 relative">
        <FileDiffViewer 
          file={currentFile} 
          currentHunkIndex={currentLineIndex} 
          searchQuery={searchQuery}
          onDiscardHunk={onDiscardHunkChanges}
          onValidateHunk={onValidateHunkChanges}
          onDiscardFile={onDiscardSingleFile}
          onValidateFile={onValidateSingleFile}
        />
        
        {/* Navigation Controls - Bottom Right */}
        <div className="fixed bottom-4 right-4 flex items-center space-x-1 z-50">
          {/* Previous File */}
          <button
            onClick={onPreviousFile}
            className="px-2 py-1 bg-[var(--base-300)] text-[var(--base-700)] rounded-full hover:bg-[var(--base-400)] transition-colors shadow-lg text-sm"
            title="Previous File (←)"
          >
            ◀
          </button>
          
          {/* Hunk Navigation */}
          <div className="flex flex-col items-center space-y-1">
            <button
              onClick={onPreviousHunk}
              disabled={currentLineIndex <= 0}
              className="px-2 py-1 bg-[var(--base-300)] text-[var(--base-700)] rounded-full hover:bg-[var(--base-400)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg text-sm"
              title="Previous Block (Ctrl+↑)"
            >
              ▲
            </button>
            <button
              onClick={onNextHunk}
              disabled={currentLineIndex >= currentFile.hunks.length - 1}
              className="px-2 py-1 bg-[var(--base-300)] text-[var(--base-700)] rounded-full hover:bg-[var(--base-400)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg text-sm"
              title="Next Block (Ctrl+↓)"
            >
              ▼
            </button>
          </div>
          
          {/* Next File */}
          <button
            onClick={onNextFile}
            className="px-2 py-1 bg-[var(--base-300)] text-[var(--base-700)] rounded-full hover:bg-[var(--base-400)] transition-colors shadow-lg text-sm"
            title="Next File (→)"
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
}

// Text highlighting utility
function highlightSearchTerm(text: string, searchTerm: string): JSX.Element {
  if (!searchTerm.trim()) {
    return <span>{text}</span>;
  }

  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  
  return (
    <span>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <span key={index} className="bg-yellow-300 text-black px-1 rounded search-highlight">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </span>
  );
}

// File Diff Viewer Component
interface FileDiffViewerProps {
  file: GitDiffFile;
  currentHunkIndex?: number;
  searchQuery?: string;
  onDiscardHunk?: (filePath: string, hunk: GitDiffHunk) => Promise<void>;
  onValidateHunk?: (filePath: string, hunk: GitDiffHunk) => Promise<void>;
  onDiscardFile?: (filePath: string) => Promise<void>;
  onValidateFile?: (filePath: string) => Promise<void>;
}

function FileDiffViewer({ file, currentHunkIndex = 0, searchQuery = "", onDiscardHunk, onValidateHunk, onDiscardFile, onValidateFile }: FileDiffViewerProps) {
  const currentHunkRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showLineNumbers, setShowLineNumbers] = useState(false);

  // Debug container dimensions
  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      console.log('[DEBUG] Container dimensions:', {
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
        offsetHeight: container.offsetHeight,
        isScrollable: container.scrollHeight > container.clientHeight
      });
    }
  }, []);

  // Scroll to current hunk when it changes
  useEffect(() => {
    if (currentHunkRef.current && scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current;
      const hunkElement = currentHunkRef.current;
      
      // Calculate the position to scroll to (hunk top just below the fixed file header)
      const hunkTop = hunkElement.offsetTop;
      // Account for the fixed file header height (approximately 60px: text height + py-2 padding + border)
      const fileHeaderHeight = 60;
      const targetScrollTop = Math.max(0, hunkTop - fileHeaderHeight);
      
      console.log(`[SCROLL] Scrolling to hunk ${currentHunkIndex}`);
      console.log(`[SCROLL] Hunk top: ${hunkTop}, File header height: ${fileHeaderHeight}, Target scroll: ${targetScrollTop}`);
      console.log(`[SCROLL] Container scrollable: ${scrollContainer.scrollHeight > scrollContainer.clientHeight}`);
      
      if (scrollContainer.scrollHeight > scrollContainer.clientHeight) {
        scrollContainer.scrollTo({
          top: targetScrollTop,
          behavior: 'smooth'
        });
      } else {
        console.log('[SCROLL] Container is not scrollable - content fits within container');
      }
    }
  }, [currentHunkIndex]);

  // Track scroll progress
  useEffect(() => {
    const handleScroll = () => {
      if (scrollContainerRef.current) {
        const scrollContainer = scrollContainerRef.current;
        const scrollTop = scrollContainer.scrollTop;
        const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
        const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
        setScrollProgress(progress);
        
        console.log(`[SCROLL_PROGRESS] ScrollTop: ${scrollTop}, ScrollHeight: ${scrollHeight}, Progress: ${progress}%`);
        console.log(`[SCROLL_PROGRESS] Container dimensions: ${scrollContainer.clientHeight}x${scrollContainer.scrollHeight}`);
      }
    };

    if (scrollContainerRef.current) {
      const scrollContainer = scrollContainerRef.current;
      console.log('[SCROLL_PROGRESS] Attaching scroll listener to container:', scrollContainer);
      scrollContainer.addEventListener('scroll', handleScroll);
      // Initial scroll progress calculation
      handleScroll();
      
      return () => {
        scrollContainer.removeEventListener('scroll', handleScroll);
      };
    }
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Fixed File Header */}
      <div className="bg-[var(--base-300)] px-4 py-2 border-b border-[var(--base-400)] z-30 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h4 className="font-mono text-sm text-[var(--base-700)]">{file.filePath}</h4>
          <div className="flex items-center space-x-4 text-sm">
            <span className="text-green-600">+{file.additions}</span>
            <span className="text-red-600">-{file.deletions}</span>
            <span className="text-[var(--base-600)]">
              Block {currentHunkIndex + 1}/{file.hunks.length}
            </span>
            
            {/* File Action Buttons */}
            <div className="flex items-center space-x-1">
              {onDiscardFile && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscardFile(file.filePath);
                  }}
                  className="px-1 py-0.5 hover:bg-red-100 hover:bg-opacity-50 rounded transition-colors"
                  title="Discard entire file"
                >
                  ❌
                </button>
              )}
              {onValidateFile && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onValidateFile(file.filePath);
                  }}
                  className="px-1 py-0.5 hover:bg-green-100 hover:bg-opacity-50 rounded transition-colors"
                  title="Validate entire file"
                >
                  ✅
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div className="p-4">
          <div className="bg-[var(--base-200)] rounded-lg overflow-hidden">

            {file.hunks.map((hunk, hunkIndex) => (
              <div 
                key={hunkIndex} 
                data-hunk-index={hunkIndex}
                ref={hunkIndex === currentHunkIndex ? currentHunkRef : null}
                className={cn(
                  "border-b border-[var(--base-400)] last:border-b-0 transition-all duration-300",
                  hunkIndex === currentHunkIndex ? "ring-2 ring-[var(--acc-500)] ring-opacity-50 shadow-lg" : "",
                  // Add extra padding after the last hunk for better navigation visibility
                  hunkIndex === file.hunks.length - 1 ? "pb-96" : ""
                )}
              >
                <div className={cn(
                  "px-4 py-2 text-xs font-mono transition-colors duration-300",
                  hunkIndex === currentHunkIndex 
                    ? "bg-[var(--acc-200)] text-[var(--acc-800)] border-l-4 border-[var(--acc-500)]" 
                    : "bg-[var(--base-250)] text-[var(--base-600)]"
                )}>
                  <div className="flex items-center justify-between">
                    <span>
                      @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                    </span>
                    
                    {/* Hunk Action Buttons */}
                    <div className="flex items-center space-x-1">
                      {onDiscardHunk && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDiscardHunk(file.filePath, hunk);
                          }}
                          className="px-1 py-0.5 hover:bg-red-100 hover:bg-opacity-50 rounded transition-colors"
                          title="Discard this hunk"
                        >
                          ❌
                        </button>
                      )}
                      {onValidateHunk && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onValidateHunk(file.filePath, hunk);
                          }}
                          className="px-1 py-0.5 hover:bg-green-100 hover:bg-opacity-50 rounded transition-colors"
                          title="Validate this hunk"
                        >
                          ✅
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {hunk.lines.map((line, lineIndex) => (
                    <DiffLine 
                      key={lineIndex} 
                      line={line} 
                      showLineNumbers={showLineNumbers}
                      onHoverLineNumber={() => setShowLineNumbers(true)}
                      onLeaveLineNumber={() => setShowLineNumbers(false)}
                      searchQuery={searchQuery}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Diff Line Component
interface DiffLineProps {
  line: GitDiffLine;
  showLineNumbers: boolean;
  onHoverLineNumber: () => void;
  onLeaveLineNumber: () => void;
  searchQuery?: string;
}

function DiffLine({ line, showLineNumbers, onHoverLineNumber, onLeaveLineNumber, searchQuery = "" }: DiffLineProps) {
  const getLineStyle = () => {
    switch (line.type) {
      case 'added':
        return "bg-green-100 text-green-800 border-l-4 border-green-500";
      case 'removed':
        return "bg-red-100 text-red-800 border-l-4 border-red-500";
      default:
        return "bg-[var(--base-100)] text-[var(--base-700)]";
    }
  };

  const getPrefix = () => {
    return ' '; // No prefix needed since color coding shows the line type
  };

  return (
    <div className={cn("px-4 py-1 font-mono text-sm flex", getLineStyle())}>
      <span 
        className={cn(
          "w-12 text-[var(--base-500)] text-right mr-4 select-none transition-opacity",
          showLineNumbers ? "opacity-100" : "opacity-0"
        )}
        onMouseEnter={onHoverLineNumber}
        onMouseLeave={onLeaveLineNumber}
      >
        {line.newLineNumber || line.oldLineNumber || ''}
      </span>
      <span className="w-4 text-center select-none">{getPrefix()}</span>
      <span className="flex-1 whitespace-pre-wrap break-all">
        {highlightSearchTerm(line.content, searchQuery)}
      </span>
    </div>
  );
}

// Directory Selection Page Component
// DirectorySelectionPage removed - using git project from context

// DirectorySelectionPage function removed - using git project from context

// Branch Selection Page Component
interface BranchSelectionPageProps {
  branches: GitBranch[];
  loading: boolean;
  error: string | null;
  selectedBaseBranch: string;
  selectedTargetBranch: string;
  selectedBaseCommit: string;
  selectedTargetCommit: string;
  baseBranchCommits: GitCommit[];
  targetBranchCommits: GitCommit[];
  loadingCommits: boolean;
  selectedDirectory: string;
  onBaseBranchChange: (branch: string) => void;
  onTargetBranchChange: (branch: string) => void;
  onBaseCommitChange: (commit: string) => void;
  onTargetCommitChange: (commit: string) => void;
  onCompare: () => void;
  onClose: () => void;
  onRetry: () => void;
  onBackToDirectory: () => void;
  isComparing: boolean;
}

function BranchSelectionPage({
  branches,
  loading,
  error,
  selectedBaseBranch,
  selectedTargetBranch,
  selectedBaseCommit,
  selectedTargetCommit,
  baseBranchCommits,
  targetBranchCommits,
  loadingCommits,
  selectedDirectory,
  onBaseBranchChange,
  onTargetBranchChange,
  onBaseCommitChange,
  onTargetCommitChange,
  onCompare,
  onClose,
  onRetry,
  onBackToDirectory,
  isComparing
}: BranchSelectionPageProps) {
  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--base-100)] relative">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--base-300)]">
        <div>
          <h1 className="text-2xl font-black text-[var(--acc-600)]">Branch Comparison</h1>
          <p className="text-sm text-[var(--base-600)] mt-1">
            Repository: <span className="font-mono">{selectedDirectory}</span>
          </p>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 bg-[var(--base-400)] text-[var(--base-700)] rounded hover:bg-[var(--base-500)] transition-colors"
        >
          Close
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-[var(--border)] border-[var(--acc-500)] mx-auto mb-4"></div>
              <p className="text-[var(--base-600)]">Loading branches...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <h3 className="text-red-800  mb-2">Error</h3>
            <p className="text-red-700 mb-4">{error}</p>
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && branches.length > 0 && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Branch Selection */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Base Branch */}
              <div className="space-y-4">
                <h3 className="text-lg  text-[var(--base-700)]">Base Branch</h3>
                <select
                  value={selectedBaseBranch}
                  onChange={(e) => onBaseBranchChange(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--base-300)] rounded-lg bg-[var(--base-100)] text-[var(--base-700)] focus:outline-none focus:ring-2 focus:ring-[var(--acc-500)]"
                >
                  <option value="">Select base branch...</option>
                  {branches.filter(branch => branch && branch.name).map(branch => (
                    <option key={String(branch.name)} value={String(branch.name)}>
                      {String(branch.name)} {branch.isCurrentBranch ? '(current)' : ''}
                    </option>
                  ))}
                </select>

                {/* Base Commit Selection */}
                {selectedBaseBranch && (
                  <div>
                    <label className="block text-sm  text-[var(--base-600)] mb-2">
                      Specific commit (optional)
                    </label>
                    <select
                      value={selectedBaseCommit}
                      onChange={(e) => onBaseCommitChange(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--base-300)] rounded-lg bg-[var(--base-100)] text-[var(--base-700)] focus:outline-none focus:ring-2 focus:ring-[var(--acc-500)]"
                    >
                      <option value="">Latest commit</option>
                      <option value="UNSTAGED">🔶 Unstaged Changes (Working Directory)</option>
                      <option value="STAGED">🟡 Staged Changes (Index)</option>
                      {baseBranchCommits.map(commit => (
                        <option key={commit.hash} value={commit.hash}>
                          {String(commit.hash).substring(0, 7)} - {String(commit.message).substring(0, 50)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Show staged/unstaged options even without branch selection */}
                {!selectedBaseBranch && (
                  <div>
                    <label className="block text-sm  text-[var(--base-600)] mb-2">
                      Or compare changes directly
                    </label>
                    <select
                      value={selectedBaseCommit}
                      onChange={(e) => onBaseCommitChange(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--base-300)] rounded-lg bg-[var(--base-100)] text-[var(--base-700)] focus:outline-none focus:ring-2 focus:ring-[var(--acc-500)]"
                    >
                      <option value="">Select option...</option>
                      <option value="UNSTAGED">🔶 Unstaged Changes (Working Directory)</option>
                      <option value="STAGED">🟡 Staged Changes (Index)</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Target Branch */}
              <div className="space-y-4">
                <h3 className="text-lg  text-[var(--base-700)]">Target Branch</h3>
                <select
                  value={selectedTargetBranch}
                  onChange={(e) => onTargetBranchChange(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--base-300)] rounded-lg bg-[var(--base-100)] text-[var(--base-700)] focus:outline-none focus:ring-2 focus:ring-[var(--acc-500)]"
                >
                  <option value="">Select target branch...</option>
                  {branches.filter(branch => branch && branch.name).map(branch => (
                    <option key={String(branch.name)} value={String(branch.name)}>
                      {String(branch.name)} {branch.isCurrentBranch ? '(current)' : ''}
                    </option>
                  ))}
                </select>

                {/* Target Commit Selection */}
                {selectedTargetBranch && (
                  <div>
                    <label className="block text-sm  text-[var(--base-600)] mb-2">
                      Specific commit (optional)
                    </label>
                    <select
                      value={selectedTargetCommit}
                      onChange={(e) => onTargetCommitChange(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--base-300)] rounded-lg bg-[var(--base-100)] text-[var(--base-700)] focus:outline-none focus:ring-2 focus:ring-[var(--acc-500)]"
                    >
                      <option value="">Latest commit</option>
                      <option value="UNSTAGED">🔶 Unstaged Changes (Working Directory)</option>
                      <option value="STAGED">🟡 Staged Changes (Index)</option>
                      {targetBranchCommits.map(commit => (
                        <option key={commit.hash} value={commit.hash}>
                          {String(commit.hash).substring(0, 7)} - {String(commit.message).substring(0, 50)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Show staged/unstaged options even without branch selection */}
                {!selectedTargetBranch && (
                  <div>
                    <label className="block text-sm  text-[var(--base-600)] mb-2">
                      Or compare changes directly
                    </label>
                    <select
                      value={selectedTargetCommit}
                      onChange={(e) => onTargetCommitChange(e.target.value)}
                      className="w-full px-3 py-2 border border-[var(--base-300)] rounded-lg bg-[var(--base-100)] text-[var(--base-700)] focus:outline-none focus:ring-2 focus:ring-[var(--acc-500)]"
                    >
                      <option value="">Select option...</option>
                      <option value="UNSTAGED">🔶 Unstaged Changes (Working Directory)</option>
                      <option value="STAGED">🟡 Staged Changes (Index)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Compare Button */}
            <div className="border-t pt-6">
              <button
                onClick={onCompare}
                disabled={!selectedBaseBranch && !selectedTargetCommit}
                className={cn(
                  "w-full px-6 py-3 rounded-lg  transition-colors",
                  (selectedBaseBranch || selectedTargetCommit) && !isComparing
                    ? "bg-[var(--acc-500)] text-white hover:bg-[var(--acc-600)]"
                    : "bg-[var(--base-300)] text-[var(--base-500)] cursor-not-allowed"
                )}
              >
                {isComparing ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-[var(--border)] border-white"></div>
                    <span>Comparing...</span>
                  </div>
                ) : (
                  "Compare"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Unified Diff Modal Component
interface UnifiedDiffModalProps {
  content: string;
  onClose: () => void;
  baseBranch: string;
  targetBranch: string;
  baseCommit?: string;
  targetCommit?: string;
}

function UnifiedDiffModal({ 
  content, 
  onClose, 
  baseBranch, 
  targetBranch, 
  baseCommit, 
  targetCommit
}: UnifiedDiffModalProps) {
  const copyToClipboard = () => {
    navigator.clipboard.writeText(content);
  };

  const downloadDiff = () => {
    let filename: string;
    
    if (targetCommit === 'UNSTAGED' || baseCommit === 'UNSTAGED') {
      filename = 'unstaged-changes.patch';
    } else if (targetCommit === 'STAGED' || baseCommit === 'STAGED') {
      filename = 'staged-changes.patch';
    } else {
      const baseRef = baseCommit ? baseCommit.substring(0, 7) : baseBranch;
      const targetRef = targetCommit ? targetCommit.substring(0, 7) : targetBranch;
      filename = `diff-${baseRef}-to-${targetRef}.patch`;
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[var(--base-100)] rounded-lg w-full h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--base-300)]">
          <div>
            <h2 className="text-xl font-black text-[var(--acc-600)]">Unified Diff</h2>
            <p className="text-sm text-[var(--base-600)]">
              {(targetCommit === 'UNSTAGED' || baseCommit === 'UNSTAGED') && "Unstaged changes (working directory vs HEAD)"}
              {(targetCommit === 'STAGED' || baseCommit === 'STAGED') && "Staged changes (index vs HEAD)"}
              {(targetCommit !== 'UNSTAGED' && targetCommit !== 'STAGED' && baseCommit !== 'UNSTAGED' && baseCommit !== 'STAGED') && 
                `Comparing ${baseCommit ? `${baseBranch}@${baseCommit.substring(0, 7)}` : baseBranch} → ${targetCommit ? `${targetBranch}@${targetCommit.substring(0, 7)}` : targetBranch}`}
            </p>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={copyToClipboard}
              className="px-3 py-1 bg-[var(--base-400)] text-[var(--base-700)] rounded hover:bg-[var(--base-500)] transition-colors text-sm"
            >
              Copy
            </button>
            <button
              onClick={downloadDiff}
              className="px-3 py-1 bg-[var(--acc-500)] text-white rounded hover:bg-[var(--acc-600)] transition-colors text-sm"
            >
              Download
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1 bg-[var(--base-400)] text-[var(--base-700)] rounded hover:bg-[var(--base-500)] transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="bg-[var(--base-200)] rounded-lg p-4 text-sm font-mono whitespace-pre-wrap overflow-auto text-[var(--base-700)]">
            {content || "No differences found between the selected refs."}
          </pre>
        </div>
      </div>
    </div>
  );
}