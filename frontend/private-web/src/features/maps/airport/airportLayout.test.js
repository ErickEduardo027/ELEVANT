import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RAMP_POSITIONS } from '../../dashboard/positionsData';
import {
  MDPC_LAYOUT,
  activeStands,
  indexLayout,
  layoutBounds,
  matchStand,
  standPolygonBounds,
} from './airportLayout';
import { convexIntersectionAreaM2, haversineM, polygonAreaM2 } from './geo';
import { connectedComponents, nearestEdge, reachableFrom } from './taxiGraph';

// Acceptance of the generated layout (design C3): what the manual review relies on, checked on every run. The
// OurAirports input is read relative to this package, as standCodes.test.js reads its vectors.
const ourAirports = JSON.parse(readFileSync('scripts/maps/input/ourairports.mdpc.json', 'utf8'));
const index = indexLayout(MDPC_LAYOUT);
const active = activeStands(MDPC_LAYOUT);

describe('MDPC layout', () => {
  it('has 42 stands, 41 active with polygon and heading, B33 retired', () => {
    expect(MDPC_LAYOUT.schema).toBe(1);
    expect(MDPC_LAYOUT.stands).toHaveLength(42);
    expect(active).toHaveLength(41);
    expect(MDPC_LAYOUT.stands.filter(stand => stand.retired).map(stand => stand.code)).toEqual(['B33']);
    for (const stand of active) {
      expect(stand.polygon, stand.code).toHaveLength(5);
      expect(stand.polygon[4], stand.code).toEqual(stand.polygon[0]);
      expect(Number.isFinite(stand.headingTrue), stand.code).toBe(true);
      expect(stand.headingTrue, stand.code).toBeGreaterThanOrEqual(0);
      expect(stand.headingTrue, stand.code).toBeLessThan(360);
      expect(['C', 'D', 'E', 'F'], stand.code).toContain(stand.sizeLetter);
      expect(stand.aliases, stand.code).toEqual([]);
      expect(stand.provenance.center, stand.code).toBe('elevant');
    }
    expect(Object.isFrozen(MDPC_LAYOUT.stands[0].polygon[0])).toBe(true);
  });

  it('every stand centre equals its positionsData point (owner decision 20)', () => {
    expect(MDPC_LAYOUT.stands.map(stand => stand.code)).toEqual(RAMP_POSITIONS.map(position => position.id));
    for (const position of RAMP_POSITIONS) {
      const stand = MDPC_LAYOUT.stands.find(candidate => candidate.code === position.id);
      expect(stand.center, position.id).toEqual([position.lon, position.lat]);
      expect(stand.terminal, position.id).toBe(position.terminal);
      expect(stand.retired, position.id).toBe(position.retired === true);
    }
  });

  it('every active stand reaches every runway exit on the graph and its lead-in touches the graph within 3 m', () => {
    const exits = MDPC_LAYOUT.taxiGraph.nodes.filter(node => node.kind === 'exit').map(node => node.id);
    expect(exits.length).toBeGreaterThanOrEqual(4);
    for (const stand of active) {
      expect(index.nodesById.get(stand.node)?.kind, stand.code).toBe('stand');
      // Taxiing only: no runway edge is needed to reach any exit.
      const reach = reachableFrom(index.graph, stand.node, { kinds: ['taxiway', 'taxilane', 'leadin'] });
      expect(exits.filter(exit => !reach.has(exit)), stand.code).toEqual([]);
      const start = stand.leadIn[0];
      const gap = nearestEdge(index.graph, start, { kinds: ['taxiway', 'taxilane'] }).distanceM;
      expect(gap, stand.code).toBeLessThanOrEqual(3);
      expect(stand.leadIn[stand.leadIn.length - 1], stand.code).toEqual(stand.center);
    }
    const retired = MDPC_LAYOUT.stands.find(stand => stand.code === 'B33');
    expect(retired.node).toBeNull();
    expect(retired.leadIn).toBeNull();
  });

  it('the taxi graph is one connected component', () => {
    const components = connectedComponents(index.graph);
    expect(components).toHaveLength(1);
    expect(components[0]).toHaveLength(MDPC_LAYOUT.taxiGraph.nodes.length);
    for (const edge of MDPC_LAYOUT.taxiGraph.edges) {
      expect(['taxiway', 'taxilane', 'leadin', 'runway']).toContain(edge.kind);
      expect(edge.m).toBeGreaterThan(0);
    }
    for (const hold of MDPC_LAYOUT.holdingPoints) expect(index.nodesById.has(hold.node), hold.id).toBe(true);
    expect(MDPC_LAYOUT.apronHolds.map(hold => hold.id)).toEqual(['ah-a', 'ah-b', 'ah-fbo']);
    for (const hold of MDPC_LAYOUT.apronHolds) expect(index.nodesById.get(hold.node).kind, hold.id).toBe('apronHold');
  });

  it('no two active stands overlap more than 15 percent', () => {
    for (const [at, stand] of active.entries()) {
      for (const other of active.slice(at + 1)) {
        const shared = convexIntersectionAreaM2(stand.polygon, other.polygon);
        const smaller = Math.min(polygonAreaM2(stand.polygon), polygonAreaM2(other.polygon));
        expect((shared / smaller) * 100, `${stand.code}/${other.code}`).toBeLessThanOrEqual(15);
      }
    }
  });

  it('thresholds of 08, 26, 09 and 27 are within 30 m of the OurAirports values', () => {
    const ends = MDPC_LAYOUT.runways.flatMap(runway => runway.ends);
    expect(ends.map(end => end.ident).sort()).toEqual(['08', '09', '26', '27']);
    const sourceEnds = ourAirports.runways.flatMap(runway => [runway.le, runway.he]);
    for (const end of ends) {
      const source = sourceEnds.find(candidate => candidate.ident === end.ident);
      expect(haversineM(end.threshold, [source.lon, source.lat]), end.ident).toBeLessThanOrEqual(30);
    }
    // The OSM centreline ends agree with those thresholds too.
    for (const runway of MDPC_LAYOUT.runways) {
      expect(haversineM(runway.centerline[0], runway.ends[0].threshold), runway.id).toBeLessThanOrEqual(30);
      expect(haversineM(runway.centerline[runway.centerline.length - 1], runway.ends[1].threshold), runway.id)
        .toBeLessThanOrEqual(30);
    }
  });

  it('operations.preferred is 08 for arrivals and departures, marked as an assumption', () => {
    expect(MDPC_LAYOUT.operations).toEqual({
      preferred: { arrival: '08', departure: '08' }, source: 'assumption', basis: 'owner-decision-19',
    });
  });

  it('matchStand normalizes A01 and a-1 to A1 and never matches 1, 9A or 23A with an empty alias table', () => {
    expect(matchStand('A01', index)).toEqual({ stand: expect.objectContaining({ code: 'A1' }), via: 'code' });
    expect(matchStand('a-1', index)?.stand.code).toBe('A1');
    expect(matchStand('b 020', index)?.stand.code).toBe('B20');
    for (const code of ['1', '9A', '23A', 'N1', '', null]) expect(matchStand(code, index), String(code)).toBeNull();
    // An alias matches only when the layout lists it.
    const withAlias = indexLayout({
      ...MDPC_LAYOUT,
      stands: MDPC_LAYOUT.stands.map(stand => (stand.code === 'A9' ? { ...stand, aliases: ['9A', 'A1'] } : stand)),
    });
    expect(matchStand('9A', withAlias)).toEqual({ stand: expect.objectContaining({ code: 'A9' }), via: 'alias' });
    // A stand's own code is never taken over by another stand's alias.
    expect(matchStand('A1', withAlias)).toEqual({ stand: expect.objectContaining({ code: 'A1' }), via: 'code' });
  });

  it('OSM gates 1–11 and N1–N5 are never matched to A or AN stands', () => {
    const refs = MDPC_LAYOUT.qa.gates.map(gate => gate.ref);
    expect(refs).toEqual(expect.arrayContaining(['1', '11', 'N1', 'N5', 'B20', 'B31']));
    for (const ref of refs.filter(value => /^N?\d+$/u.test(value))) expect(matchStand(ref, index), ref).toBeNull();
    for (const stand of MDPC_LAYOUT.stands.filter(candidate => /^AN?\d+$/u.test(candidate.code))) {
      expect(stand.qa.gate, stand.code).toBeNull();
    }
    const withGate = MDPC_LAYOUT.stands.filter(stand => stand.qa.gate !== null).map(stand => stand.code);
    expect(withGate).toEqual(['B20', 'B21', 'B22', 'B23', 'B24', 'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31']);
  });

  it('frames the airfield and the ramp', () => {
    const [[west, south], [east, north]] = layoutBounds(MDPC_LAYOUT);
    expect(west).toBeLessThan(-68.38);
    expect(east).toBeGreaterThan(-68.35);
    expect(south).toBeLessThan(18.5635);
    expect(north).toBeGreaterThan(18.578);
    const ramp = standPolygonBounds(MDPC_LAYOUT);
    expect(ramp[0][0]).toBeGreaterThan(west);
    expect(ramp[1][1]).toBeLessThan(north);
    const fbo = standPolygonBounds(MDPC_LAYOUT, { terminal: 'FBO' });
    expect(fbo[1][0]).toBeLessThan(standPolygonBounds(MDPC_LAYOUT, { terminal: 'A' })[0][0]);
    expect(standPolygonBounds(MDPC_LAYOUT, { terminal: 'Z' })).toBeNull();
  });
});
