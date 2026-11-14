import DemoTag from './DemoTag';
import EstimatedTag from './EstimatedTag';
import OccGlyph from './OccGlyph';
import { OCC_STATUS_TONE_KEYS, STATUS_TONES } from './statusVocabulary';

export const OCC_STATUS_PILL_SIZES = Object.freeze(['md', 'sm']);

// The classes of each tone, named after the tokens of STATUS_TONES (a test reads them back): the word, the glyph of
// the four normal tones, and the slab that only the two signals get, on the 4 px control radius.
const TONE_CLASSES = Object.freeze({
  neutral: Object.freeze({ text: 'text-occ-text', glyph: 'text-occ-muted', container: '' }),
  active: Object.freeze({ text: 'text-occ-text', glyph: 'text-occ-text', container: '' }),
  done: Object.freeze({ text: 'text-occ-muted', glyph: 'text-occ-muted', container: '' }),
  muted: Object.freeze({ text: 'text-occ-faint', glyph: 'text-occ-faint', container: '' }),
  attention: Object.freeze({ text: 'text-occ-text', glyph: '', container: 'rounded bg-occ-warn-soft px-1.5' }),
  urgent: Object.freeze({ text: 'text-occ-text', glyph: '', container: 'rounded bg-occ-danger-soft px-1.5' }),
});

const SIZE_CLASSES = Object.freeze({ md: 'min-h-6 text-sm', sm: 'min-h-5 text-xs' });

// The four normal shapes, drawn in currentColor on the 16 px grid of OccGlyph.
function NormalGlyph({ shape, className }) {
  let body;
  if (shape === 'filled-circle') body = <circle cx="8" cy="8" r="5.5" fill="currentColor" />;
  else if (shape === 'check') {
    body = <path d="M3.4 8.6 6.5 11.6 12.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
      strokeLinejoin="round" />;
  } else {
    body = (
      <>
        <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {shape === 'slashed-circle'
          ? <path d="M4.4 11.6 11.6 4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          : null}
      </>
    );
  }
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true" data-shape={shape}
      className={`h-4 w-4 shrink-0 ${className}`}>
      {body}
    </svg>
  );
}

/**
 * The state of a row or a record (design F): its glyph and its word, never a colour alone (contratos 2.4).
 * - `tone`: one of STATUS_TONES. The four normal tones draw their own shape in currentColor; `attention` and `urgent`
 *   draw the triangle or the octagon of OccGlyph and are the only ones on a slab (`rounded` and their soft token). The
 *   glyph is hidden from assistive technology: the word next to it says the state.
 * - `label`: the word, always written as text («Planificada», «Revocada», «Sin agente»).
 * - `demo` adds the «Demo» tag and `estimated` the «est.» tag, after the word.
 * - `size`: `md` (14 px text) or `sm` (12 px, for dense tables).
 * `data-occ-status` and `data-tone` mark the pill; it takes `className` and forwards `data-testid`. An unknown tone or
 * size throws, like any vocabulary typo.
 */
export default function OccStatusPill({
  tone = 'neutral', label, demo = false, estimated = false, size = 'md', className = '', 'data-testid': testId,
}) {
  if (!OCC_STATUS_TONE_KEYS.includes(tone)) throw new RangeError(`Unknown OCC status tone: ${String(tone)}`);
  if (!OCC_STATUS_PILL_SIZES.includes(size)) throw new RangeError(`Unknown OCC status pill size: ${String(size)}`);
  const { shape } = STATUS_TONES[tone];
  const classes = TONE_CLASSES[tone];
  const signal = tone === 'attention' || tone === 'urgent';

  return (
    <span data-occ-status="" data-tone={tone} data-testid={testId}
      className={`inline-flex max-w-full items-center gap-1.5 font-medium ${SIZE_CLASSES[size]} ${classes.container} ${classes.text} ${className}`}>
      {signal ? <OccGlyph name={tone} /> : <NormalGlyph shape={shape} className={classes.glyph} />}
      <span className="min-w-0">{label}</span>
      {demo ? <DemoTag /> : null}
      {estimated ? <EstimatedTag /> : null}
    </span>
  );
}
