import { type CSSProperties, useMemo, useSyncExternalStore } from 'react';
import { useTheme } from '@/hooks/useTheme';

/**
 * Maps Ariana's theme to @pierre/diffs CSS variables.
 *
 * Two layers of overrides are needed because the Shiki theme injects
 * inline styles on the inner <pre data-diffs> element (e.g.
 * --diffs-dark-bg: #24292e). Inline styles beat inherited custom
 * properties, so the base color variables must be forced via
 * !important in unsafeCSS, while override-slot variables (which the
 * library reads with fallback) work fine from the host style prop.
 *
 * Font sizes use rem so they scale with Ctrl+/- zoom
 * (which changes documentElement.style.fontSize).
 */
export function getDiffsStyles(isDark: boolean): CSSProperties {
  return {
    // ── Override-slot variables (not clobbered by Shiki inline styles) ──

    // Addition backgrounds
    '--diffs-bg-addition-override': isDark
      ? 'hsla(122, 31%, 38%, 0.18)'
      : 'hsla(102, 61%, 70%, 0.18)',
    '--diffs-bg-addition-emphasis-override': isDark
      ? 'hsla(122, 31%, 38%, 0.35)'
      : 'hsla(102, 61%, 70%, 0.35)',
    '--diffs-bg-addition-number-override': isDark
      ? 'hsla(122, 31%, 38%, 0.12)'
      : 'hsla(102, 61%, 70%, 0.12)',
    '--diffs-fg-number-addition-override': isDark
      ? 'hsl(92, 73%, 78%)'
      : 'hsl(144, 80%, 27%)',

    // Deletion backgrounds
    '--diffs-bg-deletion-override': isDark
      ? 'hsla(355, 31%, 38%, 0.18)'
      : 'hsla(0, 61%, 70%, 0.18)',
    '--diffs-bg-deletion-emphasis-override': isDark
      ? 'hsla(355, 31%, 38%, 0.35)'
      : 'hsla(0, 61%, 70%, 0.35)',
    '--diffs-bg-deletion-number-override': isDark
      ? 'hsla(355, 31%, 38%, 0.12)'
      : 'hsla(0, 61%, 70%, 0.12)',
    '--diffs-fg-number-deletion-override': isDark
      ? 'hsl(24, 64%, 84%)'
      : 'hsl(0, 80%, 27%)',

    // Neutral overrides
    '--diffs-bg-context-override': isDark ? 'var(--darkest)' : 'var(--lightest)',
    '--diffs-bg-buffer-override': 'var(--background-darker)',
    '--diffs-bg-separator-override': 'var(--background)',
    '--diffs-bg-hover-override': isDark
      ? 'hsla(30, 0%, 74%, 0.08)'
      : 'hsla(50, 20%, 30%, 0.06)',

    // Line numbers
    '--diffs-fg-number-override': isDark
      ? 'hsla(30, 0%, 74%, 0.5)'
      : 'hsla(50, 20%, 30%, 0.4)',

    // Fonts (rem for zoom scaling)
    '--diffs-font-family': "'Work Sans Code', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Courier New', monospace",
    '--diffs-header-font-family': "'Work Sans', system-ui, -apple-system, sans-serif",
    '--diffs-font-size': '0.8125rem',
    '--diffs-line-height': '1.25rem',

    // Borders
    '--diffs-gap-style': isDark
      ? 'var(--border-width) solid hsl(30, 0%, 20%)'
      : 'var(--border-width) solid hsl(37, 20%, 85%)',
  } as CSSProperties;
}

/**
 * CSS injected into the Shadow DOM (@layer unsafe).
 *
 * The Shiki theme sets --diffs-light-bg, --diffs-dark-bg, etc. as
 * INLINE styles on <pre data-diffs>. The only way to override inline
 * styles from a stylesheet is !important.
 */
export function getDiffsUnsafeCSS(isDark: boolean): string {
  return `
    /* ── Force our theme colors over Shiki's inline styles ── */
    [data-diffs] {
      --diffs-light-bg: var(--lightest) !important;
      --diffs-dark-bg: var(--darkest) !important;
      --diffs-light: var(--foreground) !important;
      --diffs-dark: var(--foreground) !important;
      --diffs-light-addition-color: hsl(144, 80%, 27%) !important;
      --diffs-dark-addition-color: hsl(92, 73%, 78%) !important;
      --diffs-light-deletion-color: hsl(0, 80%, 27%) !important;
      --diffs-dark-deletion-color: hsl(24, 64%, 84%) !important;
      --diffs-light-modified-color: var(--accent) !important;
      --diffs-dark-modified-color: var(--accent) !important;
    }

    /* ── Responsive font sizing ── */
    @media (max-width: 768px) {
      :host {
        --diffs-font-size: 0.6875rem;
        --diffs-line-height: 1.0625rem;
      }
    }

    /* ── Border radius synced to our --radius ── */
    [data-diffs-header] {
      border-radius: var(--radius, 0.3rem) var(--radius, 0.3rem) 0 0;
      background: ${isDark ? 'var(--background-darker)' : 'var(--background)'};
    }

    [data-diffs] {
      border-radius: 0 0 var(--radius, 0.3rem) var(--radius, 0.3rem);
    }

    :host {
      border-radius: var(--radius, 0.3rem);
      overflow: hidden;
    }
  `;
}

// ── Shared options builders ──────────────────────────────────────────

const THEME_PAIR = { dark: 'github-dark' as const, light: 'github-light' as const };

function themeType(isDark: boolean): 'dark' | 'light' {
  return isDark ? 'dark' : 'light';
}

/** Options for inline tool diffs (Edit, MultiEdit) — unified, no file header, compact */
export function getInlineDiffOptions(isDark: boolean) {
  return {
    theme: THEME_PAIR,
    themeType: themeType(isDark),
    diffStyle: 'unified' as const,
    diffIndicators: 'none' as const,
    lineDiffType: 'word' as const,
    overflow: 'wrap' as const,
    disableFileHeader: true,
    unsafeCSS: getDiffsUnsafeCSS(isDark),
  };
}

/** Options for the full diff viewer — split on wide screens, unified on narrow */
export function getFullDiffOptions(isDark: boolean, isNarrow: boolean) {
  return {
    theme: THEME_PAIR,
    themeType: themeType(isDark),
    diffStyle: (isNarrow ? 'unified' : 'split') as 'unified' | 'split',
    diffIndicators: 'none' as const,
    lineDiffType: 'word' as const,
    overflow: 'wrap' as const,
    enableLineSelection: true,
    hunkSeparators: 'line-info' as const,
    unsafeCSS: getDiffsUnsafeCSS(isDark),
  };
}

// ── Responsive media query ───────────────────────────────────────────

const MD_QUERY = '(max-width: 768px)';

function subscribeToMediaQuery(callback: () => void) {
  const mql = window.matchMedia(MD_QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getIsNarrowSnapshot() {
  return window.matchMedia(MD_QUERY).matches;
}

function getIsNarrowServerSnapshot() {
  return false;
}

/** Hook: true when viewport is md or smaller (≤768px) */
export function useIsNarrow() {
  return useSyncExternalStore(subscribeToMediaQuery, getIsNarrowSnapshot, getIsNarrowServerSnapshot);
}

// ── Convenience hook: all diffs theming in one call ──────────────────

/** Returns memoized { styles, options } for the full diff viewer */
export function useFullDiffTheme() {
  const { isDark } = useTheme();
  const isNarrow = useIsNarrow();
  const styles = useMemo(() => getDiffsStyles(isDark), [isDark]);
  const options = useMemo(() => getFullDiffOptions(isDark, isNarrow), [isDark, isNarrow]);
  return { styles, options, isDark, isNarrow };
}

/** Returns memoized { styles, options } for inline tool diffs */
export function useInlineDiffTheme() {
  const { isDark } = useTheme();
  const styles = useMemo(() => getDiffsStyles(isDark), [isDark]);
  const options = useMemo(() => getInlineDiffOptions(isDark), [isDark]);
  return { styles, options, isDark };
}
