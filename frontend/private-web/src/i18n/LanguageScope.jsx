import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  DEFAULT_LANGUAGE, createTranslator, getLanguage, localeFor, setLanguage, subscribeLanguage,
} from './languageStore';

const LanguageScopeContext = createContext(false);

function useStoredLanguage() {
  return useSyncExternalStore(subscribeLanguage, getLanguage, () => DEFAULT_LANGUAGE);
}

// Marca un espacio que ya está traducido. Fuera de un scope el idioma efectivo
// es siempre español, de modo que los componentes compartidos con otros
// departamentos no quedan a medio traducir aunque la cuenta eligiera inglés.
export function LanguageScope({ children }) {
  const language = useStoredLanguage();

  useEffect(() => {
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = DEFAULT_LANGUAGE; };
  }, [language]);

  return <LanguageScopeContext.Provider value>{children}</LanguageScopeContext.Provider>;
}

export function useLanguage() {
  const inScope = useContext(LanguageScopeContext);
  const stored = useStoredLanguage();
  const language = inScope ? stored : DEFAULT_LANGUAGE;
  return { language, locale: localeFor(language), setLanguage, inScope };
}

export function useTranslation(messages) {
  const { language, locale, setLanguage: select, inScope } = useLanguage();
  const t = useMemo(() => createTranslator(messages, language), [messages, language]);
  return { language, locale, setLanguage: select, inScope, t };
}
