import { useEffect, useRef, useState } from 'react';
import { useOptionalTheme } from '../../shell/useTheme';
import { SUPPORTED_LANGUAGES } from '../i18n/messages';
import { useAuthLanguage } from '../i18n/useAuthLanguage';

const THEME_KEY = 'elevant-theme';

// Standalone fallback so the login still themes itself without a ThemeProvider.
function useLocalTheme(enabled) {
  const [theme, setTheme] = useState(() => (
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
  ));
  useEffect(() => {
    if (!enabled) return;
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { window.localStorage?.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
  }, [enabled, theme]);
  return { theme, toggleTheme: () => setTheme(value => (value === 'light' ? 'dark' : 'light')) };
}

function useAuthTheme() {
  const provided = useOptionalTheme();
  const local = useLocalTheme(!provided);
  return provided ?? local;
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function LanguageMenu() {
  const { language, setLanguage, t } = useAuthLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(code) {
    setLanguage(code);
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <div className="elv-lang" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="elv-control elv-lang-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t('controls.language')}: ${t(`controls.languageOption.${language}`)}`}
        onClick={() => setOpen(value => !value)}
      >
        <span>{language.toUpperCase()}</span>
        <span className="elv-lang-chevron" data-open={open}><ChevronIcon /></span>
      </button>
      {open && (
        <ul className="elv-lang-menu" role="menu" aria-label={t('controls.language')}>
          {SUPPORTED_LANGUAGES.map(code => (
            <li key={code} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={code === language}
                className="elv-lang-option"
                onClick={() => choose(code)}
              >
                <span className="elv-lang-code">{code.toUpperCase()}</span>
                {t(`controls.languageOption.${code}`)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AuthControls() {
  const { theme, toggleTheme } = useAuthTheme();
  const { t } = useAuthLanguage();

  function select(target) {
    if (target !== theme) toggleTheme();
  }

  return (
    <div className="elv-controls">
      <LanguageMenu />
      <span className="elv-controls-divider" aria-hidden="true" />
      <div className="elv-theme" role="group" aria-label={t('controls.theme')}>
        <button
          type="button"
          className="elv-control elv-theme-button"
          aria-pressed={theme === 'light'}
          aria-label={t('controls.light')}
          onClick={() => select('light')}
        >
          <SunIcon />
        </button>
        <button
          type="button"
          className="elv-control elv-theme-button"
          aria-pressed={theme === 'dark'}
          aria-label={t('controls.dark')}
          onClick={() => select('dark')}
        >
          <MoonIcon />
        </button>
      </div>
    </div>
  );
}
