import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { OCC_DEFAULT_THEME, THEME_STORAGE_KEY, isOccPath } from './occTheme';

const ThemeContext = createContext(null);
const isTheme = value => value === 'light' || value === 'dark';

function readStored() {
  try {
    const value = window.localStorage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // A browser that refuses storage keeps the choice for this visit only.
  }
}

// Same mechanism as the Admin/OCC reference shell: a single `theme` value
// toggles the `dark` class on the document root, which Tailwind's
// `darkMode: 'class'` strategy picks up everywhere (Sidebar, Topbar,
// content, badges).
//
// Contexto compartido: antes cada consumidor de useTheme() tenía su propio
// useState independiente, así que alternar el tema desde un componente no se
// reflejaba en otro (p.ej. AppShell o los mapas de MapLibre) hasta el próximo
// montaje. Un solo Provider en la raíz del árbol resuelve esto sin cambiar la
// API pública de useTheme().
//
// Every department, the OCC included, reads and writes the same stored theme
// (`elevant-theme`). Only the default differs when nothing is stored: the OCC is
// dark, the other departments follow the system preference. Only a choice the
// account makes (toggleTheme) is written: a default never is, so the OCC stays
// dark for an account that has not chosen.
export function ThemeProvider({ children }) {
  const occ = isOccPath(usePathname());
  // The stored choice and the system preference arrive after mount: the server
  // and the first client render know neither.
  const [stored, setStored] = useState(null);
  const [system, setSystem] = useState('light');
  const theme = stored ?? (occ ? OCC_DEFAULT_THEME : system);

  // Before paint and ahead of the effect that applies the class, so a stored
  // light theme in the OCC (the boot script already applied it) is never
  // painted over with the dark default. The guard keeps the value when Strict
  // Mode runs the effects twice.
  useLayoutEffect(() => {
    const value = readStored();
    if (value !== null) setStored(current => current ?? value);
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) setSystem('dark');
  }, []);

  // Before paint, so a client navigation into the OCC never shows a frame of
  // the other theme (app/layout.jsx covers the first load with a boot script).
  // The route is a dependency because the Contracts, Finance and Governance
  // shells switch the class on their own: entering the OCC puts it back even
  // when the value did not change. As an effect it also runs again when React
  // remounts the tree in development, which can reset the attributes of <html>
  // and drop the class the boot script added.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme, occ]);

  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light';
    writeStored(next);
    setStored(next);
  }, [theme]);

  // The provider renders again on every navigation: keep the value stable so
  // its consumers do not.
  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
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
