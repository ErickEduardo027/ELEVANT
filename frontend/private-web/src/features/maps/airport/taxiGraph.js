import { haversineM, pointToPolylineM } from './geo.js';

// The taxi network of the airport layout as a graph (PR M3): nodes with a point and a kind (junction, exit, hold,
// stand, apronHold, runway) and undirected edges with a length in metres, a kind (taxiway, taxilane, leadin,
// runway) and, when the pavement bends between two nodes, its full `line` from `a` to `b`. The generator checks
// reachability on it and later PRs route taxiing aircraft over it (M6 adds the curve filleting). Pure and Node-safe
// like geo.js: explicit '.js' imports only. Every result is deterministic: ties are broken by node id, so the same
// layout always gives the same route.

/**
 * Builds the graph from `{ nodes: [{ id, p, kind }], edges: [{ a, b, m, kind, ref }] }`:
 * `{ nodes: Map(id → node), edges, adjacency: Map(id → [{ to, edge }]) }`. Edges whose ends are unknown are skipped.
 */
export function buildTaxiGraph({ nodes = [], edges = [] } = {}) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const adjacency = new Map(nodes.map(node => [node.id, []]));
  const kept = [];
  for (const edge of edges) {
    if (!nodeMap.has(edge.a) || !nodeMap.has(edge.b) || edge.a === edge.b) continue;
    kept.push(edge);
    adjacency.get(edge.a).push({ to: edge.b, edge });
    adjacency.get(edge.b).push({ to: edge.a, edge });
  }
  for (const list of adjacency.values()) list.sort((x, y) => compareIds(x.to, y.to));
  return { nodes: nodeMap, edges: kept, adjacency };
}

function compareIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A binary heap of `[distance, id]` ordered by distance, then by id. */
function createHeap() {
  const items = [];
  const less = (i, j) => items[i][0] < items[j][0] || (items[i][0] === items[j][0] && items[i][1] < items[j][1]);
  const swap = (i, j) => { [items[i], items[j]] = [items[j], items[i]]; };
  return {
    get size() { return items.length; },
    push(item) {
      items.push(item);
      let at = items.length - 1;
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (!less(at, parent)) break;
        swap(at, parent);
        at = parent;
      }
    },
    pop() {
      const top = items[0];
      const last = items.pop();
      if (items.length > 0) {
        items[0] = last;
        let at = 0;
        for (;;) {
          const left = at * 2 + 1;
          const right = left + 1;
          let smallest = at;
          if (left < items.length && less(left, smallest)) smallest = left;
          if (right < items.length && less(right, smallest)) smallest = right;
          if (smallest === at) break;
          swap(at, smallest);
          at = smallest;
        }
      }
      return top;
    },
  };
}

/**
 * The shortest route between two nodes by Dijkstra: `{ nodeIds, lengthM }`, or `null` when there is none. Edges of a
 * kind in `avoidKinds` are never used. On equal lengths the route through the smaller node ids wins.
 */
export function shortestPath(graph, fromId, toId, { avoidKinds = [] } = {}) {
  if (!graph.nodes.has(fromId) || !graph.nodes.has(toId)) return null;
  const avoid = new Set(avoidKinds);
  const distance = new Map([[fromId, 0]]);
  const previous = new Map();
  const done = new Set();
  const heap = createHeap();
  heap.push([0, fromId]);
  while (heap.size > 0) {
    const [length, id] = heap.pop();
    if (done.has(id)) continue;
    done.add(id);
    if (id === toId) break;
    for (const { to, edge } of graph.adjacency.get(id)) {
      if (done.has(to) || avoid.has(edge.kind)) continue;
      const candidate = length + edge.m;
      const known = distance.get(to);
      const better = known === undefined || candidate < known - 1e-9
        || (Math.abs(candidate - known) <= 1e-9 && compareIds(id, previous.get(to)) < 0);
      if (better) {
        distance.set(to, candidate);
        previous.set(to, id);
        heap.push([candidate, to]);
      }
    }
  }
  if (!done.has(toId)) return null;
  const nodeIds = [toId];
  while (nodeIds[0] !== fromId) nodeIds.unshift(previous.get(nodeIds[0]));
  return { nodeIds, lengthM: distance.get(toId) };
}

/** Every node reachable from `startId` (itself included) over edges of the given kinds (all kinds by default). */
export function reachableFrom(graph, startId, { kinds = null } = {}) {
  const seen = new Set();
  if (!graph.nodes.has(startId)) return seen;
  const only = kinds === null ? null : new Set(kinds);
  const stack = [startId];
  seen.add(startId);
  while (stack.length > 0) {
    const id = stack.pop();
    for (const { to, edge } of graph.adjacency.get(id)) {
      if (seen.has(to) || (only !== null && !only.has(edge.kind))) continue;
      seen.add(to);
      stack.push(to);
    }
  }
  return seen;
}

/** The connected components as sorted id lists, the largest first (ties by first id). */
export function connectedComponents(graph) {
  const assigned = new Set();
  const components = [];
  for (const id of [...graph.nodes.keys()].sort(compareIds)) {
    if (assigned.has(id)) continue;
    const component = [...reachableFrom(graph, id)].sort(compareIds);
    component.forEach(member => assigned.add(member));
    components.push(component);
  }
  return components.sort((x, y) => y.length - x.length || compareIds(x[0], y[0]));
}

/** The node nearest to `point` (of the given kinds when set): `{ node, distanceM }`, or `null`. */
export function nearestNode(graph, point, { kinds = null } = {}) {
  const only = kinds === null ? null : new Set(kinds);
  let best = null;
  for (const node of graph.nodes.values()) {
    if (only !== null && !only.has(node.kind)) continue;
    const distanceM = haversineM(point, node.p);
    if (best === null || distanceM < best.distanceM - 1e-9
      || (Math.abs(distanceM - best.distanceM) <= 1e-9 && compareIds(node.id, best.node.id) < 0)) {
      best = { node, distanceM };
    }
  }
  return best;
}

/** The geometry of an edge from `a` to `b`: its `line`, or the straight segment between its nodes. */
export function edgeLine(graph, edge) {
  return Array.isArray(edge.line) && edge.line.length >= 2
    ? edge.line
    : [graph.nodes.get(edge.a).p, graph.nodes.get(edge.b).p];
}

/**
 * The edge nearest to `point` (of the given kinds when set): `{ edge, distanceM, point, index, t, alongM }`, where
 * `index` and `t` locate the point on the edge's line and `alongM` is its distance from node `a`; or `null`.
 */
export function nearestEdge(graph, point, { kinds = null } = {}) {
  const only = kinds === null ? null : new Set(kinds);
  let best = null;
  for (const edge of graph.edges) {
    if (only !== null && !only.has(edge.kind)) continue;
    const line = edgeLine(graph, edge);
    const hit = pointToPolylineM(point, line);
    if (best === null || hit.distanceM < best.distanceM - 1e-9) best = { edge, line, ...hit };
  }
  if (best === null) return null;
  const { line, ...result } = best;
  let alongM = 0;
  for (let index = 0; index < result.index; index += 1) alongM += haversineM(line[index], line[index + 1]);
  alongM += haversineM(line[result.index], result.point);
  return { ...result, alongM };
}
