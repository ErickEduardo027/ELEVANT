import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'elevant-theme';

function readInitialTheme() {
  return 'light';
}

  const ThemeContext = createContext(null);

// Same mechanism as the Admin/OCC reference shell: a single `theme` state
// toggles the `dark` class on the document root, which Tailwind's
// `darkMode: 'class'` strategy picks up everywhere (Sidebar, Topbar,
// content, badges).
//
// Contexto compartido: antes cada consumidor de useTheme() tenía su propio
// useState independiente, así que alternar el tema desde un componente
// (p.ej. DevPreviewPanel) no se reflejaba en otro (p.ej. AppShell o los
// mapas de MapLibre) hasta el próximo montaje. Un solo Provider en la raíz
// del árbol resuelve esto sin cambiar la API pública de useTheme().
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readInitialTheme);

  useEffect(() => {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    const preferred = stored === 'light' || stored === 'dark'
      ? stored
      : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (preferred !== theme) setTheme(preferred);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    window.localStorage?.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(value => (value === 'light' ? 'dark' : 'light'));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

// Null outside a ThemeProvider; lets standalone screens (login) degrade gracefully.
export function useOptionalTheme() {
  return useContext(ThemeContext);
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme debe usarse dentro de un ThemeProvider');
  }
  return context;
}
