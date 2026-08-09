import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'elevant-theme';

function readInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Same mechanism as the Admin/OCC reference shell: a single `theme` state
// toggles the `dark` class on the document root, which Tailwind's
// `darkMode: 'class'` strategy picks up everywhere (Sidebar, Topbar,
// content, badges).
export function useTheme() {
  const [theme, setTheme] = useState(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage?.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(value => (value === 'light' ? 'dark' : 'light'));
  }, []);

  return { theme, toggleTheme };
}
