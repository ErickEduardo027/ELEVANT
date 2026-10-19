// Preferencia de idioma de la cuenta en este navegador (es/en). Es un store de
// módulo, sin provider, para que el login y los espacios que la adoptan
// compartan la misma elección y sobreviva entre pantallas.
export const SUPPORTED_LANGUAGES = ['es', 'en'];
export const DEFAULT_LANGUAGE = 'es';

const STORAGE_KEY = 'elevant-language';
const LOCALES = { es: 'es-DO', en: 'en-US' };
const listeners = new Set();

function readStored() {
  try {
    return window.localStorage?.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function resolveInitialLanguage(storedValue) {
  return SUPPORTED_LANGUAGES.includes(storedValue) ? storedValue : DEFAULT_LANGUAGE;
}

let currentLanguage = resolveInitialLanguage(typeof window === 'undefined' ? null : readStored());

export function subscribeLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language) || language === currentLanguage) return;
  currentLanguage = language;
  try {
    window.localStorage?.setItem(STORAGE_KEY, language);
  } catch {
    // Storage can be unavailable; the in-memory choice still applies.
  }
  listeners.forEach(listener => listener());
}

export function resetLanguageForTests(language = DEFAULT_LANGUAGE) {
  currentLanguage = language;
  listeners.forEach(listener => listener());
}

export function localeFor(language) {
  return LOCALES[language] ?? LOCALES[DEFAULT_LANGUAGE];
}

function lookup(dictionary, path) {
  return path.split('.').reduce((node, key) => node?.[key], dictionary);
}

// `t('a.b', { n: 2 })`: idioma activo, luego español, luego la propia clave.
export function createTranslator(messages, language) {
  return (path, values) => {
    const text = lookup(messages[language], path) ?? lookup(messages[DEFAULT_LANGUAGE], path) ?? path;
    if (typeof text !== 'string' || !values) return text;
    return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  };
}
