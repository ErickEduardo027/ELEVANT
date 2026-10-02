import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'elevant-language';

export const SUPPORTED_LANGUAGES = ['es', 'en'];

// Spanish is the product default, not the browser's: the rest of the
// application is Spanish-only, so following navigator.language would hand an
// English login to a user who then lands on a Spanish dashboard.
function readInitialLanguage() {
  if (typeof window === 'undefined') return 'es';
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(stored) ? stored : 'es';
}

const LanguageContext = createContext(null);

// Same shape as ThemeProvider (./useTheme.jsx): a single state at the root of
// the tree, mirrored into the document and into localStorage by one effect, so
// every consumer reads the same value instead of keeping its own copy.
//
// `document.documentElement.lang` is updated alongside the stored value because
// index.html hardcodes `lang="es"`; screen readers and the browser's own
// hyphenation/translation heuristics read that attribute, not React state.
export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage?.setItem(STORAGE_KEY, language);
  }, [language]);

  const setLanguage = useCallback(value => {
    setLanguageState(current => (SUPPORTED_LANGUAGES.includes(value) ? value : current));
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage debe usarse dentro de un LanguageProvider');
  }
  return context;
}
