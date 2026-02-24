import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/useAppStore';

interface ThemeInfo {
  isDark: boolean;
  isLight: boolean;
  isSystem: boolean;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

/**
 * Hook to get current theme state and setters.
 *
 * Returns:
 * - isDark: true if dark theme is currently active (either explicit or system)
 * - isLight: true if light theme is currently active (either explicit or system)
 * - isSystem: true if using system preference (can be true alongside isDark or isLight)
 * - theme: the raw theme setting ('light' | 'dark' | 'system')
 * - setTheme: function to change the theme
 */
export function useTheme(): ThemeInfo {
  const theme = useAppStore(state => state.theme);
  const setTheme = useAppStore(state => state.setTheme);

  const [isDark, setIsDark] = useState(() => {
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    // Update isDark based on actual DOM state
    const updateTheme = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };

    // Update immediately
    updateTheme();

    // Watch for system theme changes when theme is 'system'
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => {
        updateTheme();
      };

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  return {
    isDark,
    isLight: !isDark,
    isSystem: theme === 'system',
    theme,
    setTheme,
  };
}
