'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import { occShellMessages } from './occShellMessages';

/** The id of ShellFrame's `main`. */
export const MAIN_CONTENT_ID = 'main-content';

// Hidden until it has focus; then a raised slab at the top left, above the rail and the status bar.
const LINK = 'sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-toast focus:rounded focus:border '
  + 'focus:border-occ-line-strong focus:bg-occ-panel-raised focus:px-3 focus:py-2 focus:text-sm focus:font-semibold '
  + 'focus:text-occ-text';

/**
 * «Saltar al contenido» (design C.1 and H.2), the first focusable element of the OCC frame: OccSidebar renders it
 * before the rail. It moves focus into `main` without writing a fragment into the URL, so the screen's query stays as
 * it is. `main` takes `tabindex="-1"` for the move and drops it when focus leaves, so ShellFrame stays untouched and a
 * click inside `main` does not focus the whole region. Without a `main` on the page the browser follows the link.
 */
export default function OccSkipLink() {
  const { t } = useTranslation(occShellMessages);

  function skip(event) {
    const main = document.getElementById(MAIN_CONTENT_ID);
    if (!main) return;
    event.preventDefault();
    if (!main.hasAttribute('tabindex')) {
      main.setAttribute('tabindex', '-1');
      main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
    }
    main.focus();
  }

  return <a href={`#${MAIN_CONTENT_ID}`} onClick={skip} className={LINK}>{t('skipToContent')}</a>;
}
