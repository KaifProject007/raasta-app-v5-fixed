// Live traffic simulation, now keyed to real OSM road edges instead of
// arbitrary slices of one particular route. Two different routes that
// happen to share the same stretch of road will see the *same* congestion
// on it - which is what makes "a better path just opened up elsewhere"
// comparisons meaningful.

import { seededRandom } from "./geo.js";
import { isEdgeBlocked } from "./incidentEngine.js";

export const TICK_MS = 4000;

// How many ticks one congestion "epoch" spans. Previously every edge redrew
// a totally independent random score EVERY tick (4s), so on any real route
// a chunk of edges would look like they'd freshly become "heavy" almost
// every single tick - the backend read that as a constant stream of brand
// new jams, which is what was driving jam-alert/smart-reroute-suggestion to
// fire on a near-4-second cadence. Real congestion builds and clears over
// tens of seconds, not every tick, so scores now interpolate smoothly
// between one epoch's anchor value and the next instead of teleporting.
const EPOCH_TICKS = 8; // ~32s per epoch at TICK_MS=4000

const LEVELS = {
  clear: { color: "#1FAE6B", label: "Clear", multiplier: 1, messages: ["Clear road ahead", "Free flowing traffic", "No delays reported"] },
  moderate: { color: "#F5A623", label: "Moderate", multiplier: 1.6, messages: ["Moderate traffic - slow down", "Some congestion building", "Minor delay on this stretch"] },
  heavy: { color: "#E23D3D", label: "Heavy", multiplier: 2.6, messages: ["Heavy congestion - jam ahead", "Accident/blockage reported nearby", "Avoid this stretch if possible"] },
  // A real, actively-managed incident (see incidentEngine.js) rather than
  // simulated congestion - near-impassable so A* is forced to route around
  // it instead of merely discouraging it the way "heavy" does.
  blocked: { color: "#7A1010", label: "Blocked", multiplier: 60, messages: ["Road blocked - incident reported", "Emergency crews on scene", "Route around this stretch"] },
};

function classify(score) {
  if (score < 0.45) return "clear";
  if (score < 0.75) return "moderate";
  return "heavy";
}

function pick(arr, rand) {
  return arr[Math.floor(rand() * arr.length)];
}

export function currentTick() {
  return Math.floor(Date.now() / TICK_MS);
}

// Smoothly-varying score for one edge: still fully deterministic from
// (edgeKey, mode, tick) - no server memory, so every simultaneous reader
// (any route/tab sharing this stretch of road) still sees the identical
// number - but it now glides between two per-epoch anchor values instead
// of redrawing from scratch every tick.
function smoothScore(edgeKey, mode, tick) {
  const epoch = Math.floor(tick / EPOCH_TICKS);
  const bias = mode === "emergency" ? -0.22 : 0;
  const a = seededRandom(`${edgeKey}:${epoch}`)();
  const b = seededRandom(`${edgeKey}:${epoch + 1}`)();
  const within = (tick % EPOCH_TICKS) / EPOCH_TICKS; // 0..1 progress through this epoch
  const eased = within * within * (3 - 2 * within); // smoothstep - gentle start/end, no sharp jumps
  const raw = a + (b - a) * eased;
  return Math.min(1, Math.max(0, raw + bias));
}

/** Live congestion state of one real road edge at a given tick. Deterministic: same edge + tick always -> same reading. */
export function edgeState(edgeKey, mode = "normal", tick = currentTick()) {
  if (isEdgeBlocked(edgeKey)) {
    const meta = LEVELS.blocked;
    const rand = seededRandom(`${edgeKey}:${tick}:blocked`);
    return {
      score: 1,
      level: "blocked",
      color: meta.color,
      label: meta.label,
      multiplier: meta.multiplier,
      message: pick(meta.messages, rand),
    };
  }

  const score = smoothScore(edgeKey, mode, tick);
  const level = classify(score);
  const meta = LEVELS[level];
  // message flavor-text can still change every tick without affecting the
  // level/score, so it uses its own independent random stream
  const msgRand = seededRandom(`${edgeKey}:${tick}:msg`);
  return {
    score: Number(score.toFixed(2)),
    level,
    color: meta.color,
    label: meta.label,
    multiplier: meta.multiplier,
    message: pick(meta.messages, msgRand),
  };
}

/** Time-cost of one graph edge right now, in seconds, including live traffic. */
export function liveEdgeCostSeconds(edge, mode = "normal", tick = currentTick()) {
  const state = edgeState(edge.edgeKey, mode, tick);
  return (edge.distance / edge.speedMps) * state.multiplier;
}

/** Free-flow time-cost with no traffic at all - used as the "normal ETA" baseline. */
export function freeFlowCostSeconds(edge) {
  return edge.distance / edge.speedMps;
}

export function annotateEdges(edges, mode = "normal", tick = currentTick()) {
  return edges.map((e, idx) => {
    const state = edgeState(e.edgeKey, mode, tick);
    return {
      index: idx,
      edgeKey: e.edgeKey,
      coordinates: e.coordinates,
      distanceMeters: Math.round(e.distance),
      ...state,
    };
  });
}

// ---- per-journey tracking (for live updates + jam alerts while "driving") ----

const trackedRoutes = new Map(); // routeId -> { edges, mode, graph, startId, goalId, lastTick, lastLevels }

export function trackRoute(routeId, { edges, mode, graph, startId, goalId }) {
  const tick = currentTick();
  const segments = annotateEdges(edges, mode, tick);
  trackedRoutes.set(routeId, {
    edges, mode, graph, startId, goalId,
    lastTick: tick,
    lastLevels: segments.map((s) => s.level),
  });
  return segments;
}

// `force` bypasses the "only once per tick" guard so a just-triggered
// incident shows up on the tracked route immediately, instead of waiting
// up to TICK_MS for the next scheduled refresh.
export function refreshTrackedRoute(routeId, force = false) {
  const state = trackedRoutes.get(routeId);
  if (!state) return null;
  const tick = currentTick();
  if (!force && tick === state.lastTick) return null;

  const segments = annotateEdges(state.edges, state.mode, tick);
  const newJams = segments.filter(
    (s, i) => (s.level === "heavy" || s.level === "blocked") && state.lastLevels[i] !== s.level
  );
  state.lastLevels = segments.map((s) => s.level);
  state.lastTick = tick;

  return { segments, newJams, state };
}

export function getTrackedRoute(routeId) {
  return trackedRoutes.get(routeId) || null;
}

export function stopTracking(routeId) {
  trackedRoutes.delete(routeId);
}

export function getActiveRouteIds() {
  return [...trackedRoutes.keys()];
}
