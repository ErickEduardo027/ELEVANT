import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { SUPPORTED_LANGUAGES, messages, resolveInitialLanguage } from './messages';

const STORAGE_KEY = 'elevant-language';
const listeners = new Set();

function readStored() {
  try {
    return window.localStorage?.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let currentLanguage = resolveInitialLanguage(typeof window === 'undefined' ? null : readStored());

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language) || language === currentLanguage) return;
  currentLanguage = language;
  try {
    window.localStorage?.setItem(STORAGE_KEY, language);
  } catch {
    // Storage can be unavailable; the in-memory choice still applies.
  }
  listeners.forEach(listener => listener());
}

function lookup(dictionary, path) {
  return path.split('.').reduce((node, key) => node?.[key], dictionary);
}

// Module-level store so the login screens need no provider and the choice
// survives swapping between LoginPage and PasswordChangePage.
export function useAuthLanguage() {
  const language = useSyncExternalStore(subscribe, () => currentLanguage, () => 'es');

  useEffect(() => {
    document.documentElement.lang = language;
    return () => { document.documentElement.lang = 'es'; };
  }, [language]);

  const t = useCallback((path, values) => {
    const text = lookup(messages[language], path) ?? lookup(messages.es, path) ?? path;
    if (typeof text !== 'string' || !values) return text;
    return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  }, [language]);

  return { language, setLanguage, t };
}

export function resetAuthLanguageForTests(language = 'es') {
  currentLanguage = language;
  listeners.forEach(listener => listener());
}
