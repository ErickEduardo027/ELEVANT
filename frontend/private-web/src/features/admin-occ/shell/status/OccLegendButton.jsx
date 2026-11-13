'use client';

import { useId } from 'react';
import { useTranslation } from '../../../../i18n/LanguageScope';
import { ALERT_PRIORITIES } from '../../../dashboard/noc/alertModel';
import OccGlyph from '../../../occ-ui/OccGlyph';
import OccPopover from '../../../occ-ui/OccPopover';
import OccStandSwatch from '../../../occ-ui/OccStandSwatch';
import { occUiMessages } from '../../../occ-ui/occUiMessages';
import { SIGNALS, STAND_STATE_KEYS, STAND_STATES, TAGS } from '../../../occ-ui/statusVocabulary';
import { occShellMessages } from '../occShellMessages';
import { STATUS_CONTROL, STATUS_CONTROL_REST } from './statusBarLayout';

const TAG_KEYS = Object.freeze(['demo', 'estimated', 'unofficial', 'stale']);

// The legend names each tag without its time: «Sin actualizar» rather than «Sin actualizar desde las {time}».
const tagWord = (key, language) => (key === 'stale' ? TAGS.stale.short[language] : TAGS[key][language]);

function LegendList({ title, children }) {
  const titleId = useId();
  return (
    <div>
      <h2 id={titleId} className="text-xs font-semibold text-occ-muted">{title}</h2>
      <ul aria-labelledby={titleId} className="mt-1.5 space-y-1.5">{children}</ul>
    </div>
  );
}

function LegendContent() {
  const { language } = useTranslation(occShellMessages);
  const { t } = useTranslation(occUiMessages);
  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-x-6">
      <LegendList title={t('legend.stands')}>
        {STAND_STATE_KEYS.map(key => (
          <li key={key} data-stand-state={key} className="flex items-center gap-2">
            <OccStandSwatch state={key} />
            <span>{STAND_STATES[key][language]}</span>
          </li>
        ))}
      </LegendList>
      <div className="space-y-4">
        <LegendList title={t('legend.signals')}>
          {ALERT_PRIORITIES.map(name => (
            <li key={name} data-signal={name} className="flex items-center gap-2">
              <OccGlyph name={name} />
              <span>{SIGNALS[name][language]}</span>
            </li>
          ))}
        </LegendList>
        <LegendList title={t('legend.tags')}>
          {TAG_KEYS.map(key => (
            <li key={key} data-tag={key} className="flex items-start gap-2">
              <OccStandSwatch tag={key} className="mt-0.5" />
              <span>
                <span className="block">{tagWord(key, language)}</span>
                <span className="block text-xs text-occ-muted">{t(`legend.tagMeaning.${key}`)}</span>
              </span>
            </li>
          ))}
        </LegendList>
      </div>
    </div>
  );
}

/**
 * «Leyenda», reachable from every OCC screen (owner's request, contratos 2.4): the seven stand states with their
 * drawing, the three signals with their glyph and the four tags with their texture, each with its word, from
 * statusVocabulary.js. The content mounts only while the panel is open. `panelClassName` adds to the panel's classes:
 * the account menu fixes it to the screen, so the menu's own panel does not clip it.
 */
export default function OccLegendButton({ className = '', panelClassName = '' }) {
  const { t } = useTranslation(occShellMessages);
  return (
    <OccPopover className={className} panelLabel={t('legend.label')}
      panelClassName={`w-72 sm:w-[30rem] ${panelClassName}`}
      triggerClassName={`${STATUS_CONTROL} ${STATUS_CONTROL_REST}`} trigger={t('legend.label')}>
      <LegendContent />
    </OccPopover>
  );
}
