'use client';

import { useTranslation } from '../../../../i18n/LanguageScope';
import { MoonIcon, SunIcon } from '../../../shell/components/icons';
import { occShellMessages } from '../occShellMessages';
import { STATUS_CONTROL, STATUS_CONTROL_REST } from './statusBarLayout';

/**
 * Light or dark for the OCC (dark by default), as the Topbar of the other departments does: one icon button whose name
 * says the theme it switches to. `theme` and `onToggle` come from the shell (useTheme), so the choice is the account's
 * one for every department. Without `onToggle` it renders nothing.
 */
export default function OccThemeToggle({ theme, onToggle, className = '' }) {
  const { t } = useTranslation(occShellMessages);
  if (typeof onToggle !== 'function') return null;
  const light = theme === 'light';
  return (
    <button type="button" onClick={onToggle} aria-label={t(light ? 'themeToDark' : 'themeToLight')}
      className={`${STATUS_CONTROL} ${STATUS_CONTROL_REST} w-9 px-0 ${className}`}>
      {light ? <MoonIcon aria-hidden="true" className="h-4 w-4" /> : <SunIcon aria-hidden="true" className="h-4 w-4" />}
    </button>
  );
}
