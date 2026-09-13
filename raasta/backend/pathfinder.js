import { haversineMeters } from "./geo.js";

// Fastest free-flow speed anywhere in our speed table - used only to build
// an admissible A* heuristic (a lower bound on remaining travel time).
const MAX_POSSIBLE_SPEED_MPS = 22;

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(priority, value) {
    this.items.push([priority, value]);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent][0] <= this.items[i][0]) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop() {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (l < this.items.length && this.items[l][0] < this.items[smallest][0]) smallest = l;
        if (r < this.items.length && this.items[r][0] < this.items[smallest][0]) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top ? top[1] : null;
  }
}

/**
 * A* search from startId to goalId.
 * edgeCostFn(edge) must return the traversal cost in SECONDS for that edge,
 * folding in live simulated traffic. Passing a per-run `penalizedEdgeKeys`
 * set lets the caller discourage (not forbid) certain edges, which is how
 * we generate meaningfully different alternative routes below.
 */
export function aStar(graph, startId, goalId, edgeCostFn) {
  const goalNode = graph.nodes.get(goalId);
  if (!graph.nodes.has(startId) || !goalNode) return null;

  const heuristic = (nodeId) => {
    const n = graph.nodes.get(nodeId);
    return haversineMeters([n.lon, n.lat], [goalNode.lon, goalNode.lat]) / MAX_POSSIBLE_SPEED_MPS;
  };

  const gScore = new Map([[startId, 0]]);
  const cameFrom = new Map(); // nodeId -> { from, edge }
  const open = new MinHeap();
  const visited = new Set();

  open.push(heuristic(startId), startId);

  while (open.size > 0) {
    const current = open.pop();
    if (current === goalId) break;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = graph.adjacency.get(current) || [];
    for (const edge of neighbors) {
      const cost = edgeCostFn(edge);
      const tentative = gScore.get(current) + cost;
      if (tentative < (gScore.get(edge.to) ?? Infinity)) {
        gScore.set(edge.to, tentative);
        cameFrom.set(edge.to, { from: current, edge });
        open.push(tentative + heuristic(edge.to), edge.to);
      }
    }
  }

  if (!gScore.has(goalId) || !cameFrom.has(goalId)) return null;

  // reconstruct
  const edges = [];
  let node = goalId;
  while (node !== startId) {
    const step = cameFrom.get(node);
    if (!step) return null;
    edges.unshift(step.edge);
    node = step.from;
  }

  const totalDistance = edges.reduce((sum, e) => sum + e.distance, 0);
  const totalTimeSeconds = gScore.get(goalId);
  return { edges, totalDistance, totalTimeSeconds };
}

/**
 * Produces up to `count` distinct routes: the true current-best path, then
 * alternatives found by heavily penalizing the edges already used so A*
 * is forced to explore a genuinely different corridor rather than a
 * near-identical shadow of the same road. This is a well-known, simple
 * approximation of k-shortest-paths - good enough for offering a driver
 * 2-3 sane, different choices.
 */
export function findRoutesWithAlternatives(graph, startId, goalId, baseCostFn, count = 3) {
  const results = [];
  const penalized = new Set();

  for (let i = 0; i < count; i++) {
    const costFn = (edge) => {
      const base = baseCostFn(edge);
      return penalized.has(edge.edgeKey) ? base * 3 : base;
    };
    const result = aStar(graph, startId, goalId, costFn);
    if (!result) break;

    // stop offering more alternatives once they stop being meaningfully different
    const isDuplicate = results.some((r) => overlapRatio(r.edges, result.edges) > 0.85);
    if (!isDuplicate || results.length === 0) {
      results.push(result);
    }
    result.edges.forEach((e) => penalized.add(e.edgeKey));

    if (isDuplicate && results.length > 0) break;
  }

  return results;
}

function overlapRatio(edgesA, edgesB) {
  const setA = new Set(edgesA.map((e) => e.edgeKey));
  let shared = 0;
  for (const e of edgesB) if (setA.has(e.edgeKey)) shared++;
  return shared / Math.min(edgesA.length, edgesB.length || 1);
}
