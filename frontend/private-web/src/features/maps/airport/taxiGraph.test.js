import { describe, expect, it } from 'vitest';
import { createKinematicsLayout, kinematicsPoint } from '../kinematics/kinematicsFixtures.js';
import { MDPC_LAYOUT } from './airportLayout.js';
import { destinationPoint, haversineM } from './geo.js';
import {
  buildTaxiGraph,
  connectedComponents,
  edgeLine,
  nearestEdge,
  nearestNode,
  reachableFrom,
  routeBetween,
  routeLine,
  shortestPath,
} from './taxiGraph.js';

const ORIGIN = [-68.3634, 18.5674];
const at = (east, north) => destinationPoint(destinationPoint(ORIGIN, 90, east), 0, north);

// A synthetic square: s ─ a ─ b on the south side, s ─ c ─ b on the north side (the same length, so the two routes
// tie), a runway edge s ─ b straight across that is shorter, and a separate island x ─ y.
function squareGraph() {
  const nodes = [
    { id: 's', p: at(0, 0), kind: 'stand' },
    { id: 'a', p: at(100, -50), kind: 'junction' },
    { id: 'c', p: at(100, 50), kind: 'junction' },
    { id: 'b', p: at(200, 0), kind: 'exit' },
    { id: 'x', p: at(500, 500), kind: 'junction' },
    { id: 'y', p: at(600, 500), kind: 'junction' },
  ];
  const edge = (a, b, kind) => ({
    a, b, kind, m: Math.round(haversineM(nodes.find(n => n.id === a).p, nodes.find(n => n.id === b).p) * 10) / 10,
  });
  return buildTaxiGraph({
    nodes,
    edges: [
      edge('s', 'a', 'taxiway'), edge('a', 'b', 'taxiway'),
      edge('s', 'c', 'taxilane'), edge('c', 'b', 'taxiway'),
      edge('s', 'b', 'runway'),
      edge('x', 'y', 'taxiway'),
      { a: 's', b: 'ghost', m: 1, kind: 'taxiway' },
    ],
  });
}

describe('taxiGraph', () => {
  it('the shortest path is the same length both ways, deterministic on ties, and avoids runway edges when asked', () => {
    const graph = squareGraph();
    expect(graph.edges).toHaveLength(6);
    const direct = shortestPath(graph, 's', 'b');
    expect(direct.nodeIds).toEqual(['s', 'b']);
    const there = shortestPath(graph, 's', 'b', { avoidKinds: ['runway'] });
    const back = shortestPath(graph, 'b', 's', { avoidKinds: ['runway'] });
    expect(there.lengthM).toBeCloseTo(back.lengthM, 6);
    expect(there.lengthM).toBeGreaterThan(direct.lengthM);
    // Both detours are equally long: the route through the smaller id («a») wins, every time and both ways.
    expect(there.nodeIds).toEqual(['s', 'a', 'b']);
    expect(back.nodeIds).toEqual(['b', 'a', 's']);
    for (let run = 0; run < 5; run += 1) {
      expect(shortestPath(graph, 's', 'b', { avoidKinds: ['runway'] })).toEqual(there);
    }
    expect(shortestPath(graph, 's', 's')).toEqual({ nodeIds: ['s'], lengthM: 0 });
    expect(shortestPath(graph, 's', 'x')).toBeNull();
    expect(shortestPath(graph, 's', 'nowhere')).toBeNull();
    expect(shortestPath(graph, 'a', 'b', { avoidKinds: ['taxiway', 'runway'] })).toBeNull();
  });

  it('reachableFrom and connectedComponents on a synthetic graph', () => {
    const graph = squareGraph();
    expect([...reachableFrom(graph, 's')].sort()).toEqual(['a', 'b', 'c', 's']);
    // Taxilanes only: the stand reaches its own lane and nothing else.
    expect([...reachableFrom(graph, 's', { kinds: ['taxilane'] })].sort()).toEqual(['c', 's']);
    expect(reachableFrom(graph, 'nowhere').size).toBe(0);
    expect(connectedComponents(graph)).toEqual([['a', 'b', 'c', 's'], ['x', 'y']]);
  });

  it('finds the nearest node and the nearest point on an edge line', () => {
    const graph = squareGraph();
    expect(nearestNode(graph, at(190, 5)).node.id).toBe('b');
    expect(nearestNode(graph, at(190, 5), { kinds: ['junction'] }).node.id).toBe('c');
    const hit = nearestEdge(graph, at(100, 10), { kinds: ['runway'] });
    expect(hit.edge.kind).toBe('runway');
    expect(hit.distanceM).toBeCloseTo(10, 1);
    expect(hit.t).toBeCloseTo(0.5, 2);
    expect(hit.alongM).toBeCloseTo(100, 0);
    expect(nearestEdge(graph, at(0, 0), { kinds: ['leadin'] })).toBeNull();
  });

  it('follows a bent edge line', () => {
    const corner = at(0, 100);
    const graph = buildTaxiGraph({
      nodes: [{ id: 'p', p: at(0, 0), kind: 'junction' }, { id: 'q', p: at(100, 100), kind: 'junction' }],
      edges: [{ a: 'p', b: 'q', m: 200, kind: 'taxiway', line: [at(0, 0), corner, at(100, 100)] }],
    });
    expect(edgeLine(graph, graph.edges[0])).toHaveLength(3);
    const hit = nearestEdge(graph, at(50, 110));
    expect(hit.index).toBe(1);
    expect(hit.distanceM).toBeCloseTo(10, 1);
    expect(hit.alongM).toBeCloseTo(150, 0);
  });
});

// PR M6: routes by a cost per edge and their lines.
describe('routes by cost', () => {
  it('routeBetween with a cost function avoids a costly runway edge and still reports metres', () => {
    const layout = createKinematicsLayout();
    const graph = buildTaxiGraph(layout.taxiGraph);
    // By length alone the 539 m of the inactive runway 05/23 win over 2 300 m of taxiway and apron lane.
    const plain = routeBetween(graph, 'j1', 'l0');
    expect(plain.nodeIds).toEqual(['j1', 'l0']);
    expect(plain.edges.map(edge => edge.kind)).toEqual(['runway']);
    expect(plain.cost).toBe(plain.lengthM);
    // Runway edges ten times their length and the apron lane 1.3: the route stays on taxiways and reports both.
    const factor = { taxiway: 1, taxilane: 1.3, leadin: 2, runway: 10 };
    const weighted = routeBetween(graph, 'j1', 'l0', { costFn: edge => edge.m * factor[edge.kind] });
    expect(weighted.nodeIds).toEqual(['j1', 'j2', 'l1', 'ls-S2', 'ah-t1', 'ls-S1', 'l0']);
    expect(weighted.edges.some(edge => edge.kind === 'runway')).toBe(false);
    const metres = weighted.edges.reduce((sum, edge) => sum + edge.m, 0);
    expect(weighted.lengthM).toBeCloseTo(metres, 9);
    expect(weighted.lengthM).toBeCloseTo(2300, 0);
    expect(weighted.cost).toBeCloseTo(1500 + 800 * 1.3, 0);
    expect(Object.isFrozen(weighted)).toBe(true);
    expect(Object.isFrozen(weighted.edges)).toBe(true);
    // A cost that is not a finite number closes the edge; avoidKinds closes a whole kind.
    expect(routeBetween(graph, 'j1', 'l0', { costFn: edge => (edge.kind === 'runway' ? Infinity : edge.m) }).nodeIds)
      .toEqual(weighted.nodeIds);
    expect(routeBetween(graph, 'j1', 'l0', { avoidKinds: ['runway'] }).nodeIds).toEqual(weighted.nodeIds);
    expect(routeBetween(graph, 'x1', 'rw-27', { avoidKinds: ['runway'] })).toBeNull();
    expect(routeBetween(graph, 'j1', 'nowhere')).toBeNull();
    expect(routeBetween(graph, 'l0', 'l0')).toEqual({ nodeIds: ['l0'], edges: [], lengthM: 0, cost: 0 });
  });

  it('routeLine follows bent edges in the travel direction', () => {
    const layout = createKinematicsLayout();
    const graph = buildTaxiGraph(layout.taxiGraph);
    const corner = kinematicsPoint(1200, -500);
    const byNode = id => graph.nodes.get(id).p;
    // The connector C is stored from j3 to l2 with its corner; travelled from l2 it runs backwards.
    expect(routeLine(graph, routeBetween(graph, 'l2', 'j3'))).toEqual([byNode('l2'), corner, byNode('j3')]);
    expect(routeLine(graph, routeBetween(graph, 'j3', 'l2'))).toEqual([byNode('j3'), corner, byNode('l2')]);
    // Over several edges each shared node appears once, in order.
    const route = routeBetween(graph, 'x3', 'ls-S4', { avoidKinds: ['runway'] });
    expect(route.nodeIds).toEqual(['x3', 'j3', 'l2', 'ls-S4']);
    const line = routeLine(graph, route);
    expect(line).toEqual([byNode('x3'), byNode('j3'), corner, byNode('l2'), byNode('ls-S4')]);
    for (let at = 1; at < line.length; at += 1) expect(haversineM(line[at - 1], line[at])).toBeGreaterThan(1);
    expect(routeLine(graph, routeBetween(graph, 'l1', 'l1'))).toEqual([byNode('l1')]);
    expect(Object.isFrozen(line)).toBe(true);
  });

  it('shortestPath keeps its shape and its routes', () => {
    const graph = buildTaxiGraph(MDPC_LAYOUT.taxiGraph);
    const exits = MDPC_LAYOUT.taxiGraph.nodes.filter(node => node.kind === 'exit').map(node => node.id);
    const stands = MDPC_LAYOUT.stands.filter(stand => !stand.retired).map(stand => stand.node);
    expect(Object.keys(shortestPath(graph, stands[0], exits[0]))).toEqual(['nodeIds', 'lengthM']);
    for (const stand of stands) {
      for (const exit of exits) {
        const route = shortestPath(graph, stand, exit, { avoidKinds: ['runway'] });
        expect(route, `${stand} → ${exit}`).toEqual(referenceShortestPath(graph, stand, exit, ['runway']));
        const byCost = routeBetween(graph, stand, exit, { avoidKinds: ['runway'] });
        expect(byCost.nodeIds).toEqual(route.nodeIds);
        expect(byCost.lengthM).toBe(route.lengthM);
      }
    }
  });
});

/** The search of PR M3, copied as it was, so the refactor of shortestPath provably keeps every route. */
function referenceShortestPath(graph, fromId, toId, avoidKinds) {
  const avoid = new Set(avoidKinds);
  const distance = new Map([[fromId, 0]]);
  const previous = new Map();
  const done = new Set();
  const open = [[0, fromId]];
  const before = (x, y) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  while (open.length > 0) {
    let best = 0;
    for (let at = 1; at < open.length; at += 1) if (before(open[at], open[best])) best = at;
    const [length, id] = open.splice(best, 1)[0];
    if (done.has(id)) continue;
    done.add(id);
    if (id === toId) break;
    for (const { to, edge } of graph.adjacency.get(id)) {
      if (done.has(to) || avoid.has(edge.kind)) continue;
      const candidate = length + edge.m;
      const known = distance.get(to);
      const better = known === undefined || candidate < known - 1e-9
        || (Math.abs(candidate - known) <= 1e-9 && id < previous.get(to));
      if (better) {
        distance.set(to, candidate);
        previous.set(to, id);
        open.push([candidate, to]);
      }
    }
  }
  if (!done.has(toId)) return null;
  const nodeIds = [toId];
  while (nodeIds[0] !== fromId) nodeIds.unshift(previous.get(nodeIds[0]));
  return { nodeIds, lengthM: distance.get(toId) };
}
