import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { BodyTab } from '@/lib/tabs';

// Stable empty array reference to avoid infinite re-renders in Zustand selectors
const EMPTY_TABS: BodyTab[] = [];
const EMPTY_SET: Set<string> = new Set();

/**
 * Clean, centralized tab management hook
 * Single source of truth with atomic operations
 * Implements VS Code-like preview tab behavior:
 * - Non-interacted tabs are "preview" tabs (italic) and get replaced when opening another
 * - New tabs open after the last interacted tab
 */
export function useProjectTabs(projectId: string) {
  // Subscribe ONLY to this project's tabs - prevents unnecessary re-renders
  // IMPORTANT: Use stable EMPTY_TABS reference instead of [] to avoid infinite loop
  const tabs = useAppStore(state => state.projectTabs.get(projectId) ?? EMPTY_TABS);
  const focusedTab = useAppStore(state => state.projectFocusedTabs.get(projectId) ?? null);

  // Subscribe to interacted tabs for this project - this triggers re-renders when interacted state changes
  const interactedTabKeys = useAppStore(state => state.interactedTabs.get(projectId) ?? EMPTY_SET);

  // Low-level store actions (used internally, not exposed)
  const _setTabs = useAppStore(state => state.setProjectTabs);
  const _setFocused = useAppStore(state => state.setProjectFocusedTab);

  // Interacted tabs tracking - actions for mutations (read fresh from store to avoid stale closures)
  const _markTabInteracted = useAppStore(state => state.markTabInteracted);
  const _isTabInteracted = useAppStore(state => state.isTabInteracted); // Used in action callbacks
  const _clearTabInteracted = useAppStore(state => state.clearTabInteracted);
  const _getLastInteractedTabIndex = useAppStore(state => state.getLastInteractedTabIndex);

  // Helper: Check if two tabs are the same
  const tabsMatch = useCallback((tab1: BodyTab, tab2: BodyTab): boolean => {
    if (tab1.type !== tab2.type) return false;
    if (tab1.type === 'agent' && tab2.type === 'agent') return tab1.agentId === tab2.agentId;
    if (tab1.type === 'environment' && tab2.type === 'environment') return tab1.environmentId === tab2.environmentId;
    if (tab1.type === 'automation' && tab2.type === 'automation') return tab1.automationId === tab2.automationId;
    return false;
  }, []);

  // Helper: Check if a tab exists
  const isTabOpened = useCallback((tab: BodyTab): boolean => {
    return tabs.some(t => tabsMatch(t, tab));
  }, [tabs, tabsMatch]);

  // Helper: Generate unique key for a tab
  const getTabKey = useCallback((tab: BodyTab): string => {
    if (tab.type === 'agent') return `agent-${tab.agentId}`;
    if (tab.type === 'environment') return `environment-${tab.environmentId ?? 'new'}`;
    if (tab.type === 'automation') return `automation-${tab.automationId ?? 'new'}`;
    return 'unknown';
  }, []);

  /**
   * Check if a specific tab is interacted (not a preview tab)
   * Uses the subscribed interactedTabKeys to ensure reactivity
   */
  const isTabInteracted = useCallback((tab: BodyTab): boolean => {
    return interactedTabKeys.has(getTabKey(tab));
  }, [interactedTabKeys, getTabKey]);

  /**
   * Mark a tab as interacted (no longer a preview tab)
   */
  const markTabInteracted = useCallback((tab: BodyTab) => {
    _markTabInteracted(projectId, getTabKey(tab));
  }, [projectId, getTabKey, _markTabInteracted]);

  /**
   * Clear interacted state for a tab
   */
  const clearTabInteracted = useCallback((tab: BodyTab) => {
    _clearTabInteracted(projectId, getTabKey(tab));
  }, [projectId, getTabKey, _clearTabInteracted]);

  /**
   * Open a tab (or focus it if already open)
   * Implements VS Code-like preview tab behavior:
   * - If the focused tab is not interacted (preview tab), replace it
   * - New tabs are inserted after the last interacted tab
   */
  const openTab = useCallback((tab: BodyTab) => {
    // Fresh read from store to avoid stale closures
    const currentTabs = useAppStore.getState().projectTabs.get(projectId) ?? [];
    const currentFocused = useAppStore.getState().projectFocusedTabs.get(projectId);

    // Check if tab already exists
    const existingIndex = currentTabs.findIndex(t => tabsMatch(t, tab));

    if (existingIndex !== -1) {
      // Tab exists - just focus it
      _setFocused(projectId, tab);
    } else {
      // Tab doesn't exist - need to add it
      let newTabs: BodyTab[];

      // Check if current focused tab is a preview tab (not interacted)
      if (currentFocused && !_isTabInteracted(projectId, getTabKey(currentFocused))) {
        // Replace the preview tab with the new tab
        const focusedIndex = currentTabs.findIndex(t => tabsMatch(t, currentFocused));
        if (focusedIndex !== -1) {
          newTabs = [...currentTabs];
          newTabs[focusedIndex] = tab;
          // Clear interacted state for the replaced tab
          _clearTabInteracted(projectId, getTabKey(currentFocused));
        } else {
          // Focused tab not found in array (shouldn't happen), just append
          newTabs = [...currentTabs, tab];
        }
      } else {
        // No preview tab to replace - insert after last interacted tab
        const lastInteractedIndex = _getLastInteractedTabIndex(projectId, currentTabs, getTabKey);
        if (lastInteractedIndex === -1) {
          // No interacted tabs - append at the end
          newTabs = [...currentTabs, tab];
        } else {
          // Insert after the last interacted tab
          newTabs = [
            ...currentTabs.slice(0, lastInteractedIndex + 1),
            tab,
            ...currentTabs.slice(lastInteractedIndex + 1)
          ];
        }
      }

      _setTabs(projectId, newTabs);
      _setFocused(projectId, tab);
    }
  }, [projectId, tabsMatch, getTabKey, _setTabs, _setFocused, _isTabInteracted, _clearTabInteracted, _getLastInteractedTabIndex]);

  /**
   * Close a tab (with optional close-all)
   * Automatically focuses next tab if needed
   */
  const closeTab = useCallback((tab: BodyTab, closeAll: boolean = false) => {
    const currentTabs = useAppStore.getState().projectTabs.get(projectId) ?? [];
    const currentFocused = useAppStore.getState().projectFocusedTabs.get(projectId);

    if (closeAll) {
      // Clear interacted state for all tabs
      currentTabs.forEach(t => _clearTabInteracted(projectId, getTabKey(t)));
      _setTabs(projectId, []);
      _setFocused(projectId, null);
      return;
    }

    // Clear interacted state for the closed tab
    _clearTabInteracted(projectId, getTabKey(tab));

    const tabIndex = currentTabs.findIndex(t => tabsMatch(t, tab));
    const newTabs = currentTabs.filter(t => !tabsMatch(t, tab));
    _setTabs(projectId, newTabs);

    // If we closed the focused tab, focus the next available one (prefer nearby tab)
    if (currentFocused && tabsMatch(tab, currentFocused)) {
      if (newTabs.length > 0) {
        // Focus the tab at the same position, or the last one if we closed the last tab
        const nextIndex = Math.min(tabIndex, newTabs.length - 1);
        _setFocused(projectId, newTabs[nextIndex]);
      } else {
        _setFocused(projectId, null);
      }
    }
  }, [projectId, tabsMatch, getTabKey, _setTabs, _setFocused, _clearTabInteracted]);

  /**
   * Replace a tab with a new one (e.g., temp spec ID -> real spec ID)
   * Atomic operation - maintains focus if tab was focused
   * Also transfers interacted state from old to new tab
   */
  const replaceTab = useCallback((oldTab: BodyTab, newTab: BodyTab) => {
    const currentTabs = useAppStore.getState().projectTabs.get(projectId) ?? [];
    const currentFocused = useAppStore.getState().projectFocusedTabs.get(projectId);

    // Transfer interacted state from old to new tab
    if (_isTabInteracted(projectId, getTabKey(oldTab))) {
      _clearTabInteracted(projectId, getTabKey(oldTab));
      _markTabInteracted(projectId, getTabKey(newTab));
    }

    const newTabs = currentTabs.map(t => tabsMatch(t, oldTab) ? newTab : t);
    _setTabs(projectId, newTabs);

    // If old tab was focused, focus the new tab
    if (currentFocused && tabsMatch(oldTab, currentFocused)) {
      _setFocused(projectId, newTab);
    }
  }, [projectId, tabsMatch, getTabKey, _setTabs, _setFocused, _isTabInteracted, _clearTabInteracted, _markTabInteracted]);

  /**
   * Update tab metadata (e.g., unsaved changes flag)
   * Does NOT change tab identity or focus
   */
  const updateTab = useCallback((tabToUpdate: BodyTab, updates: Partial<BodyTab>) => {
    const currentTabs = useAppStore.getState().projectTabs.get(projectId) ?? [];

    const newTabs = currentTabs.map(t =>
      tabsMatch(t, tabToUpdate) ? { ...t, ...updates } as BodyTab : t
    );
    _setTabs(projectId, newTabs);
  }, [projectId, tabsMatch, _setTabs]);

  /**
   * Set focused tab directly (useful for restoring state)
   */
  const setFocused = useCallback((tab: BodyTab | null) => {
    _setFocused(projectId, tab);
  }, [projectId, _setFocused]);

  /**
   * Batch multiple tab operations together
   * Prevents multiple re-renders
   */
  const batchUpdate = useCallback((callback: (ops: {
    openTab: typeof openTab;
    closeTab: typeof closeTab;
    replaceTab: typeof replaceTab;
    updateTab: typeof updateTab;
    setFocused: typeof setFocused;
  }) => void) => {
    // All operations within callback will use the same store snapshot
    callback({ openTab, closeTab, replaceTab, updateTab, setFocused });
  }, [openTab, closeTab, replaceTab, updateTab, setFocused]);

  /**
   * Close all tabs that are "saved" (no unsaved changes)
   * Takes a function to check if a tab has unsaved changes
   * Agent tabs are always considered "saved" (safe to close)
   */
  const closeAllSaved = useCallback((hasUnsavedChanges: (tab: BodyTab) => boolean) => {
    const currentTabs = useAppStore.getState().projectTabs.get(projectId) ?? [];
    const currentFocused = useAppStore.getState().projectFocusedTabs.get(projectId);

    // Keep only tabs with unsaved changes (environment/automation)
    // Agent tabs are always safe to close (never have unsaved changes)
    const tabsToKeep = currentTabs.filter(t => {
      if (t.type === 'agent') return false; // Agent tabs are always safe to close
      return hasUnsavedChanges(t);
    });

    // Clear interacted state for closed tabs
    currentTabs.forEach(t => {
      if (!tabsToKeep.some(kept => tabsMatch(t, kept))) {
        _clearTabInteracted(projectId, getTabKey(t));
      }
    });

    _setTabs(projectId, tabsToKeep);

    // If focused tab was closed, focus the first remaining tab
    if (currentFocused && !tabsToKeep.some(t => tabsMatch(t, currentFocused))) {
      if (tabsToKeep.length > 0) {
        _setFocused(projectId, tabsToKeep[0]);
      } else {
        _setFocused(projectId, null);
      }
    }
  }, [projectId, tabsMatch, getTabKey, _setTabs, _setFocused, _clearTabInteracted]);

  /**
   * Count tabs with unsaved changes (for confirmation dialog)
   * Takes a function to check if a tab has unsaved changes
   * Agent tabs don't count as having unsaved changes
   */
  const countUnsavedTabs = useCallback((hasUnsavedChanges: (tab: BodyTab) => boolean): number => {
    const currentTabs = useAppStore.getState().projectTabs.get(projectId) ?? [];
    return currentTabs.filter(t => t.type !== 'agent' && hasUnsavedChanges(t)).length;
  }, [projectId]);

  /**
   * Reorder tabs after drag and drop
   * Takes the tab key that was dragged and the tab key it was dropped onto
   */
  const reorderTabs = useCallback((activeKey: string, overKey: string) => {
    if (activeKey === overKey) return;

    const currentTabs = useAppStore.getState().projectTabs.get(projectId) ?? [];
    const activeIndex = currentTabs.findIndex(t => getTabKey(t) === activeKey);
    const overIndex = currentTabs.findIndex(t => getTabKey(t) === overKey);

    if (activeIndex === -1 || overIndex === -1) return;

    // Create new array with reordered tabs
    const newTabs = [...currentTabs];
    const [movedTab] = newTabs.splice(activeIndex, 1);
    newTabs.splice(overIndex, 0, movedTab);

    _setTabs(projectId, newTabs);
  }, [projectId, getTabKey, _setTabs]);

  return {
    // State
    tabs,
    focusedTab,

    // Helpers
    isTabOpened,
    tabsMatch,
    getTabKey,
    isTabInteracted,

    // Actions (atomic and safe)
    openTab,
    closeTab,
    replaceTab,
    updateTab,
    setFocused,
    batchUpdate,
    markTabInteracted,
    clearTabInteracted,
    closeAllSaved,
    countUnsavedTabs,
    reorderTabs,
  };
}
