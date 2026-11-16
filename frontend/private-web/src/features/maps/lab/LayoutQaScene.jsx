'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccPlate from '../../occ-ui/OccPlate';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { buildTaxiGraph } from '../airport/taxiGraph';
import { liveEngineCount } from '../core/mapEngine';
import OccMap from '../core/OccMap';
import MapDock from '../ui/MapDock';
import MapLegend from '../ui/MapLegend';
import MapPresetSwitcher from '../ui/MapPresetSwitcher';
import { LAB_PATH, LabPlate, frozenLabel, useFrozenMapClock } from './labChrome';
import {
  EMPTY_PROBE, QA_ATTENTION_FLAGS, QA_FLAG_LABELS, QA_SOURCE, nextProbe, probeSummary, qaFeatures, qaOverlay,
  qaStandRows, standFrame,
} from './layoutQa';

// The review scene of the MDPC airport layout in the map lab (`?scene=layout-qa`, development only; design C3): the
// generated layout as it comes out of OpenStreetMap and the ELEVANT points, drawn by layoutQa.js over the airfield, with
// a side list of the stands, flagged first, that frames each one, and a route probe: a click on two graph nodes draws
// the shortest taxi route between them with its length. A person reviews the stands here before signing the dataset off
// in scripts/maps/input/stand-overrides.json. It exposes `window.__occMapLab` like the other scenes (getCamera, project
// a `[lng, lat]`, a stand code or a node id, flyToPreset, whenIdle, liveMaps) plus qaFlagged() (the flagged codes, in
// the list's order) and flyToStandBox(code) (what a click on the list does) for the visual suite.

const DECIMAL = new Intl.NumberFormat('es', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const KIND_LABELS = Object.freeze({ contact: 'contacto', remote: 'remota', fbo: 'aviación local' });
// Where the heading comes from; a heading that follows its row says so among the flags already.
const HEADING_SOURCES = Object.freeze({ osm: 'rumbo de OSM', neighbour: 'rumbo de la vecina', manual: 'rumbo manual' });

const capitalize = text => (text ? `${text[0].toUpperCase()}${text.slice(1)}` : text);
const lowerFirst = text => (text ? `${text[0].toLowerCase()}${text.slice(1)}` : text);
// «Sin geometría OSM, caja recortada por la fila.»
const sentence = labels => `${capitalize(labels.map(lowerFirst).join(', '))}.`;

function ProbePanel({ probe, layout, onClear }) {
  const { title, detail } = probeSummary(probe, layout);
  return (
    <section aria-labelledby="layout-qa-probe" className="shrink-0 border-b border-occ-line px-4 py-3">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 id="layout-qa-probe" className="text-sm font-semibold text-occ-text">Sonda de ruta</h2>
        {probe.from !== null && (
          <button
            type="button"
            onClick={onClear}
            className="min-h-9 rounded border border-occ-line bg-occ-panel-raised px-3 text-sm font-semibold text-occ-text hover:border-occ-line-strong"
          >
            Borrar ruta
          </button>
        )}
      </div>
      <div role="status" className="mt-1">
        {title !== null && <p className="text-base font-semibold text-occ-text">{title}</p>}
        <p className="text-sm text-occ-muted">{detail}</p>
      </div>
    </section>
  );
}

// The marks of the review overlay, each a small crop drawn as layoutQa.js draws it, in its tokens.
const token = name => `var(--occ-${name})`;
const stroke = (colour, width, extra = {}) => ({ fill: 'none', stroke: token(colour), strokeWidth: width, ...extra });
const BOX = Object.freeze({ x: 3.5, y: 4.5, width: 13, height: 11 });
const CURVE = 'M2 14 C7 14 11 6 18 6';
const KEY = Object.freeze([
  { id: 'stand', label: 'Posición del plano', swatch: <rect {...BOX} style={stroke('text', 1.5)} /> },
  {
    id: 'flagged', label: 'Posición con marcas',
    swatch: <rect {...BOX} style={stroke('warn', 2, { strokeDasharray: '3 2' })} />,
  },
  { id: 'focus', label: 'Posición en revisión', swatch: <rect {...BOX} style={stroke('accent', 2.5)} /> },
  {
    id: 'arrow', label: 'Rumbo de la nariz',
    swatch: <path d="M10 16 V4 M6.5 7.5 L10 4 L13.5 7.5" style={stroke('text', 1.5, { strokeLinecap: 'round' })} />,
  },
  {
    id: 'point', label: 'Punto de ELEVANT',
    swatch: <circle cx="10" cy="10" r="4" style={{ fill: token('text'), stroke: token('nav'), strokeWidth: 1.5 }} />,
  },
  { id: 'gate', label: 'Puerta de OSM', swatch: <circle cx="10" cy="10" r="4" style={stroke('muted', 1.5)} /> },
  {
    id: 'osmLine', label: 'Línea de posición de OSM',
    swatch: <path d="M10 3 V17" style={stroke('faint', 2.5, { strokeLinecap: 'round' })} />,
  },
  {
    id: 'mismatch', label: 'A más de 15 m del centroide OSM',
    swatch: <path d="M3 15 L17 5" style={stroke('muted', 1.5, { strokeDasharray: '2 2' })} />,
  },
  { id: 'edge', label: 'Calle de rodaje del grafo', swatch: <path d={CURVE} style={stroke('text', 1.5)} /> },
  {
    id: 'leadin', label: 'Entrada a la posición',
    swatch: <path d="M3 10 H17" style={stroke('text', 1, { strokeDasharray: '3 2' })} />,
  },
  { id: 'cut', label: 'Fuera de la red principal', swatch: <path d={CURVE} style={stroke('warn', 3)} /> },
  {
    id: 'hold', label: 'Punto de espera',
    swatch: <circle cx="10" cy="10" r="4.5" style={{ fill: token('nav'), stroke: token('text'), strokeWidth: 2 }} />,
  },
  {
    id: 'apronHold', label: 'Espera de plataforma',
    swatch: <circle cx="10" cy="10" r="6.5" style={{ fill: token('nav'), stroke: token('text'), strokeWidth: 2 }} />,
  },
  {
    id: 'route', label: 'Ruta de la sonda',
    swatch: <path d={CURVE} style={stroke('accent', 3, { strokeLinecap: 'round' })} />,
  },
]);

function QaKey() {
  return (
    <section aria-labelledby="layout-qa-key" className="shrink-0 border-b border-occ-line px-4 py-3">
      <h2 id="layout-qa-key" className="text-sm font-semibold text-occ-text">Qué muestra el mapa</h2>
      <ul aria-labelledby="layout-qa-key" className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm text-occ-muted">
        {KEY.map(item => (
          <li key={item.id} className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="shrink-0">
              {item.swatch}
            </svg>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function rowDetail(row) {
  const parts = [];
  if (Object.hasOwn(HEADING_SOURCES, row.headingSource)) parts.push(HEADING_SOURCES[row.headingSource]);
  if (row.centroidDistanceM !== null) parts.push(`centroide OSM a ${DECIMAL.format(row.centroidDistanceM)} m`);
  if (row.gate !== null) parts.push(`puerta ${row.gate.ref} a ${DECIMAL.format(row.gate.distanceM)} m`);
  return parts.length === 0 ? null : `${capitalize(parts.join('; '))}.`;
}

function StandRow({ row, focused, onFrame }) {
  const itemRef = useRef(null);
  // The stand in review stays in sight in the list, also when the suite or a person frames it from elsewhere.
  useEffect(() => {
    if (focused) itemRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focused]);
  const attention = row.flags.filter(flag => QA_ATTENTION_FLAGS.includes(flag)).map(flag => QA_FLAG_LABELS[flag]);
  const notes = row.flags.filter(flag => !QA_ATTENTION_FLAGS.includes(flag)).map(flag => QA_FLAG_LABELS[flag] ?? flag);
  const detail = rowDetail(row);
  return (
    <li ref={itemRef}>
      <button
        type="button"
        aria-current={focused ? 'true' : undefined}
        onClick={() => onFrame(row.code)}
        className={`flex w-full items-start gap-2 border-l-2 py-2 pl-3 pr-4 text-left hover:bg-occ-panel-raised ${focused
          ? 'border-occ-accent bg-occ-panel-raised'
          : 'border-transparent'}`}
      >
        <span className="flex h-5 w-4 shrink-0 items-center">{row.flagged ? <OccGlyph name="attention" /> : null}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <OccPlate kind="stand">{row.code}</OccPlate>
            <span className="min-w-0 flex-1 truncate text-sm text-occ-muted">
              {`Terminal ${row.terminal}, ${KIND_LABELS[row.kind] ?? row.kind}, letra ${row.sizeLetter}`}
            </span>
            {row.headingTrue !== null && (
              <span className="shrink-0 font-mono text-xs text-occ-muted">{`${DECIMAL.format(row.headingTrue)}°`}</span>
            )}
          </span>
          {row.retired && <span className="mt-1 block text-sm text-occ-text">Retirada: no se dibuja en el OCC.</span>}
          {attention.length > 0 && <span className="mt-1 block text-sm text-occ-text">{sentence(attention)}</span>}
          {notes.length > 0 && <span className="block text-sm text-occ-muted">{sentence(notes)}</span>}
          {detail !== null && <span className="block text-sm text-occ-faint">{detail}</span>}
        </span>
      </button>
    </li>
  );
}

function StandList({ rows, focus, onFrame, reviewed }) {
  const flagged = rows.filter(row => row.flagged).length;
  return (
    <section aria-labelledby="layout-qa-stands" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-2 pt-3">
        <h2 id="layout-qa-stands" className="text-sm font-semibold text-occ-text">Posiciones</h2>
        <p className="text-sm text-occ-muted">
          {reviewed
            ? `${flagged} de ${rows.length} con marcas, ya revisadas por el dueño del producto. Haz clic en una para encuadrarla.`
            : `${flagged} de ${rows.length} con marcas que piden revisión. Haz clic en una para encuadrarla.`}
        </p>
      </div>
      <ul aria-label="Posiciones del plano" className="min-h-0 flex-1 overflow-y-auto border-t border-occ-line">
        {rows.map(row => <StandRow key={row.code} row={row} focused={row.code === focus} onFrame={onFrame} />)}
      </ul>
    </section>
  );
}

/** The review scene. `layout` is the MDPC dataset unless a test gives another one. */
export default function LayoutQaScene({ scene, basemap, frozenAt, layout = MDPC_LAYOUT }) {
  const mapRef = useRef(null);
  const [probe, setProbe] = useState(EMPTY_PROBE);
  const [focus, setFocus] = useState(null);
  useFrozenMapClock(frozenAt);

  const graph = useMemo(() => buildTaxiGraph(layout.taxiGraph), [layout]);
  const rows = useMemo(() => qaStandRows(layout), [layout]);
  const standsByCode = useMemo(() => new Map(layout.stands.map(stand => [stand.code, stand])), [layout]);
  const overlayData = useMemo(
    () => ({ [QA_SOURCE]: qaFeatures(layout, { probe, focus, graph }) }), [layout, probe, focus, graph],
  );
  // Read once, when the map starts, like every option of the engine.
  const [overlays] = useState(() => [qaOverlay()]);
  const [mapOptions] = useState(() => (frozenAt === null ? {} : { fadeDuration: 0 }));
  const reviewed = layout.stands.every(stand => stand.provenance?.qa === 'reviewed');

  const pick = useCallback(hit => {
    if (hit?.kind === 'node') setProbe(current => nextProbe(current, hit.id, graph));
  }, [graph]);
  const clearProbe = useCallback(() => setProbe(EMPTY_PROBE), []);

  const frameStand = useCallback(code => {
    const frame = standFrame(standsByCode.get(code));
    if (frame === null) return false;
    setFocus(code);
    return mapRef.current?.flyToBounds(frame) ?? false;
  }, [standsByCode]);

  useEffect(() => {
    // A stand code, a graph node id, or a `[lng, lat]`.
    const pointOf = target => {
      if (Array.isArray(target)) return target;
      return standsByCode.get(target)?.center ?? graph.nodes.get(target)?.p ?? null;
    };
    const lab = {
      scene: scene.id,
      getCamera: () => mapRef.current?.getCamera() ?? null,
      project: target => {
        const point = pointOf(target);
        return point ? mapRef.current?.project(point) ?? null : null;
      },
      flyToPreset: (view, options) => mapRef.current?.flyToPreset(view, options) ?? false,
      whenIdle: () => mapRef.current?.whenIdle() ?? Promise.resolve(false),
      liveMaps: liveEngineCount,
      qaFlagged: () => rows.filter(row => row.flagged).map(row => row.code),
      // The outline of the stand in review reaches the map before this returns (flushSync runs the map's effects), so
      // the next idle frame shows it.
      flyToStandBox: code => {
        let framed = false;
        flushSync(() => {
          framed = frameStand(code);
        });
        return framed;
      },
    };
    window.__occMapLab = lab;
    return () => {
      if (window.__occMapLab === lab) delete window.__occMapLab;
    };
  }, [scene.id, rows, standsByCode, graph, frameStand]);

  return (
    <>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-occ-line bg-occ-panel px-4 py-2">
        <Link href={LAB_PATH} className="rounded text-sm font-semibold text-occ-muted hover:text-occ-text">
          Escenas
        </Link>
        <span aria-hidden="true" className="text-occ-faint">/</span>
        <h1 className="text-sm font-semibold text-occ-text">{scene.title}</h1>
        <LabPlate>{reviewed ? 'Plano revisado' : 'Plano sin revisar'}</LabPlate>
        {basemap === 'none' && <LabPlate>Sin mapa base</LabPlate>}
        {frozenAt !== null && (
          <span className="font-mono text-xs text-occ-muted">Reloj fijo: {frozenLabel(frozenAt)}</span>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <OccMap
            ref={mapRef}
            testId="map-lab-map"
            defaultView={scene.view}
            layout={layout}
            overlays={overlays}
            overlayData={overlayData}
            onPick={pick}
            basemap={basemap !== 'none'}
            mapOptions={mapOptions}
          >
            <MapDock>
              <MapPresetSwitcher />
              <MapLegend defaultOpen={false} />
            </MapDock>
          </OccMap>
        </div>
        <aside aria-label="Revisión del plano" className="flex w-96 shrink-0 flex-col border-l border-occ-line bg-occ-panel">
          <ProbePanel probe={probe} layout={layout} onClear={clearProbe} />
          <QaKey />
          <StandList rows={rows} focus={focus} onFrame={frameStand} reviewed={reviewed} />
        </aside>
      </div>
    </>
  );
}
