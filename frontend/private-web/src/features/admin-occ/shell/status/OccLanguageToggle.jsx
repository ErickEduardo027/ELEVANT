'use client';

import { useTranslation } from '../../../../i18n/LanguageScope';
import { SUPPORTED_LANGUAGES } from '../../../../i18n/languageStore';
import { occShellMessages } from '../occShellMessages';

/**
 * Spanish or English for the OCC: a group of two buttons, the active one pressed. The group sits in a canvas well, so
 * the pressed slab reads the same on the bar and inside the account menu; its strong joint marks it without a hue,
 * where the ring and the shadow of the old toggle did. On a touch screen the group is 44 px high and each option
 * 44 px wide.
 */
export default function OccLanguageToggle({ className = '' }) {
  const { t, language, setLanguage } = useTranslation(occShellMessages);
  return (
    <div role="group" aria-label={t('language')}
      className={`flex h-8 shrink-0 items-center rounded border border-occ-line bg-occ-canvas p-0.5 text-xs font-semibold [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:p-0 ${className}`}>
      {SUPPORTED_LANGUAGES.map(code => (
        <button key={code} type="button" aria-pressed={code === language} aria-label={t(`languageOption.${code}`)}
          onClick={() => setLanguage(code)}
          className={`h-full min-w-8 rounded-sm border px-2 [@media(pointer:coarse)]:min-w-11 ${code === language
            ? 'border-occ-line-strong bg-occ-panel-raised text-occ-text'
            : 'border-transparent text-occ-muted hover:text-occ-text'}`}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
