'use client';

import { useTranslation } from '../../i18n/LanguageScope';
import DemoTag from './DemoTag';
import EstimatedTag from './EstimatedTag';
import OccGlyph from './OccGlyph';
import { occUiMessages } from './occUiMessages';
import { SIGNALS } from './statusVocabulary';

/** The marks a board's legend can name, in its order (dashboard/noc/boardModel.js: BOARD_LEGEND_KEYS). */
const MARKS = Object.freeze(['attention', 'urgent', 'demo', 'estimated', 'delay']);

/**
 * The legend of a board of flight strips, in its header (contratos 2.4: a board shows its legend there, as a list and
 * never as a button «Leyenda»; the map's legend is the screen's only one). It names only the marks of the strips on
 * screen, `keys` (boardLegendKeys), in the words of the status bar's «Leyenda»: each signal with its glyph and its word,
 * each tag as the strip draws it with what it means, and the delay chip (CN-32) with what it counts. `label` names the
 * list. Shared by the console's «Tablero» and Monitoreo de vuelos' «Tablero de vuelos». An unknown key throws.
 */
export default function OccBoardLegend({ keys, label, className = '' }) {
  const { t, language } = useTranslation(occUiMessages);
  for (const key of keys) if (!MARKS.includes(key)) throw new RangeError(`Unknown OCC board legend key: ${String(key)}`);
  return (
    <ul aria-label={label} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-occ-muted ${className}`.trim()}>
      {keys.map(key => {
        const signal = Object.hasOwn(SIGNALS, key);
        let words;
        if (signal) words = SIGNALS[key][language];
        else if (key === 'delay') words = t('delay.legend');
        else words = t(`legend.tagMeaning.${key}`);
        return (
          <li key={key} data-occ-legend-item={key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {signal ? <OccGlyph name={key} /> : null}
            {key === 'demo' ? <DemoTag /> : null}
            {key === 'estimated' ? <EstimatedTag /> : null}
            {key === 'delay' ? (
              <span aria-hidden="true"
                className="inline-flex items-center rounded-[2px] border border-occ-line-strong px-1 font-mono text-xs font-semibold leading-5 text-occ-text">
                +N
              </span>
            ) : null}
            <span>{words}</span>
          </li>
        );
      })}
    </ul>
  );
}
