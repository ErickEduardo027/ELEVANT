import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  createTranslator, getLanguage, resetLanguageForTests, setLanguage, subscribeLanguage,
} from '../../../i18n/languageStore';
import { messages } from './messages';

// Las pantallas de acceso leen la preferencia compartida sin provider, para que
// la elección sobreviva entre LoginPage y PasswordChangePage y llegue a OCC.
export function useAuthLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'es');

  useEffect(() => {
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = 'es'; };
  }, [language]);

  const t = useMemo(() => createTranslator(messages, language), [language]);

  return { language, setLanguage, t };
}

export function resetAuthLanguageForTests(language = 'es') {
  resetLanguageForTests(language);
}
