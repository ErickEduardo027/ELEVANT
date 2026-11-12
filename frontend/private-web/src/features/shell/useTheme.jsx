import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isOccPath } from './occTheme';

const STORAGE_KEY = 'elevant-theme';

const ThemeContext = createContext(null);

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
// The OCC is dark only: while the route is under /admin-occ the theme is
// `dark`, `toggleTheme` does nothing and `elevant-theme` is not written.
// Every other department keeps the account's own theme.
export function ThemeProvider({ children }) {
  const occ = isOccPath(usePathname());
  // The account's own theme. It is light on the server and on the first client
  // render; the stored choice arrives after mount.
  const [userTheme, setUserTheme] = useState('light');
  const theme = occ ? 'dark' : userTheme;

  // Keep this effect ahead of the one that stores the theme: it has to read the
  // stored choice before the first light render is written over it. The guard
  // against the first render's value also keeps that choice when Strict Mode
  // runs the effects twice.
  useEffect(() => {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    const preferred = stored === 'light' || stored === 'dark'
      ? stored
      : window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (preferred !== userTheme) setUserTheme(preferred);
  }, []);

  // Before paint, so a client navigation into the OCC never shows a light frame
  // (app/layout.jsx covers the first load with a boot script). The route is a
  // dependency because the Contracts, Finance and Governance shells switch the
  // class on their own: entering the OCC puts it back even when the value did
  // not change. As an effect it also runs again when React remounts the tree in
  // development, which can reset the attributes of <html> and drop the class
  // the boot script added.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme, occ]);

  // Only the account's own theme is stored, and never from the OCC.
  useEffect(() => {
    if (!occ) window.localStorage?.setItem(STORAGE_KEY, userTheme);
  }, [occ, userTheme]);

  const toggleTheme = useCallback(() => {
    if (occ) return;
    setUserTheme(value => (value === 'light' ? 'dark' : 'light'));
  }, [occ]);

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
