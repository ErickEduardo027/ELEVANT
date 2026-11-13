'use client';

import { useTranslation } from '../../../../i18n/LanguageScope';
import OccPopover from '../../../occ-ui/OccPopover';
import { occShellMessages } from '../occShellMessages';
import OccLanguageToggle from './OccLanguageToggle';
import OccLegendButton from './OccLegendButton';
import { COARSE_TARGET, STATUS_BAR_LAYOUT } from './statusBarLayout';

// The legend opens from inside this menu, whose panel scrolls: from 640 px it is fixed to the screen, 8 px under the
// bar and on the right like the menu (below 640 px every popover already is), so the menu's panel never clips it.
const NESTED_LEGEND_PANEL = 'sm:fixed sm:right-2 sm:top-12';

function initialsOf(name = '') {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
}

/**
 * The account, at every width: a plate with the initials that opens the name, the role and «Cerrar sesión». Below
 * 1024 px it also holds «Leyenda» and the language, which leave the bar there. They mount only while the panel is
 * open and hide from 1024 px, so their accessible names never appear twice.
 */
export default function OccUserMenu({ user, onLogout, className = '' }) {
  const { t } = useTranslation(occShellMessages);
  const name = t('userMenu', { name: user?.name ?? '' });
  return (
    <OccPopover className={className} label={name} panelLabel={name} panelClassName="w-64"
      triggerClassName={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded border border-occ-line-strong bg-occ-panel-raised px-1.5 text-xs font-semibold text-occ-text hover:border-occ-muted ${COARSE_TARGET}`}
      trigger={<span aria-hidden="true">{initialsOf(user?.name)}</span>}>
      {({ close }) => (
        <div className="space-y-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-occ-text">{user?.name}</p>
            <p className="truncate text-xs text-occ-muted">{user?.role}</p>
          </div>
          <OccLegendButton className={STATUS_BAR_LAYOUT.legend.menu} panelClassName={NESTED_LEGEND_PANEL} />
          <OccLanguageToggle className={`w-max ${STATUS_BAR_LAYOUT.language.menu}`} />
          {onLogout ? (
            <div className="border-t border-occ-line pt-2">
              <button type="button" onClick={() => { close(); onLogout(); }}
                className="flex h-9 w-full items-center rounded px-2 text-left text-sm font-medium text-occ-text hover:bg-occ-panel [@media(pointer:coarse)]:h-11">
                {t('logout')}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </OccPopover>
  );
}
