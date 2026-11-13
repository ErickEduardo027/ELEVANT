import { describe, expect, it } from 'vitest';
import { haversineM, pointToPolylineM, toLocal } from '../../../src/features/maps/airport/geo.js';
import { HOLD_OFFSET_M, QA_FLAGS, STAND_ROWS, buildLayout, formatReport, stringifyLayout } from './buildLayout.mjs';

// A synthetic airport in a local plane (metres east and north of an invented origin): runway 09/27 along y = 300,
// taxiway «A» from the runway south to an apron lane along y = 100, a terminal south of the stands at y = -100, and
// stand lines placed to exercise every rule. Nothing here is the real extract.
const ORIGIN = [-60, 10];
const plane = toLocal(ORIGIN);
const at = (x, y) => plane.inverse([x, y]);
const latLon = (x, y) => {
  const [lon, lat] = at(x, y);
  return { lat, lon };
};

let nextNode = 1000;
function way(id, aeroway, points, { tags = {}, nodeIds } = {}) {
  const ids = nodeIds ?? points.map(() => { nextNode += 1; return nextNode; });
  return { type: 'way', id, tags: { aeroway, ...tags }, nodes: ids, geometry: points.map(([x, y]) => latLon(x, y)) };
}

function syntheticOsm({ withHold = false, withGateLine = false } = {}) {
  const elements = [
    way(1, 'runway', [[-1000, 300], [0, 300], [1000, 300]], { tags: { ref: '09/27' }, nodeIds: [11, 12, 13] }),
    way(2, 'taxiway', [[0, 300], [0, 200], [0, 100]], { tags: { ref: 'A' }, nodeIds: [12, 21, 22] }),
    way(3, 'taxiway', [[-400, 100], [0, 100], [400, 100]], { tags: { ref: 'L' }, nodeIds: [31, 22, 32] }),
    way(4, 'terminal', [[-400, -120], [400, -120], [400, -80], [-400, -80], [-400, -120]],
      { tags: { name: 'Terminal' }, nodeIds: [41, 42, 43, 44, 41] }),
    // A1's stand line, north–south through its point.
    way(51, 'parking_position', [[-100, -40], [-100, 40]]),
    // Two lines almost as near to AN1: ambiguous.
    way(52, 'parking_position', [[-320, -40], [-320, 40]]),
    way(53, 'parking_position', [[-285, -40], [-285, 40]]),
    // AN2's line starts 35 m north of it: matched, but its middle is 85 m away (far).
    way(54, 'parking_position', [[-200, 35], [-200, 135]]),
  ];
  if (withHold) {
    elements.push({ type: 'node', id: 99, tags: { aeroway: 'holding_position' }, ...latLon(0, 215) });
  }
  if (withGateLine) {
    // A second stand line 20 m west of A1's, which begins at the OSM gate «A1»: OSM ties it to A1, the point lies on
    // the other one.
    elements.push({ type: 'node', id: 77, tags: { aeroway: 'gate', ref: 'A1' }, ...latLon(-120, -40) });
    elements.push(way(55, 'parking_position', [[-120, -40], [-120, 40]], { nodeIds: [77, 78] }));
  }
  return { version: 0.6, osm3s: { timestamp_osm_base: '2026-01-02T03:04:05Z', copyright: 'test' }, elements };
}

const OUR_AIRPORTS = {
  meta: { fetchedAt: '2026-01-02T00:00:00Z' },
  airport: { icao: 'ZZZZ', iata: 'ZZZ', name: 'Test', lat: ORIGIN[1], lon: ORIGIN[0], elevationFt: 10 },
  runways: [{
    leIdent: '09', heIdent: '27', lengthM: 2000, widthM: 45, surface: 'ASP',
    le: { ident: '09', ...latLon(-1000, 300), elevationFt: 10, headingTrue: 90, displacedThresholdM: 0 },
    he: { ident: '27', ...latLon(1000, 300), elevationFt: 10, headingTrue: 270, displacedThresholdM: 0 },
  }],
  frequencies: [],
  navaids: [{ ident: 'PNA', name: 'Test', type: 'VOR-DME', frequencyKhz: 112700, ...latLon(500, 500), elevationFt: 1 }],
  regionalAirports: [],
};

const point = (id, terminal, x, y, extra = {}) => ({ id, terminal, ...latLon(x, y), ...extra });
const STAND_POINTS = [
  point('A1', 'A', -100, 0),
  point('A2', 'A', -40, 0),
  point('A3', 'A', 200, 0),
  point('AN1', 'A', -300, 0),
  point('AN2', 'A', -200, 0),
  point('B31', 'B', 100, 0),
  point('B32', 'B', 130, 0),
  point('B33', 'B', 160, -200, { retired: true }),
];
const OVERLAPPING = {
  schema: 1,
  aliases: {},
  stands: { B31: { headingTrue: 90, note: 'test' }, B32: { headingTrue: 0, note: 'test' } },
};

const build = (overrides = OVERLAPPING, osmOptions = {}) => buildLayout({
  osm: syntheticOsm(osmOptions), ourAirports: OUR_AIRPORTS, standPoints: STAND_POINTS, overrides,
});
const standOf = (layout, code) => layout.stands.find(stand => stand.code === code);

describe('buildLayout', () => {
  it('a stand without OSM geometry takes the heading of its row neighbour, else its row axis, and is flagged', () => {
    const { layout } = build();
    const a1 = standOf(layout, 'A1');
    expect(a1.provenance).toMatchObject({ center: 'elevant', polygon: 'osm:way/51', heading: 'osm', qa: 'auto' });
    // A contact stand faces the terminal (south).
    expect(a1.headingTrue).toBeCloseTo(180, 0);
    const a2 = standOf(layout, 'A2');
    expect(a2.provenance).toMatchObject({ polygon: 'derived', heading: 'neighbour', headingFrom: 'A1' });
    expect(a2.headingTrue).toBe(a1.headingTrue);
    expect(a2.qa.flags).toContain('unmatched');
    expect(a2.qa.flags).not.toContain('headingAssumed');
    const a3 = standOf(layout, 'A3');
    expect(a3.provenance.heading).toBe('row');
    expect(a3.headingTrue).toBeCloseTo(180, 0);
    expect(a3.qa.flags).toEqual(expect.arrayContaining(['unmatched', 'headingAssumed']));
    // A remote stand faces away from the taxi lane north of it.
    expect(standOf(layout, 'AN2').headingTrue).toBeCloseTo(180, 0);
    // Every centre is the internal point, untouched; the retired stand keeps its row but gets no lead-in.
    for (const stand of layout.stands) {
      const source = STAND_POINTS.find(candidate => candidate.id === stand.code);
      expect(haversineM(stand.center, [source.lon, source.lat]), stand.code).toBeLessThan(0.2);
    }
    const b33 = standOf(layout, 'B33');
    expect(b33.retired).toBe(true);
    expect(b33.leadIn).toBeNull();
    expect(STAND_ROWS.find(row => row.id === 'B32-B37').codes).toContain('B33');
  });

  it('overrides win over everything automatic; aliases stay empty', () => {
    const { layout } = build({
      schema: 1,
      aliases: {},
      stands: {
        ...OVERLAPPING.stands,
        A1: { osmWay: null, headingTrue: 10, sizeLetter: 'E', note: 'test', reviewedBy: 'Revisor', reviewedOn: '2026-01-03' },
        A3: { osmWay: 53, note: 'test' },
      },
    });
    const a1 = standOf(layout, 'A1');
    expect(a1.headingTrue).toBe(10);
    expect(a1.sizeLetter).toBe('E');
    expect(a1.provenance).toMatchObject({ polygon: 'derived', heading: 'manual', qa: 'reviewed', reviewedBy: 'Revisor' });
    expect(a1.qa.osmWay).toBeNull();
    expect(a1.note).toBe('test');
    expect(standOf(layout, 'A3').qa.osmWay).toBe(53);
    for (const stand of layout.stands) expect(stand.aliases, stand.code).toEqual([]);
    // An alias exists only when the manual table lists it.
    const withAlias = build({ ...OVERLAPPING, aliases: { X1: 'A1' } }).layout;
    expect(standOf(withAlias, 'A1').aliases).toEqual(['X1']);
    expect(standOf(withAlias, 'A2').aliases).toEqual([]);
  });

  it('holding points are derived 90 m from the centreline when OSM has none', () => {
    const { layout } = build();
    expect(layout.holdingPoints).toHaveLength(1);
    const [hold] = layout.holdingPoints;
    expect(hold).toMatchObject({ id: 'hp-A-09-27', runway: '09/27', taxiwayRef: 'A', source: 'derived' });
    expect(pointToPolylineM(hold.p, layout.runways[0].centerline).distanceM).toBeCloseTo(HOLD_OFFSET_M, 0);
    expect(layout.taxiGraph.nodes.find(node => node.id === hold.node).kind).toBe('hold');
    expect(layout.taxiGraph.nodes.find(node => node.id === 'n12').kind).toBe('exit');
    // An OSM holding position near that point replaces it.
    const fromOsm = build(OVERLAPPING, { withHold: true }).layout.holdingPoints;
    expect(fromOsm).toHaveLength(1);
    expect(fromOsm[0].source).toBe('osm');
    expect(pointToPolylineM(fromOsm[0].p, layout.runways[0].centerline).distanceM).toBeCloseTo(85, 0);
  });

  it('the report lists unmatched, ambiguous, far and overlap flags (synthetic inputs)', () => {
    const { layout, report } = build();
    expect(report.summary.unmatched).toEqual(['A2', 'A3', 'B31', 'B32']);
    expect(report.summary.ambiguous).toEqual(['AN1']);
    expect(report.summary.far).toEqual(['AN2']);
    expect(report.summary.overlap).toEqual(['B31', 'B32']);
    expect(standOf(layout, 'AN2').qa.centroidDistanceM).toBeCloseTo(85, 0);
    expect(standOf(layout, 'B31').qa.overlapMaxPct).toBeGreaterThan(15);
    const markdown = formatReport(report);
    expect(markdown).toContain('| Posición |');
    expect(markdown).toContain('| AN1 | A | remote | 53 | 15 |');
    expect(markdown).toContain('- overlap: 2 (B31, B32)');
    expect(markdown).toContain('- far: 1 (AN2)');
    expect(markdown).toContain('B33 (retirada)');
    // Every active stand is tied to the graph, and the layout carries its sources and the preferred runway.
    for (const stand of layout.stands.filter(candidate => !candidate.retired)) {
      expect(layout.taxiGraph.nodes.some(node => node.id === stand.node && node.kind === 'stand'), stand.code).toBe(true);
    }
    expect(layout.meta.sources.map(source => source.id)).toEqual(['osm', 'ourairports', 'elevant']);
    expect(layout.meta.sources[0].extractedAt).toBe('2026-01-02T03:04:05Z');
    expect(layout.operations.preferred).toEqual({ arrival: '08', departure: '08' });
  });

  it('a stand is ambiguous when OSM ties another candidate line to the gate of its own code', () => {
    const plain = build(OVERLAPPING).layout;
    expect(standOf(plain, 'A1').qa.flags).not.toContain('ambiguous');
    const { layout, report } = build(OVERLAPPING, { withGateLine: true });
    // The point lies on line 51; the line that begins at gate «A1» (55) is 20 m away: nothing in OSM decides.
    expect(standOf(layout, 'A1').qa).toMatchObject({ osmWay: 51, gate: { ref: 'A1' } });
    expect(standOf(layout, 'A1').qa.flags).toContain('ambiguous');
    expect(report.summary.ambiguous).toEqual(['A1', 'AN1']);
    // The review scene draws every OSM stand line, with the gate at its end.
    expect(layout.qa.standLines.map(line => [line.way, line.gate])).toEqual([[51, null], [52, null], [53, null], [54, null], [55, 'A1']]);
    expect(layout.qa.standLines[4].line[0]).toEqual(layout.qa.gates[0].p);
    // A person's choice in the manual table settles it, either way.
    for (const osmWay of [51, 55]) {
      const settled = build({ ...OVERLAPPING, stands: { ...OVERLAPPING.stands, A1: { osmWay, note: 'test' } } }, { withGateLine: true });
      expect(standOf(settled.layout, 'A1').qa.osmWay, String(osmWay)).toBe(osmWay);
      expect(standOf(settled.layout, 'A1').qa.flags, String(osmWay)).not.toContain('ambiguous');
    }
  });

  it('flags a box that a taxiway runs through and a lead-in that runs through another box', () => {
    const points = [
      ...STAND_POINTS.filter(item => item.id !== 'A3'),
      // Twenty metres south of the apron lane: the lane runs through its box.
      point('A3', 'A', 200, 80),
      // A column south of the lane: B35's lead-in from the lane runs through B34's box.
      point('B34', 'B', 300, -60),
      point('B35', 'B', 300, -150),
    ];
    const overrides = {
      ...OVERLAPPING,
      stands: { ...OVERLAPPING.stands, B34: { headingTrue: 180, note: 'test' }, B35: { headingTrue: 180, note: 'test' } },
    };
    const { layout, report } = buildLayout({ osm: syntheticOsm(), ourAirports: OUR_AIRPORTS, standPoints: points, overrides });
    expect(standOf(layout, 'A3').qa.flags).toContain('crossesTaxiway');
    expect(standOf(layout, 'B35').qa.flags).toContain('leadInCrosses');
    expect(standOf(layout, 'B34').qa.flags).not.toContain('leadInCrosses');
    expect(report.summary.crossesTaxiway).toEqual(['A3']);
    // B31 and B32 overlap on purpose in this airport: each one's lead-in runs through the other's box too.
    expect(report.summary.leadInCrosses).toEqual(['B31', 'B32', 'B35']);
    expect(formatReport(report)).toContain('- leadInCrosses: 3 (B31, B32, B35)');
    // The flags keep the generator's order: what needs a person first, then what only explains the box.
    expect(Object.keys(report.summary)).toEqual([...QA_FLAGS]);
    for (const stand of layout.stands) {
      expect(stand.qa.flags, stand.code).toEqual(QA_FLAGS.filter(flag => stand.qa.flags.includes(flag)));
    }
  });

  it('writes pairs on one line with 6 decimals and a final newline', () => {
    const { layout, region } = build();
    const text = stringifyLayout(layout);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toMatch(/"center": \[-?\d+(\.\d{1,6})?, -?\d+(\.\d{1,6})?\]/u);
    expect(text).not.toMatch(/\.\d{7,}/u);
    expect(region.navaids[0]).toMatchObject({ ident: 'PNA', frequencyLabel: '112.7' });
    expect(region.meta).toEqual({ source: 'OurAirports', license: 'public domain', extractedAt: '2026-01-02T00:00:00Z' });
  });
});
