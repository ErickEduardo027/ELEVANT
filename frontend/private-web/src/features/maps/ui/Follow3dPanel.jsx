'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { BUSINESS_TIME_ZONE } from '../../../services/businessDay';
import { buildMilestonePhases } from '../../occ-ui/milestonePhases';
import OccMilestoneStrip from '../../occ-ui/OccMilestoneStrip';
import OccPlate from '../../occ-ui/OccPlate';
import { PUJ_ARP } from '../core/cameraPresets';
import { useOccMap } from '../core/OccMapContext';
import { ORBIT_VIEW_NAMES } from '../kinematics/orbitCamera';
import { mapMessages } from '../mapMessages';
import { flightFacts, operationFacts } from './followPanelModel';

// The panel of «Seguir en 3D» (CN-30): in the right slot of the map while its camera orbits the followed aircraft
// (core/OccMap.jsx), collapsible. occ-map.css places it (.occ-map-follow-panel, M1): left of the map's control column,
// inside the top and bottom insets, so it covers neither the zoom group nor the rail and the rail's menus open over it;
// on a narrow map a sheet along the bottom, still left of the column. It is never measured into the insets: folded, its
// pill would feed the inset it is placed by. It shows:
// - the camera: the five views, turn / tilt / zoom in steps or held, «Restablecer vista», «Girar automáticamente» and
//   «Dejar de seguir» (Esc does the same; a drag on the map orbits, the wheel zooms);
// - the flight: the identity, the route, the instruments (altitude, speed, vertical rate, heading), the squawk, how far
//   from Punta Cana and when it arrives, and its phase, read twice a second from the map's own frames;
// - the operation of an ELEVANT flight from its map flight row (code, state, stand, the times of its leg, the delay, the
//   milestones by phase) and what the page adds of it (`operational(flight)`: `{ agents, services, notes }`, the names
//   of its assigned agents and services and notes of it, or a node). Other traffic shows the
//   flight alone.
// The content is this component's; `className` adds to where it sits.

const finite = value => typeof value === 'number' && Number.isFinite(value);
const noSubscription = () => () => {};
const nothing = () => null;
const HOLD_AFTER_MS = 320;

const BUTTON = 'flex min-h-10 min-w-10 items-center justify-center rounded border border-occ-line bg-occ-panel px-2 text-sm font-semibold text-occ-text hover:bg-occ-panel-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent';
const BUTTON_ON = 'flex min-h-10 min-w-10 items-center justify-center rounded border border-occ-accent bg-occ-accent-soft px-2 text-sm font-semibold text-occ-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent';

function Icon({ d, title = null }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden={title === null} focusable="false" className="h-4 w-4">
      <path d={d} style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
    </svg>
  );
}

const ICONS = Object.freeze({
  rotateLeft: 'M7 5 L3 8 L7 11 M3.5 8 H11 a5 5 0 0 1 0 10 H8',
  rotateRight: 'M13 5 L17 8 L13 11 M16.5 8 H9 a5 5 0 0 0 0 10 H12',
  tiltUp: 'M10 15 V4 M5.5 8.5 L10 4 L14.5 8.5',
  tiltDown: 'M10 5 V16 M5.5 11.5 L10 16 L14.5 11.5',
  zoomIn: 'M10 4 V16 M4 10 H16',
  zoomOut: 'M4 10 H16',
  collapse: 'M6 8 L10 12 L14 8',
  expand: 'M6 12 L10 8 L14 12',
});

/** A button that steps once on a click and, held, keeps turning (`hold(sign)` and `hold(0)`); a key steps once. */
function HoldButton({ label, icon, onStep, onHold }) {
  const timer = useRef(null);
  const held = useRef(false);
  const release = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (held.current) onHold(0);
    held.current = false;
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={BUTTON}
      onPointerDown={event => {
        if (event.button !== 0) return;
        onStep();
        timer.current = setTimeout(() => {
          held.current = true;
          onHold(1);
        }, HOLD_AFTER_MS);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      // A click from the keyboard (Enter, Space) steps once; one from the pointer already stepped on its press.
      onClick={event => {
        if (event.detail === 0) onStep();
      }}
    >
      <Icon d={icon} />
    </button>
  );
}

/** One instrument: its name and its reading, the reading large. */
function Reading({ label, value, unit = null }) {
  return (
    <div className="min-w-0 rounded border border-occ-line bg-occ-canvas px-2 py-1.5">
      <dt className="text-xs text-occ-muted">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1 font-mono text-lg font-semibold leading-6 text-occ-text">
        <span className="truncate">{value ?? '—'}</span>
        {unit !== null && value !== null && <span className="text-xs font-normal text-occ-muted">{unit}</span>}
      </dd>
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-occ-line py-1 last:border-b-0">
      <dt className="shrink-0 text-occ-muted">{label}</dt>
      <dd className="min-w-0 text-right text-occ-text">{children ?? '—'}</dd>
    </div>
  );
}

const signed = value => (value > 0 ? `+${value}` : String(value));

/**
 * The panel; nothing while the map does not follow in 3D. `flights` are the screen's map flight rows (the followed
 * flight's row is found by its key), `stationCode` the station's code (PUJ by default), `operational` what the page adds
 * of an ELEVANT flight's operation (a node, or a function of its row), `className` classes added to its own.
 */
export default function Follow3dPanel({ flights = null, stationCode = 'PUJ', operational = null, className = '' }) {
  const { follow, view3d } = useOccMap();
  const three = follow?.three ?? null;
  const { t, language, locale } = useTranslation(mapMessages);
  const [open, setOpen] = useState(true);
  const titleId = useId();
  const store = three?.subject ?? null;
  const subject = useSyncExternalStore(store?.subscribe ?? noSubscription, store?.get ?? nothing, store?.get ?? nothing);
  if (!three?.on) return null;
  const item = subject?.item ?? null;
  const rows = Array.isArray(flights) ? flights : (flights?.flights ?? null);
  const flight = item?.flightKey && Array.isArray(rows) ? rows.find(row => row?.flightKey === item.flightKey) ?? null : null;
  const facts = flightFacts(item, flight, { station: { code: stationCode, point: PUJ_ARP } });
  const operation = operationFacts(flight, item, { locale, language });
  const added = typeof operational === 'function' ? (flight ? operational(flight) : null) : operational;
  const isFacts = added !== null && typeof added === 'object' && !('$$typeof' in added)
    && (Array.isArray(added.agents) || Array.isArray(added.notes) || Array.isArray(added.services));
  const agents = isFacts ? (added.agents ?? []).filter(Boolean) : null;
  const services = isFacts && Array.isArray(added.services) ? added.services.filter(Boolean) : null;
  const notes = isFacts ? (added.notes ?? []).filter(Boolean) : [];
  const extra = isFacts ? null : added;
  const identifier = facts?.title ?? '—';
  const views = ORBIT_VIEW_NAMES;

  let altitude = null;
  if (facts?.altitude.ground) altitude = t('follow3d.ground');
  else if (finite(facts?.altitude.ft)) altitude = new Intl.NumberFormat(locale).format(facts.altitude.ft);
  let distance = null;
  if (finite(facts?.distanceNm)) {
    distance = finite(facts.etaMin)
      ? t('follow3d.distanceEta', { nm: facts.distanceNm.toFixed(1), min: facts.etaMin })
      : t('follow3d.distanceOnly', { nm: facts.distanceNm.toFixed(1) });
  }
  let delay = null;
  if (finite(operation?.delayMin)) {
    if (Math.abs(operation.delayMin) < 3) delay = t('follow3d.onTime');
    else if (operation.delayMin > 0) delay = t('follow3d.delayMin', { min: operation.delayMin });
    else delay = t('follow3d.earlyMin', { min: -operation.delayMin });
  }
  let view3dNotice = null;
  if (view3d?.follow === 'failed') view3dNotice = 'view3dFailed';
  else if (view3d?.notice === 'paused') view3dNotice = 'view3dPaused';

  return (
    <aside
      aria-labelledby={titleId}
      data-testid="follow-3d-panel"
      data-follow-view={three.view ?? ''}
      data-open={open ? 'true' : 'false'}
      className={`occ-map-follow-panel pointer-events-auto flex flex-col overflow-hidden rounded-[var(--occ-radius-overlay)] border border-occ-line border-l-2 border-l-occ-accent bg-occ-panel-float text-sm text-occ-text ${className}`.trim()}
    >
      <header className="flex items-center gap-2 border-b border-occ-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="sr-only">{t('follow3d.panel', { id: identifier })}</h2>
          <p aria-hidden="true" className="truncate font-mono text-base font-semibold leading-6">{identifier}</p>
          {facts?.subtitle && <p className="truncate text-xs text-occ-muted">{facts.subtitle}</p>}
        </div>
        <button type="button" onClick={three.stop} className={`${BUTTON} border-occ-accent`} aria-keyshortcuts="Escape">
          {t('follow3d.stop')}
        </button>
        <button type="button" aria-expanded={open} aria-label={open ? t('follow3d.collapse') : t('follow3d.expand')}
          title={open ? t('follow3d.collapse') : t('follow3d.expand')} onClick={() => setOpen(value => !value)}
          className={BUTTON}>
          <Icon d={open ? ICONS.collapse : ICONS.expand} />
        </button>
      </header>

      {open && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
          <section aria-label={t('follow3d.camera')} className="space-y-2">
            <div role="radiogroup" aria-label={t('follow3d.camera')} className="grid grid-cols-3 gap-1">
              {views.map(view => (
                <button key={view} type="button" role="radio" aria-checked={three.view === view}
                  onClick={() => three.setView(view)}
                  className={`${three.view === view ? BUTTON_ON : BUTTON} text-xs`}>
                  {t(`follow3d.views.${view}`)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <HoldButton label={t('follow3d.rotateLeft')} icon={ICONS.rotateLeft} onStep={() => three.rotate(-1)}
                onHold={sign => three.hold('rotate', -sign)} />
              <HoldButton label={t('follow3d.rotateRight')} icon={ICONS.rotateRight} onStep={() => three.rotate(1)}
                onHold={sign => three.hold('rotate', sign)} />
              <HoldButton label={t('follow3d.tiltUp')} icon={ICONS.tiltUp} onStep={() => three.tilt(1)}
                onHold={sign => three.hold('tilt', sign)} />
              <HoldButton label={t('follow3d.tiltDown')} icon={ICONS.tiltDown} onStep={() => three.tilt(-1)}
                onHold={sign => three.hold('tilt', -sign)} />
              <HoldButton label={t('follow3d.zoomIn')} icon={ICONS.zoomIn} onStep={() => three.zoom(1)}
                onHold={sign => three.hold('zoom', sign)} />
              <HoldButton label={t('follow3d.zoomOut')} icon={ICONS.zoomOut} onStep={() => three.zoom(-1)}
                onHold={sign => three.hold('zoom', -sign)} />
            </div>
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={three.reset} className={`${BUTTON} text-xs`}>{t('follow3d.reset')}</button>
              <button type="button" aria-pressed={three.auto} onClick={() => three.setAuto(!three.auto)}
                className={`${three.auto ? BUTTON_ON : BUTTON} text-xs`}>{t('follow3d.auto')}</button>
            </div>
            <p className="text-xs text-occ-muted">{t('follow3d.gestures')}</p>
            {view3dNotice !== null && (
              <p role="status" data-follow-3d-notice={view3dNotice} className="text-xs font-semibold text-occ-warn">
                {t(`follow3d.${view3dNotice}`)}
              </p>
            )}
          </section>

          {facts !== null && (
            <section aria-label={t('follow3d.flight')} className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {facts.type && <OccPlate kind="code">{facts.type}</OccPlate>}
                {facts.registration && <OccPlate kind="registration">{facts.registration}</OccPlate>}
                {(facts.from || facts.to) && (
                  <span className="font-mono text-sm font-semibold">{`${facts.from ?? '—'} – ${facts.to ?? '—'}`}</span>
                )}
                <span data-follow-phase={facts.phase} className="ml-auto text-xs font-semibold text-occ-accent">
                  {t(`follow3d.phases.${facts.phase}`)}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-1">
                <Reading label={t('follow3d.altitude')} value={altitude} unit={facts.altitude.ground ? null : 'ft'} />
                <Reading label={t('follow3d.speed')} value={facts.speedKt} unit="kt" />
                <Reading label={t('follow3d.vertical')} value={finite(facts.verticalFpm) ? signed(facts.verticalFpm) : null}
                  unit="ft/min" />
                <Reading label={t('follow3d.heading')}
                  value={finite(facts.headingDeg) ? `${String(facts.headingDeg).padStart(3, '0')}°` : null} />
              </dl>
              <dl>
                {facts.airline && <Fact label={t('follow3d.airline')}>{facts.airline}</Fact>}
                {facts.squawk && <Fact label={t('follow3d.squawk')}><span className="font-mono">{facts.squawk}</span></Fact>}
                {distance && <Fact label={t('follow3d.distance')}>{distance}</Fact>}
              </dl>
            </section>
          )}

          {operation !== null ? (
            <section aria-label={t('follow3d.operation')} className="space-y-2">
              <h3 className="text-xs font-semibold text-occ-muted">{t('follow3d.operation')}</h3>
              <dl>
                {operation.code && <Fact label={t('follow3d.code')}><span className="font-mono">{operation.code}</span></Fact>}
                {operation.status && <Fact label={t('follow3d.status')}>{operation.status}</Fact>}
                {!operation.imported && <Fact label={t('follow3d.status')}>{t('follow3d.notImported')}</Fact>}
                {operation.stand && (
                  <Fact label={t('follow3d.stand')}>
                    {operation.terminal ? t('follow3d.standTerminal', { stand: operation.stand, terminal: operation.terminal })
                      : operation.stand}
                  </Fact>
                )}
                <Fact label={t(`follow3d.times.${operation.direction}`)}>
                  {t('follow3d.timesLine', { scheduled: operation.scheduled ?? '—', estimated: operation.estimated ?? '—',
                    actual: operation.actual ?? '—' })}
                </Fact>
                {delay && <Fact label={t('follow3d.delay')}>{delay}</Fact>}
                {agents !== null && (
                  <Fact label={t('follow3d.agents')}>{agents.length > 0 ? agents.join(', ') : t('follow3d.noAgents')}</Fact>
                )}
                {services !== null && (
                  <Fact label={t('follow3d.services')}>
                    {services.length > 0 ? services.join(', ') : t('follow3d.noServices')}
                  </Fact>
                )}
              </dl>
              {notes.length > 0 && (
                <ul data-follow-notes="" className="space-y-0.5 text-xs font-semibold text-occ-warn">
                  {notes.map(note => <li key={note}>{note}</li>)}
                </ul>
              )}
              {operation.mismatch && (
                <p data-stand-mismatch="" className="text-xs font-semibold text-occ-warn">
                  {t('dataBlock.standMismatch', operation.mismatch)}
                </p>
              )}
              <OccMilestoneStrip phases={buildMilestonePhases(flight?.milestones, language)}
                status={operation.milestones.length > 0 ? 'ready' : 'empty'} timeZone={BUSINESS_TIME_ZONE} />
              {extra}
            </section>
          ) : (
            facts !== null && <p className="text-xs text-occ-muted">{t('follow3d.notElevant')}</p>
          )}
        </div>
      )}
    </aside>
  );
}
