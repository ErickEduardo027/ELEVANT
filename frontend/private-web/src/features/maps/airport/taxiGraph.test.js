import { describe, expect, it } from 'vitest';
import { destinationPoint, haversineM } from './geo.js';
import {
  buildTaxiGraph,
  connectedComponents,
  edgeLine,
  nearestEdge,
  nearestNode,
  reachableFrom,
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
