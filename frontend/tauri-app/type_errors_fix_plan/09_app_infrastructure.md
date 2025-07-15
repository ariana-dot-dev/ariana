# App Infrastructure - Type Errors Fix Plan

## Feature Overview
The App Infrastructure includes core application setup, state management, main view routing, onboarding, and supporting utilities that don't belong to specific features.

## Affected Files
- `src/App.tsx` (8 errors)
- `src/state/index.tsx` (4 errors)
- `src/utils/MemoryTracker.ts` (10 errors)
- `src/main.tsx` (2 errors)
- `src/Onboarding.tsx` (2 errors)
- `src/components/CopyProgressBar.tsx` (3 errors)
- `src/components/OsSessionKindSelector.tsx` (3 errors)
- `src/scripting/interpreter.ts` (2 errors)
- `src/scripting/baseScript.ts` (2 errors)

## Root Cause Analysis

### 1. **Unused Imports in Core Files**
App.tsx has many unused imports, suggesting incomplete implementation:
```typescript
// App.tsx - 8 unused imports
import { useRef } from 'react'; // Never used
import CanvasView from './CanvasView'; // Never used
import Terminal from './canvas/Terminal'; // Never used
// ... etc
```

### 2. **Environment Variable Access**
Main.tsx has environment variable access that requires bracket notation:
```typescript
// main.tsx
process.env.TAURI_DEBUG // Error: must use bracket notation
process.env.NODE_ENV // Error: must use bracket notation
```

### 3. **Memory Tracker Unsafe Operations**
MemoryTracker.ts has multiple unsafe operations with possibly undefined values:
```typescript
// Memory measurements possibly undefined
lastMeasurement.heapUsed // Error: lastMeasurement is possibly undefined
firstMeasurement.timestamp // Error: firstMeasurement is possibly undefined
```

### 4. **Incomplete Component Implementations**
Several components have unused props or imports, suggesting incomplete implementation:
```typescript
// Onboarding.tsx
import { useEffect, useState } from 'react'; // useState never used
```

## Fixes Required

### Phase 1: Clean Up Core App Files
```typescript
// App.tsx - Remove unused imports
import React from 'react';
import { useAuth } from './hooks/useAuth';
import { useBuildConfig } from './hooks/useBuildConfig';
import GitProjectView from './GitProjectView';
// Remove unused imports:
// - useRef
// - CanvasView
// - Terminal
// - CanvasElement
// - Onboarding
// - osSessionGetWorkingDirectory
// - userEmail
// - isLightTheme

const App: React.FC = () => {
  const { user } = useAuth();
  const buildConfig = useBuildConfig();
  
  // Remove unused variables
  // const userEmail = user?.email;
  // const isLightTheme = theme === 'light';
  
  return (
    <div className="app">
      <GitProjectView />
    </div>
  );
};
```

### Phase 2: Fix Environment Variable Access
```typescript
// main.tsx
// Before
const isDebug = process.env.TAURI_DEBUG === 'true';
const isDev = process.env.NODE_ENV === 'development';

// After
const isDebug = process.env['TAURI_DEBUG'] === 'true';
const isDev = process.env['NODE_ENV'] === 'development';
```

### Phase 3: Strengthen Memory Tracker
```typescript
// utils/MemoryTracker.ts
interface MemoryMeasurement {
  heapUsed: number;
  heapTotal: number;
  external: number;
  timestamp: number;
}

class MemoryTracker {
  private measurements: MemoryMeasurement[] = [];
  
  recordMeasurement(): void {
    if (typeof performance !== 'undefined' && performance.memory) {
      this.measurements.push({
        heapUsed: performance.memory.usedJSHeapSize,
        heapTotal: performance.memory.totalJSHeapSize,
        external: performance.memory.totalJSHeapSize - performance.memory.usedJSHeapSize,
        timestamp: Date.now()
      });
    }
  }
  
  getLastMeasurement(): MemoryMeasurement | null {
    return this.measurements[this.measurements.length - 1] ?? null;
  }
  
  getFirstMeasurement(): MemoryMeasurement | null {
    return this.measurements[0] ?? null;
  }
  
  calculateMemoryDelta(): number {
    const first = this.getFirstMeasurement();
    const last = this.getLastMeasurement();
    
    if (!first || !last) {
      return 0;
    }
    
    return last.heapUsed - first.heapUsed;
  }
  
  generateReport(): string {
    const first = this.getFirstMeasurement();
    const last = this.getLastMeasurement();
    
    if (!first || !last) {
      return 'No memory measurements available';
    }
    
    const delta = this.calculateMemoryDelta();
    const duration = last.timestamp - first.timestamp;
    
    return `Memory Report:
      Initial: ${(first.heapUsed / 1024 / 1024).toFixed(2)} MB
      Final: ${(last.heapUsed / 1024 / 1024).toFixed(2)} MB
      Delta: ${(delta / 1024 / 1024).toFixed(2)} MB
      Duration: ${duration}ms`;
  }
}
```

### Phase 4: Complete Component Implementations
```typescript
// Onboarding.tsx
import React from 'react'; // Remove unused useEffect, useState
import { useAuth } from './hooks/useAuth';

const Onboarding: React.FC = () => {
  const { user, login } = useAuth();
  
  if (user) {
    return <div>Welcome back, {user.name}!</div>;
  }
  
  return (
    <div className="onboarding">
      <h1>Welcome to Ariana IDE</h1>
      <button onClick={login}>Get Started</button>
    </div>
  );
};

// CopyProgressBar.tsx
interface CopyProgressBarProps {
  progress: number; // 0-100
  filename?: string;
  status: 'copying' | 'completed' | 'error';
}

const CopyProgressBar: React.FC<CopyProgressBarProps> = ({
  progress,
  filename,
  status
}) => {
  // Remove exactOptionalPropertyTypes issues
  const displayFilename = filename ?? 'Unknown file';
  
  return (
    <div className="copy-progress-bar">
      <div className="progress-info">
        <span>{displayFilename}</span>
        <span>{progress}%</span>
      </div>
      <div className="progress-track">
        <div 
          className={`progress-fill ${status}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
```

## State Management Issues

The state management in `src/state/index.tsx` may need architectural review:
1. **Global state complexity** - May be doing too much
2. **Type safety** - Errors suggest loose typing
3. **Performance** - Large state objects can cause re-renders

Consider using a state management library or splitting state:
```typescript
// Split into domain-specific contexts
interface AppState {
  user: User | null;
  theme: Theme;
  settings: AppSettings;
}

interface ProjectState {
  currentProject: GitProject | null;
  recentProjects: GitProject[];
  canvases: GitProjectCanvas[];
}

interface AgentState {
  backgroundAgents: BackgroundAgent[];
  taskManager: TaskManager;
  executionHistory: ExecutionHistory;
}
```

## Impact
- 36 total errors across core infrastructure
- Affects application startup and basic functionality
- Memory tracking issues may hide performance problems
- Unused imports suggest incomplete features
- Environment variable issues may break builds

## Testing Strategy
1. Test application startup and initialization
2. Test environment variable handling across builds
3. Test memory tracking under various loads
4. Test onboarding flow for new users
5. Test component rendering with various prop combinations
6. Test error boundaries and recovery
7. Test state management with complex operations
8. Verify build process with strict TypeScript settings