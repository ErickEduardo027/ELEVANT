'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { mapMessages } from '../mapMessages';

// The hidden frame meter of an OCC map (PR M2, 2026-11-28): Ctrl+Alt+F shows and hides it (core/OccMap.jsx), for the
// presentation laptop and the VPS. It reads the map's meter (core/frameMeter.js: the frames MapLibre really drew over
// the last two seconds) twice a second: frames per second, the 95th percentile of the frame time, the GPU WebGL reports
// and the aircraft the animated layer drew. A flat slab at the top left of the area in sight (occ-map.css:
// .occ-map-frame-meter), no shadow, never in the way of a click.

export const FRAME_METER_READ_MS = 500;

const fixed = (value, digits) => (Number.isFinite(value) ? value.toFixed(digits) : '—');

/** The meter while it shows: `read()` → `{ fps, p95Ms, renderer, aircraft }`, read every FRAME_METER_READ_MS. */
export default function FrameMeter({ read }) {
  const { t } = useTranslation(mapMessages);
  const [reading, setReading] = useState(() => read());
  useEffect(() => {
    const timer = setInterval(() => setReading(read()), FRAME_METER_READ_MS);
    return () => clearInterval(timer);
  }, [read]);
  const rows = [
    ['fps', t('frameMeter.fps'), fixed(reading?.fps, 0)],
    ['p95', t('frameMeter.p95'), `${fixed(reading?.p95Ms, 1)} ms`],
    ['aircraft', t('frameMeter.aircraft'), Number.isFinite(reading?.aircraft) ? String(reading.aircraft) : '—'],
  ];
  return (
    <section data-testid="occ-frame-meter" aria-label={t('frameMeter.title')}
      className="occ-map-frame-meter pointer-events-none rounded-md border border-occ-line bg-occ-panel-float px-3 py-2 text-xs text-occ-text">
      <p className="font-semibold">{t('frameMeter.title')}</p>
      <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        {rows.map(([key, label, value]) => (
          <div key={key} data-frame-meter={key} className="contents">
            <dt className="text-occ-muted">{label}</dt>
            <dd className="text-right font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p data-frame-meter="renderer" className="mt-1 max-w-64 truncate text-occ-muted" title={reading?.renderer ?? undefined}>
        {t('frameMeter.gpu')}: {reading?.renderer ?? t('frameMeter.unknown')}
      </p>
    </section>
  );
}
