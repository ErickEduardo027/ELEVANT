import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout.js';
import { haversineM, initialBearing, pointAlong, pointToPolylineM, toLocal } from '../airport/geo.js';
import { runwayEnd, runwayEnds } from '../airport/runwayInUse.js';
import { buildTaxiGraph, nearestEdge, routeLine } from '../airport/taxiGraph.js';
import { createKinematicsLayout, kinematicsPoint } from './kinematicsFixtures.js';
import {
  PUSHBACK_MAX_M,
  TAXI_COST,
  TAXI_MAX_SHIFT_M,
  TAXI_STEP_M,
  apronHoldFor,
  graphFor,
  routeExitToApronHold,
  routeExitToStand,
  routeFromApronHold,
  routeFromPoint,
  routeLandingTaxi,
  routeStandToHold,
  runwayExits,
  taxiCostFn,
  taxiPath,
} from './taxiRoute.js';

// The taxi routes on the signed Punta Cana layout (contracts 2.3): what the demo flight and the estimated flights
// will drive on. The synthetic aerodrome of kinematicsFixtures.js covers what Punta Cana cannot show.
const ACTIVE = MDPC_LAYOUT.stands.filter(stand => !stand.retired);
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// The F taxilane curves 7.7 m before BN9's lead-in: the U-turn into that stand fits a radius of about 8.6 m only,
// which is up to 35° per 5 m. Every other stand is entered on a radius of 20 m or more.
const TIGHT_ENTRY = Object.freeze({ BN9: 35 });

let memo = null;
/** Every runway's exits and the taxi from each of them to every active stand, that runway in use. */
function exitRoutes() {
  if (memo) return memo;
  memo = [];
  for (const runway of MDPC_LAYOUT.runways) {
    const end = runwayEnd(MDPC_LAYOUT, runway.ends[0].ident);
    for (const exit of runwayExits(MDPC_LAYOUT, end)) {
      for (const stand of ACTIVE) {
        const path = routeExitToStand(MDPC_LAYOUT, { exitNodeId: exit.nodeId, stand, activeRunwayIds: [runway.id] });
        memo.push({ runway, exit, stand, path });
      }
    }
  }
  return memo;
}

/** Planar distance from a point to a polyline. */
function distanceToLine(point, line) {
  let best = Infinity;
  for (let at = 0; at < line.length - 1; at += 1) {
    const [a, b] = [line[at], line[at + 1]];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
  }
  return best;
}

const maxTurn = headings => headings.slice(1).reduce((most, heading, at) => Math.max(most, angleBetween(heading, headings[at])), 0);

describe('taxi routes on the MDPC layout', () => {
  it('from every exit of each runway, with that runway in use, every active stand is reached by a connected, filleted route that uses no runway edge but the active one', { timeout: 60_000 }, () => {
    const routes = exitRoutes();
    const exitsPerRunway = MDPC_LAYOUT.runways.map(runway => new Set(routes.filter(route => route.runway === runway).map(route => route.exit.nodeId)).size);
    expect(exitsPerRunway).toEqual([8, 10]);
    expect(ACTIVE).toHaveLength(41);
    expect(routes).toHaveLength(18 * 41);
    const graph = graphFor(MDPC_LAYOUT);
    const problems = [];
    for (const { runway, exit, stand, path } of routes) {
      const label = `${exit.nodeId} → ${stand.code}`;
      if (path === null) {
        problems.push(`${label}: no route`);
        continue;
      }
      if (path.nodeIds[0] !== exit.nodeId || path.nodeIds[path.nodeIds.length - 1] !== stand.node) problems.push(`${label}: ends`);
      if (haversineM(path.coords[0], graph.nodes.get(exit.nodeId).p) > 0) problems.push(`${label}: start`);
      path.edges.forEach((edge, at) => {
        const joins = [edge.a, edge.b].sort().join() === [path.nodeIds[at], path.nodeIds[at + 1]].sort().join();
        if (!joins) problems.push(`${label}: edge ${at} is not connected`);
        if (edge.kind === 'runway' && edge.ref !== runway.id) problems.push(`${label}: runway ${edge.ref}`);
      });
      // Filleted and resampled: a sample every 5 m along the path, the last one at its end.
      for (let at = 1; at < path.alongM.length - 1; at += 1) {
        if (Math.abs(path.alongM[at] - path.alongM[at - 1] - TAXI_STEP_M) > 1e-6) problems.push(`${label}: spacing at ${at}`);
      }
      if (path.alongM[path.alongM.length - 1] !== path.lengthM || path.kinds.length !== path.coords.length) problems.push(`${label}: samples`);
      if (!path.turning.some(Boolean)) problems.push(`${label}: never turns`);
    }
    expect(problems).toEqual([]);
    // The runway the aircraft just left is never rolled on again, and the other runway is only crossed.
    expect(routes.filter(({ path }) => path.edges.some(edge => edge.kind === 'runway'))).toEqual([]);

    // On the synthetic aerodrome the inactive runway 05/23 offers 539 m against 2 150 m of taxi cost: it is avoided
    // until it is in use.
    const layout = createKinematicsLayout();
    const s1 = layout.stands.find(stand => stand.code === 'S1');
    expect(routeExitToStand(layout, { exitNodeId: 'x1', stand: s1, activeRunwayIds: ['09/27'] }).nodeIds)
      .toEqual(['x1', 'hp-A-09-27', 'j1', 'j2', 'l1', 'ls-S2', 'ah-t1', 'ls-S1', 'st-S1']);
    expect(routeExitToStand(layout, { exitNodeId: 'x1', stand: s1, activeRunwayIds: ['09/27', '05/23'] }).nodeIds)
      .toEqual(['x1', 'hp-A-09-27', 'j1', 'l0', 'ls-S1', 'st-S1']);
    expect(taxiCostFn({ activeRunwayIds: ['09/27'], closedRunwayIds: ['05/23'] })({ kind: 'runway', ref: '05/23', m: 5 })).toBe(Infinity);
    expect(taxiCostFn()({ kind: 'taxilane', m: 10 })).toBeCloseTo(10 * TAXI_COST.taxilane, 9);
  });

  it('every route ends at the stand centre on the lead-in heading, within 10° of the stand heading', { timeout: 60_000 }, () => {
    const problems = [];
    let worstOffLeadIn = 0;
    for (const { exit, stand, path } of exitRoutes()) {
      const label = `${exit.nodeId} → ${stand.code}`;
      const last = path.coords.length - 1;
      if (path.coords[last][0] !== stand.center[0] || path.coords[last][1] !== stand.center[1]) problems.push(`${label}: end`);
      const leadIn = initialBearing(stand.leadIn[stand.leadIn.length - 2], stand.leadIn[stand.leadIn.length - 1]);
      worstOffLeadIn = Math.max(worstOffLeadIn, angleBetween(path.headingsDeg[last], leadIn));
      if (angleBetween(path.headingsDeg[last], stand.headingTrue) > 10) problems.push(`${label}: heading`);
      if (path.kinds[last] !== 'leadin' || path.kinds[0] === 'leadin') problems.push(`${label}: kinds`);
    }
    expect(problems).toEqual([]);
    expect(worstOffLeadIn).toBeLessThan(1);
  });

  it('consecutive 5 m samples never turn more than 15° and stay within the fillet bound of the graph line', { timeout: 60_000 }, () => {
    const graph = graphFor(MDPC_LAYOUT);
    const worst = {};
    const problems = [];
    let farthest = 0;
    for (const { exit, stand, path } of exitRoutes()) {
      const label = `${exit.nodeId} → ${stand.code}`;
      const turn = maxTurn(path.headingsDeg);
      worst[stand.code] = Math.max(worst[stand.code] ?? 0, turn);
      if (turn > (TIGHT_ENTRY[stand.code] ?? 15)) problems.push(`${label}: turns ${turn.toFixed(1)}°`);
      // Easing moves the line at most 15 m from the graph's, and the arcs stay inside its corners.
      const plane = toLocal(path.coords[0]);
      const graphLine = routeLine(graph, path).map(plane.forward);
      for (const point of path.coords) farthest = Math.max(farthest, distanceToLine(plane.forward(point), graphLine));
    }
    expect(problems).toEqual([]);
    expect(farthest).toBeLessThanOrEqual(TAXI_MAX_SHIFT_M);
    // BN9 is the only stand that needs its exception.
    expect(Object.keys(worst).filter(code => worst[code] > 15)).toEqual(['BN9']);
  });

  it('pushback runs the lead-in backwards with the heading held and ends on the taxiway, where the taxi to the 08 holding point starts', { timeout: 30_000 }, () => {
    const end08 = runwayEnd(MDPC_LAYOUT, '08');
    const graph = graphFor(MDPC_LAYOUT);
    const a1 = ACTIVE.find(stand => stand.code === 'A1');
    const { pushback, taxi, holdingPoint, lineUp } = routeStandToHold(MDPC_LAYOUT, { stand: a1, departureEnd: end08, activeRunwayIds: ['08/26'] });
    // The holding point that leaves the whole of 08: hp-E-08-26, 92 m from the threshold.
    expect(holdingPoint.id).toBe('hp-E-08-26');
    expect(haversineM(holdingPoint.p, end08.threshold)).toBeCloseTo(91.2, 0);
    // Backwards out of the stand, the nose held on the stand heading while the lead-in is straight.
    expect(pushback.heading).toBe('reverse');
    expect(pushback.coords[0]).toEqual(a1.center);
    const leadInLength = haversineM(a1.leadIn[0], a1.center);
    pushback.alongM.forEach((distance, at) => {
      if (distance < leadInLength - 35) expect(angleBetween(pushback.headingsDeg[at], a1.headingTrue)).toBeLessThan(0.5);
    });
    expect(pushback.kinds[0]).toBe('leadin');
    // It ends on the taxiway behind the lead-in's join, at most 40 m along it, facing the way the taxi goes.
    const pushEnd = pushback.coords[pushback.coords.length - 1];
    const onTaxiway = nearestEdge(graph, pushEnd, { kinds: ['taxiway', 'taxilane'] });
    expect(onTaxiway.distanceM).toBeLessThan(0.5);
    const join = graph.nodes.get(pushback.nodeIds[1]).p;
    expect(haversineM(join, pushEnd)).toBeLessThanOrEqual(PUSHBACK_MAX_M + 0.01);
    expect(taxi.coords[0]).toEqual(pushEnd);
    expect(angleBetween(pushback.headingsDeg[pushback.headingsDeg.length - 1], taxi.headingsDeg[0])).toBeLessThan(1);
    // The taxi comes forward through the join again and ends at the holding point; the line-up turns onto 08.
    expect(taxi.nodeIds[0]).toBe(pushback.nodeIds[1]);
    expect(taxi.nodeIds[taxi.nodeIds.length - 1]).toBe(holdingPoint.node);
    expect(taxi.coords[taxi.coords.length - 1]).toEqual(holdingPoint.p);
    expect(lineUp.coords[0]).toEqual(holdingPoint.p);
    expect(angleBetween(lineUp.headingsDeg[lineUp.headingsDeg.length - 1], end08.headingTrue)).toBeLessThan(1);
    expect(lineUp.runwayAlongM).toBeGreaterThan(lineUp.exit.alongM);
    expect(lineUp.kinds[lineUp.kinds.length - 1]).toBe('runway');

    // Every active stand leaves the same way, also from the dead-end joins of E1, E2 and F: the nose always ends on
    // the taxi direction and the taxi never turns more than 15° per 5 m.
    for (const stand of ACTIVE) {
      const departure = routeStandToHold(MDPC_LAYOUT, { stand, departureEnd: end08, activeRunwayIds: ['08/26'] });
      const end = departure.pushback.coords.length - 1;
      expect(departure.pushback.coords[0], stand.code).toEqual(stand.center);
      expect(angleBetween(departure.pushback.headingsDeg[0], stand.headingTrue), stand.code).toBeLessThan(1);
      expect(departure.taxi.coords[0], stand.code).toEqual(departure.pushback.coords[end]);
      expect(angleBetween(departure.pushback.headingsDeg[end], departure.taxi.headingsDeg[0]), stand.code).toBeLessThan(1);
      expect(departure.holdingPoint.id, stand.code).toBe('hp-E-08-26');
      expect(maxTurn(departure.taxi.headingsDeg), stand.code).toBeLessThanOrEqual(15);
    }
  });

  it('without a stand the route ends at the apron hold of its terminal, or at the nearest one without a terminal', () => {
    expect(apronHoldFor(MDPC_LAYOUT, 'A').id).toBe('ah-a');
    expect(apronHoldFor(MDPC_LAYOUT, 'B').id).toBe('ah-b');
    expect(apronHoldFor(MDPC_LAYOUT, 'FBO').id).toBe('ah-fbo');
    expect(apronHoldFor(MDPC_LAYOUT, 'Z')).toBeNull();
    expect(apronHoldFor(MDPC_LAYOUT, null)).toBeNull();
    const end08 = runwayEnd(MDPC_LAYOUT, '08');
    const exit = runwayExits(MDPC_LAYOUT, end08).find(candidate => candidate.alongM > 1500);
    for (const [terminal, id] of [['A', 'ah-a'], ['B', 'ah-b'], ['FBO', 'ah-fbo']]) {
      const hold = MDPC_LAYOUT.apronHolds.find(candidate => candidate.id === id);
      const path = routeExitToApronHold(MDPC_LAYOUT, { exitNodeId: exit.nodeId, terminal, activeRunwayIds: ['08/26'] });
      expect(path.nodeIds[path.nodeIds.length - 1], terminal).toBe(hold.node);
      expect(path.coords[path.coords.length - 1], terminal).toEqual(hold.p);
    }
    // Without a terminal (or with one that has no hold): the apron hold the cheapest route reaches.
    const any = routeExitToApronHold(MDPC_LAYOUT, { exitNodeId: exit.nodeId, terminal: null, activeRunwayIds: ['08/26'] });
    const costs = MDPC_LAYOUT.apronHolds.map(hold => {
      const path = routeExitToApronHold(MDPC_LAYOUT, { exitNodeId: exit.nodeId, terminal: hold.terminals[0], activeRunwayIds: ['08/26'] });
      return { node: hold.node, cost: path.edges.reduce((sum, edge) => sum + taxiCostFn({ activeRunwayIds: ['08/26'] })(edge), 0) };
    }).sort((a, b) => a.cost - b.cost);
    expect(any.nodeIds[any.nodeIds.length - 1]).toBe(costs[0].node);
    expect(routeExitToApronHold(MDPC_LAYOUT, { exitNodeId: exit.nodeId, terminal: 'Z', activeRunwayIds: ['08/26'] }).nodeIds)
      .toEqual(any.nodeIds);

    // The synthetic aerodrome: T1 waits at ah-t1. Without a terminal, from x1 the nearest hold by route is ah-t2:
    // connector D joins the lane 250 m from ah-t2 and 350 m from ah-t1. It leaves from there with no pushback.
    const layout = createKinematicsLayout();
    expect(routeExitToApronHold(layout, { exitNodeId: 'x1', terminal: 'T1', activeRunwayIds: ['09/27'] }).nodeIds.at(-1)).toBe('ah-t1');
    expect(routeExitToApronHold(layout, { exitNodeId: 'x1', activeRunwayIds: ['09/27'] }).nodeIds.at(-1)).toBe('ah-t2');
    const departure = routeFromApronHold(layout, { apronHold: 'ah-t2', departureEnd: runwayEnds(layout)[0], activeRunwayIds: ['09/27'] });
    expect(departure.pushback).toBeNull();
    expect(departure.holdingPoint.id).toBe('hp-A-09-27');
    expect(departure.taxi.coords[0]).toEqual(layout.apronHolds[1].p);
    expect(departure.taxi.coords.at(-1)).toEqual(departure.holdingPoint.p);
    expect(departure.lineUp.exit.nodeId).toBe('x1');
  });

  it('routing from a point mid-taxi starts exactly at that point and keeps going forward', () => {
    const end08 = runwayEnd(MDPC_LAYOUT, '08');
    const exit = runwayExits(MDPC_LAYOUT, end08).find(candidate => candidate.alongM > 1500);
    for (const code of ['A5', 'B24', 'BN11']) {
      const stand = ACTIVE.find(candidate => candidate.code === code);
      const path = routeExitToStand(MDPC_LAYOUT, { exitNodeId: exit.nodeId, stand, activeRunwayIds: ['08/26'] });
      for (const share of [0.25, 0.4, 0.7]) {
        const at = Math.floor(path.coords.length * share);
        const point = path.coords[at];
        const resumed = routeFromPoint(MDPC_LAYOUT, {
          point, headingDeg: path.headingsDeg[at], toNodeId: stand.node, activeRunwayIds: ['08/26'],
        });
        const label = `${code} at ${share}`;
        expect(resumed.coords[0], label).toEqual(point);
        // Forward: it sets off within 25° of where the aircraft points and is no longer than the rest of the route.
        expect(angleBetween(resumed.headingsDeg[0], path.headingsDeg[at]), label).toBeLessThan(25);
        expect(resumed.lengthM, label).toBeLessThan(path.lengthM - path.alongM[at] + 30);
        expect(resumed.coords[resumed.coords.length - 1], label).toEqual(stand.center);
      }
    }
    // Heading into a dead end that is not its target (half-way down S4's lead-in, nose south, bound for S1), the
    // aircraft leaves by the other end: back north to the lane, then west. Heading into its own stand it goes on.
    const layout = createKinematicsLayout();
    const halfWay = kinematicsPoint(450, -512);
    const turnedBack = routeFromPoint(layout, { point: halfWay, headingDeg: 180, toNodeId: 'st-S1' });
    expect(turnedBack.coords[0]).toEqual(halfWay);
    expect(angleBetween(turnedBack.headingsDeg[0], 0)).toBeLessThan(1);
    expect(turnedBack.nodeIds).toEqual(['ls-S4', 'ah-t2', 'ls-S3', 'l1', 'ls-S2', 'ah-t1', 'ls-S1', 'st-S1']);
    expect(turnedBack.startEdge.kind).toBe('leadin');
    turnedBack.edges.forEach((edge, at) => {
      expect([edge.a, edge.b].sort()).toEqual([turnedBack.nodeIds[at], turnedBack.nodeIds[at + 1]].sort());
    });
    const goingOn = routeFromPoint(layout, { point: halfWay, headingDeg: 180, toNodeId: 'st-S4' });
    expect(goingOn.nodeIds).toEqual(['st-S4']);
    expect(goingOn.coords.at(-1)).toEqual(layout.stands[3].center);
    expect(routeFromPoint(layout, { point: halfWay, toNodeId: 'nowhere' })).toBeNull();
  });

  it('a landing path rolls on the centreline from the touchdown point and turns off at its exit without a heading step', () => {
    const end08 = runwayEnd(MDPC_LAYOUT, '08');
    const a5 = ACTIVE.find(stand => stand.code === 'A5');
    const touchdown = pointAlong(end08.centerline, 300).p;
    // A rapid exit (15° off the runway), a reverse one (155°: a U-turn) and a far one.
    for (const [exitNodeId, worstStepDeg] of [['n7592209935', 15], ['n7592209929', 20], ['n7592262104', 15]]) {
      const path = routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: end08, fromAlongM: 300, exitNodeId, stand: a5, activeRunwayIds: ['08/26'] });
      expect(path.exit.nodeId).toBe(exitNodeId);
      expect(path.fromAlongM).toBe(300);
      expect(path.apronHold).toBeNull();
      expect(haversineM(path.coords[0], touchdown), exitNodeId).toBeLessThan(0.01);
      expect(angleBetween(path.headingsDeg[0], end08.headingTrue), exitNodeId).toBeLessThan(0.1);
      // The roll is runway samples on the centreline up to the turn-off, then the taxi of routeExitToStand.
      const offRunway = path.kinds.findIndex(kind => kind !== 'runway');
      for (let at = 0; at < offRunway && !path.turning[at]; at += 1) {
        expect(pointToPolylineM(path.coords[at], end08.centerline).distanceM, exitNodeId).toBeLessThan(0.5);
      }
      expect(path.nodeIds[0]).toBe(exitNodeId);
      expect(path.coords[path.coords.length - 1]).toEqual(a5.center);
      expect(path.kinds[path.kinds.length - 1]).toBe('leadin');
      const taxi = routeExitToStand(MDPC_LAYOUT, { exitNodeId, stand: a5, activeRunwayIds: ['08/26'] });
      expect(path.nodeIds).toEqual(taxi.nodeIds);
      expect(Math.abs(path.lengthM - (path.exit.alongM - 300) - taxi.lengthM), exitNodeId).toBeLessThan(40);
      // Rounded through the turn-off: no step at the exit, even the U-turn of the reverse exit stays under 20° per 5 m.
      expect(maxTurn(path.headingsDeg), exitNodeId).toBeLessThan(worstStepDeg);
    }
    // Without a stand: to the named apron hold, else the terminal's, else the one the cheapest taxi reaches.
    const exitNodeId = 'n7592209935';
    const toA = routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: end08, fromAlongM: 300, exitNodeId, terminal: 'A', activeRunwayIds: ['08/26'] });
    expect(toA.apronHold.id).toBe('ah-a');
    expect(toA.coords[toA.coords.length - 1]).toEqual(toA.apronHold.p);
    const named = MDPC_LAYOUT.apronHolds.find(hold => hold.id === 'ah-fbo');
    expect(routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: end08, fromAlongM: 300, exitNodeId, apronHold: named, activeRunwayIds: ['08/26'] }).apronHold.id).toBe('ah-fbo');
    expect(routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: end08, fromAlongM: 300, exitNodeId, apronHold: 'ah-b', activeRunwayIds: ['08/26'] }).apronHold.id).toBe('ah-b');
    const any = routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: end08, fromAlongM: 300, exitNodeId, activeRunwayIds: ['08/26'] });
    const cheapest = routeExitToApronHold(MDPC_LAYOUT, { exitNodeId, activeRunwayIds: ['08/26'] });
    expect(any.nodeIds).toEqual(cheapest.nodeIds);
    expect(any.apronHold.node).toBe(cheapest.nodeIds.at(-1));
    // An exit behind the touchdown point, one that is not on that runway, or no runway: no path.
    expect(routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: end08, fromAlongM: 300, exitNodeId: 'n7592209958', stand: a5 })).toBeNull();
    expect(routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: end08, fromAlongM: 300, exitNodeId: 'st-A5', stand: a5 })).toBeNull();
    expect(routeLandingTaxi(MDPC_LAYOUT, { runwayEnd: null, exitNodeId, stand: a5 })).toBeNull();
    // The synthetic aerodrome: from 300 m along 09 to x2 and on to S1.
    const layout = createKinematicsLayout();
    const s1 = layout.stands.find(stand => stand.code === 'S1');
    const synthetic = routeLandingTaxi(layout, { runwayEnd: runwayEnd(layout, '09'), fromAlongM: 300, exitNodeId: 'x2', stand: s1, activeRunwayIds: ['09/27'] });
    expect(synthetic.nodeIds[0]).toBe('x2');
    expect(synthetic.coords.at(-1)).toEqual(s1.center);
    expect(Object.isFrozen(synthetic) && Object.isFrozen(synthetic.coords)).toBe(true);
  });

  it('the same inputs give identical routes', () => {
    const copy = structuredClone(MDPC_LAYOUT);
    const end08 = runwayEnd(MDPC_LAYOUT, '08');
    const copyEnd = runwayEnd(copy, '08');
    const exit = runwayExits(MDPC_LAYOUT, end08)[5];
    for (const code of ['A1', 'B27', 'BN9']) {
      const original = {
        arrival: routeExitToStand(MDPC_LAYOUT, { exitNodeId: exit.nodeId, stand: code, activeRunwayIds: ['08/26'] }),
        departure: routeStandToHold(MDPC_LAYOUT, { stand: code, departureEnd: end08, activeRunwayIds: ['08/26'] }),
      };
      const again = {
        arrival: routeExitToStand(copy, { exitNodeId: exit.nodeId, stand: code, activeRunwayIds: ['08/26'] }),
        departure: routeStandToHold(copy, { stand: code, departureEnd: copyEnd, activeRunwayIds: ['08/26'] }),
      };
      expect(JSON.stringify(again), code).toBe(JSON.stringify(original));
      expect(Object.isFrozen(original.arrival.coords)).toBe(true);
      expect(Object.isFrozen(original.departure)).toBe(true);
    }
    // A stand code is resolved the way the API writes it, and a graph route gives the same TaxiPath.
    expect(routeExitToStand(MDPC_LAYOUT, { exitNodeId: exit.nodeId, stand: 'a-01', activeRunwayIds: ['08/26'] }).nodeIds.at(-1)).toBe('st-A1');
    const layout = createKinematicsLayout();
    const graph = buildTaxiGraph(layout.taxiGraph);
    expect(graph.nodes.size).toBe(graphFor(layout).nodes.size);
    expect(graphFor(layout)).toBe(graphFor(layout));
    expect(taxiPath(layout, null)).toBeNull();
  });
});
