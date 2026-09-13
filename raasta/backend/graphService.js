import fetch from "node-fetch";
import { haversineMeters, bboxKey } from "./geo.js";

// Free, key-less OSM query service. No signup, no billing.
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Overpass' public instance asks that you not fire concurrent requests -
// this tiny queue makes sure we only ever have one in flight at a time.
let queue = Promise.resolve();
function serialized(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map(); // bboxKey -> { graph, expiresAt }

const DRIVEABLE_HIGHWAYS = [
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "unclassified", "residential", "living_street",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
];

// rough free-flow speed assumption per road class, in meters/second - used
// only to estimate travel time; not claimed to be precise.
const SPEED_BY_HIGHWAY = {
  motorway: 22, motorway_link: 16,
  trunk: 19, trunk_link: 14,
  primary: 16, primary_link: 12,
  secondary: 14, secondary_link: 11,
  tertiary: 12, tertiary_link: 10,
  unclassified: 9,
  residential: 8,
  living_street: 4,
};

function buildQuery(bbox) {
  const filter = DRIVEABLE_HIGHWAYS.join("|");
  // (south,west,north,east) is Overpass's bbox order
  const bboxStr = `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
  return `[out:json][timeout:25];(way["highway"~"^(${filter})$"](${bboxStr}););out body;>;out skel qt;`;
}

function buildGraphFromOverpass(elements) {
  const nodes = new Map(); // id -> {lat, lon}
  const adjacency = new Map(); // id -> [{to, edgeKey, distance, speedMps, coordinates}]

  for (const el of elements) {
    if (el.type === "node") {
      nodes.set(el.id, { lat: el.lat, lon: el.lon });
    }
  }

  function addEdge(fromId, toId, speedMps) {
    const a = nodes.get(fromId);
    const b = nodes.get(toId);
    if (!a || !b) return;
    const distance = haversineMeters([a.lon, a.lat], [b.lon, b.lat]);
    if (distance === 0) return;
    const edgeKey = `${fromId}>${toId}`;
    if (!adjacency.has(fromId)) adjacency.set(fromId, []);
    adjacency.get(fromId).push({
      to: toId,
      edgeKey,
      distance,
      speedMps,
      coordinates: [[a.lon, a.lat], [b.lon, b.lat]],
    });
  }

  for (const el of elements) {
    if (el.type !== "way" || !el.nodes || el.nodes.length < 2) continue;
    const oneway = el.tags?.oneway;
    const speedMps = SPEED_BY_HIGHWAY[el.tags?.highway] || 10;
    for (let i = 0; i < el.nodes.length - 1; i++) {
      const a = el.nodes[i];
      const b = el.nodes[i + 1];
      if (oneway === "yes" || oneway === "true" || oneway === "1") {
        addEdge(a, b, speedMps);
      } else if (oneway === "-1") {
        addEdge(b, a, speedMps);
      } else {
        addEdge(a, b, speedMps);
        addEdge(b, a, speedMps);
      }
    }
  }

  return { nodes, adjacency };
}

export async function getRoadGraph(bbox) {
  const key = bboxKey(bbox);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.graph;
  }

  const graph = await serialized(async () => {
    const query = buildQuery(bbox);
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: query,
    });
    if (!res.ok) {
      throw new Error(`Overpass API returned ${res.status}. It may be rate-limited - please wait a moment and try again.`);
    }
    const data = await res.json();
    if (!data.elements || data.elements.length === 0) {
      throw new Error("No road data found for this area from OpenStreetMap.");
    }
    return buildGraphFromOverpass(data.elements);
  });

  cache.set(key, { graph, expiresAt: Date.now() + CACHE_TTL_MS });
  return graph;
}

/** Nearest graph node to a { lat, lng } point (brute-force - fine for a city-sized bbox graph). */
export function nearestNode(graph, point) {
  let best = null;
  let bestDist = Infinity;
  for (const [id, n] of graph.nodes) {
    if (!graph.adjacency.has(id)) continue; // skip isolated nodes with no roads out
    const d = haversineMeters([point.lng, point.lat], [n.lon, n.lat]);
    if (d < bestDist) {
      bestDist = d;
      best = id;
    }
  }
  return best;
}
