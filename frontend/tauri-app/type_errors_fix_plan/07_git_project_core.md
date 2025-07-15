# Git Project Core - Type Errors Fix Plan

## Feature Overview
The Git Project Core manages Git repositories as projects with multiple canvas branches. It handles repository initialization, branch management, and state persistence.

## Affected Files
- `src/types/GitProject.ts` (12 errors)
- `src/contexts/GitProjectContext.tsx` (2 errors)
- `src/GitProjectView.tsx` (10 errors)
- `src/components/ProjectSelector.tsx` (4 errors)

## Root Cause Analysis

### 1. **Missing Properties in GitProject Type**
The GitProject type is missing properties that are being accessed in the code:
```typescript
// GitProjectContext.tsx errors:
// Property 'repositoryId' does not exist on type 'GitProject'
// Property 'ensureRepositoryId' does not exist on type 'GitProject'
```

### 2. **Unsafe RGB Color Handling**
GitProject has RGB color values that can be undefined:
```typescript
// GitProject.ts - RGB values possibly undefined
const red = project.theme.red; // Error: red is possibly undefined
const green = project.theme.green; // Error: green is possibly undefined
const blue = project.theme.blue; // Error: blue is possibly undefined
```

### 3. **Unused Component State**
GitProjectView has many unused state variables, suggesting incomplete implementation:
```typescript
// 10 unused variables in GitProjectView.tsx
// - removeBackgroundAgent
// - getCanvasLockState
// - mergingCanvases
// - showWorkspaceInExplorer
// etc.
```

### 4. **Implicit Any Types**
Error handling in GitProjectContext has implicit any types:
```typescript
// Line 71: Parameter 'error' implicitly has an 'any' type
.catch(error => {
  console.error(error); // error is any
});
```

## Fixes Required

### Phase 1: Complete GitProject Type Definition
```typescript
// types/GitProject.ts
interface GitProject {
  id: string;
  name: string;
  path: string;
  repositoryId?: string; // Add missing property
  
  // Add missing method
  ensureRepositoryId(): Promise<string>;
  
  // Existing properties...
  canvases: GitProjectCanvas[];
  currentCanvas: string;
  theme: ProjectTheme;
}

// Or if it's a class method:
class GitProject {
  private _repositoryId?: string;
  
  get repositoryId(): string | undefined {
    return this._repositoryId;
  }
  
  async ensureRepositoryId(): Promise<string> {
    if (!this._repositoryId) {
      this._repositoryId = await this.generateRepositoryId();
    }
    return this._repositoryId;
  }
  
  private async generateRepositoryId(): Promise<string> {
    // Implementation
  }
}
```

### Phase 2: Fix RGB Color Handling
```typescript
// Define proper color type
interface ProjectTheme {
  red: number;
  green: number;
  blue: number;
  // Or make them optional with defaults
  // red?: number;
  // green?: number;
  // blue?: number;
}

// Add default values or validation
class GitProject {
  private validateTheme(theme: Partial<ProjectTheme>): ProjectTheme {
    return {
      red: theme.red ?? 128,
      green: theme.green ?? 128,
      blue: theme.blue ?? 128
    };
  }
  
  // Use in constructor
  constructor(data: GitProjectData) {
    this.theme = this.validateTheme(data.theme ?? {});
  }
}
```

### Phase 3: Clean Up GitProjectView
```typescript
// Remove unused state variables
const GitProjectView: React.FC<Props> = ({ project }) => {
  // Keep only what's actually used
  const [showCanvases, setShowCanvases] = useState(true);
  const [selectedCanvas, setSelectedCanvas] = useState<string | null>(null);
  
  // Remove unused:
  // - removeBackgroundAgent
  // - getCanvasLockState
  // - mergingCanvases
  // - showWorkspaceInExplorer
  // - canvasesHoveredRef
  // - getCanvasTaskCounts
  // - removeGitProject
  // - setShowCanvases (if showCanvases is always true)
  
  // ... rest of component
};
```

### Phase 4: Add Proper Error Typing
```typescript
// GitProjectContext.tsx
const handleError = (error: unknown) => {
  if (error instanceof Error) {
    console.error('GitProject error:', error.message);
    // Handle Error type
  } else if (typeof error === 'string') {
    console.error('GitProject error:', error);
    // Handle string error
  } else {
    console.error('GitProject unknown error:', error);
    // Handle unknown error
  }
};

// Use in promises
someAsyncOperation()
  .catch(handleError);
```

## Git Integration Issues

The GitProject class seems to be missing some core Git operations:
1. **Repository ID management** - Not properly implemented
2. **Branch synchronization** - May be incomplete
3. **Merge conflict resolution** - Error handling unclear

Consider adding:
```typescript
interface GitOperations {
  createBranch(name: string): Promise<void>;
  mergeBranch(source: string, target: string): Promise<MergeResult>;
  resolveConflicts(conflicts: Conflict[]): Promise<void>;
  getRepositoryStatus(): Promise<GitStatus>;
}

class GitProject implements GitOperations {
  async createBranch(name: string): Promise<void> {
    // Implementation
  }
  
  async mergeBranch(source: string, target: string): Promise<MergeResult> {
    // Implementation with proper error handling
  }
  
  // ... other operations
}
```

## Impact
- 28 total errors across git-related files
- Core functionality for project management
- Missing repository ID functionality may break features
- Color handling errors affect UI theming
- Unused state may indicate incomplete features

## Testing Strategy
1. Test project creation and initialization
2. Test repository ID generation and persistence
3. Test branch creation and switching
4. Test project theme customization
5. Test error scenarios (invalid git repo, permissions)
6. Test project deletion and cleanup
7. Verify git operations work with real repositories