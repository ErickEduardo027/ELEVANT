import { SIGNALS } from './statusVocabulary';

// The filled shapes of the three signals (contratos 2.4): an amber triangle with «!» asks for attention, a red octagon
// with «!» is urgent and a plain notice is a diamond without colour. They carry meaning, so they are not line icons
// (src/features/shell/components/icons.jsx) and never get restyled as one. Shape and colour come from SIGNALS.
const BODY = Object.freeze({
  triangle: 'M8 1.2 15.4 14.6H.6Z',
  octagon: 'M5.1.8h5.8l4.3 4.3v5.8l-4.3 4.3H5.1L.8 10.9V5.1Z',
  diamond: 'M8 1.4 14.6 8 8 14.6 1.4 8Z',
});

// The «!» of the two coloured shapes: a bar and a dot on the optical centre of each.
const MARK = Object.freeze({
  triangle: 'M7.15 5.6h1.7v4.6h-1.7ZM7.15 11.4h1.7v1.7h-1.7Z',
  octagon: 'M7.15 3.9h1.7v5h-1.7ZM7.15 10.3h1.7v1.7h-1.7Z',
});

// Only an unreceived urgent alert blinks, and never under reduced motion: there it keeps a static second outline.
const BLINK = 'motion-safe:animate-occ-alarm-blink motion-reduce:outline motion-reduce:outline-2 '
  + 'motion-reduce:outline-offset-2 motion-reduce:outline-occ-danger';

/** The ink drawn on a signal's fill: `--occ-warn` takes `--occ-on-warn`. */
export const signalInkToken = colorToken => colorToken.replace(/^--occ-/, '--occ-on-');

/**
 * The glyph of a signal: `name` is `attention`, `urgent` or `notice`. Next to its word it is hidden from assistive
 * technology; on its own it needs `title` and becomes an image with that name. `blink` only applies to `urgent`.
 * An unknown name throws, so a typo never draws a silent shape.
 */
export default function OccGlyph({ name, title, blink = false, className = '' }) {
  const signal = SIGNALS[name];
  if (!signal) throw new RangeError(`Unknown OCC signal: ${String(name)}`);
  const { shape, colorToken } = signal;
  const labelled = typeof title === 'string' && title.length > 0;
  const blinking = blink && name === 'urgent';
  const a11y = labelled ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };

  return (
    <svg viewBox="0 0 16 16" focusable="false" data-occ-glyph={name} data-shape={shape} {...a11y}
      className={`h-4 w-4 shrink-0 ${blinking ? BLINK : ''} ${className}`}>
      {labelled ? <title>{title}</title> : null}
      {colorToken
        ? <path data-part="body" d={BODY[shape]} style={{ fill: `var(${colorToken})` }} />
        : <path data-part="body" d={BODY[shape]} fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinejoin="round" />}
      {colorToken
        ? <path data-part="mark" d={MARK[shape]} style={{ fill: `var(${signalInkToken(colorToken)})` }} />
        : null}
    </svg>
  );
}
