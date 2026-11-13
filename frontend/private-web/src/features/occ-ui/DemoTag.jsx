import { useId } from 'react';
import { TAGS } from './statusVocabulary';

/**
 * The «Demo» provenance tag of the OCC: the word on 45° stripes, never a hue (ADR-0041 and ADR-0044; the word and
 * the texture come from TAGS.demo). The stripes are an SVG pattern, the way occ-ui draws a texture. The word is the
 * tag's own text node, so `getByText('Demo')` finds the tag itself and its siblings stay where they were.
 */
export default function DemoTag() {
  const patternId = `occ-demo-stripes-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <span
      data-occ-tag="demo"
      className="relative isolate inline-flex items-center overflow-hidden rounded-[2px] border border-occ-line-strong bg-occ-panel-raised px-1.5 text-xs font-semibold leading-5 text-occ-text"
    >
      <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 -z-10 h-full w-full">
        <defs>
          <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--occ-line)', strokeWidth: 3 }} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      {TAGS.demo.es}
    </span>
  );
}
