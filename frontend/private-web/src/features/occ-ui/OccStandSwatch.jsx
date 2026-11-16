'use client';

import { useId } from 'react';
import { STAND_STATES, TAGS } from './statusVocabulary';

// How a tag's texture (TAGS[*].texture) is drawn: Demo in 45° stripes, est. with a dashed outline, No oficial with a
// plain outline, Sin actualizar dimmed and with a clock.
const TAG_DRAWINGS = Object.freeze({
  'stripes-45': Object.freeze({ fill: 'stripes', fillToken: '--occ-line-strong', stroke: '--occ-line-strong',
    width: 1, dash: null, clock: null }),
  dashed: Object.freeze({ fill: 'none', fillToken: null, stroke: '--occ-muted', width: 1.5, dash: Object.freeze([3, 2]),
    clock: null }),
  outline: Object.freeze({ fill: 'none', fillToken: null, stroke: '--occ-line-strong', width: 1, dash: null, clock: null }),
  dimmed: Object.freeze({ fill: 'none', fillToken: null, stroke: '--occ-faint', width: 1, dash: null,
    clock: '--occ-faint' }),
});

// The two textures drawn with an SVG pattern and never with CSS: the thin hatch of a disabled stand and the wider
// stripes of Demo. Sizes are in viewBox units.
const PATTERNS = Object.freeze({
  hatch: Object.freeze({ size: 3, width: 1 }),
  stripes: Object.freeze({ size: 5, width: 2 }),
});

// A stand state reads its drawing from STAND_STATES: a see-through or solid fill paints its token as it is.
function drawingOf(state, tag) {
  if (state !== undefined) {
    const vocabulary = STAND_STATES[state];
    if (!vocabulary) throw new RangeError(`Unknown OCC stand state: ${String(state)}`);
    const { fill, outline, dash, extra } = vocabulary;
    return {
      fill: fill.kind === 'tint' || fill.kind === 'solid' ? 'paint' : fill.kind,
      fillToken: fill.token, stroke: outline.token, width: outline.width, dash,
      clock: extra === 'clock' ? outline.token : null,
    };
  }
  const vocabulary = TAGS[tag];
  if (!vocabulary) throw new RangeError(`Unknown OCC tag: ${String(tag)}`);
  return TAG_DRAWINGS[vocabulary.texture];
}

/**
 * A small sample of a stand state (`state`, a key of STAND_STATES) or of a tag's texture (`tag`, a key of TAGS), as
 * legends show them: the stand drawn on the canvas, with its fill, outline and dash. «Por liberar» adds its clock, the
 * one mark that tells it from «Ocupada». Next to its word it is hidden from assistive technology; on its own it needs
 * `title` and becomes an image with that name. An unknown state or tag throws.
 */
export default function OccStandSwatch({ state, tag, title, className = '' }) {
  const patternId = `occ-swatch-${useId()}`;
  const drawing = drawingOf(state, tag);
  const pattern = PATTERNS[drawing.fill] ?? null;
  const labelled = typeof title === 'string' && title.length > 0;
  const a11y = labelled ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true };
  let fill = 'none';
  if (pattern) fill = `url(#${patternId})`;
  else if (drawing.fill === 'paint') fill = `var(${drawing.fillToken})`;

  return (
    <svg viewBox="0 0 24 16" focusable="false" data-stand-state={state} data-tag={tag} data-fill={drawing.fill} {...a11y}
      className={`h-4 w-6 shrink-0 ${className}`}>
      {labelled ? <title>{title}</title> : null}
      {pattern ? (
        <defs>
          <pattern id={patternId} patternUnits="userSpaceOnUse" width={pattern.size} height={pattern.size}
            patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2={pattern.size}
              style={{ stroke: `var(${drawing.fillToken})`, strokeWidth: pattern.width }} />
          </pattern>
        </defs>
      ) : null}
      <rect data-part="ground" width="24" height="16" rx="2" style={{ fill: 'var(--occ-canvas)' }} />
      <rect data-part="stand" x="1.25" y="1.25" width="21.5" height="13.5" rx="1"
        style={{ fill, stroke: `var(${drawing.stroke})`, strokeWidth: drawing.width,
          strokeDasharray: drawing.dash ? drawing.dash.join(' ') : undefined }} />
      {drawing.clock ? (
        <g data-part="clock" fill="none" strokeWidth="1" strokeLinecap="round" style={{ stroke: `var(${drawing.clock})` }}>
          <circle cx="17" cy="8" r="3" />
          <path d="M17 6.4V8l1.1.8" />
        </g>
      ) : null}
    </svg>
  );
}
