import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import bcrypt from "bcryptjs";
import fetch from "node-fetch";
import { randomUUID } from "crypto";

import { db, initDb } from "./db.js";
import { signToken, requireAuth } from "./auth.js";
import { MAHARASHTRA_BBOX, isInsideMaharashtra, paddedBbox } from "./geo.js";
import { getRoadGraph, nearestNode } from "./graphService.js";
import { findRoutesWithAlternatives, aStar } from "./pathfinder.js";
import {
  annotateEdges,
  liveEdgeCostSeconds,
  freeFlowCostSeconds,
  trackRoute,
  refreshTrackedRoute,
  getTrackedRoute,
  stopTracking,
  getActiveRouteIds,
  TICK_MS,
} from "./trafficEngine.js";
import {
  triggerIncident,
  resolveIncident,
  assignUnit,
  getAllIncidents,
  isEdgeBlocked,
} from "./incidentEngine.js";
import { getUnits, nearestAvailableUnit, setUnitStatus } from "./policeUnits.js";
import { getCameras } from "./cctv.js";

const PORT = process.env.PORT || 4000;
const PHOTON_URL = "https://photon.komoot.io/api/";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

await initDb();

// Full route metadata (graph + endpoints) for every route ever returned by
// /api/route, keyed by routeId, so we can re-plan from the same graph
// later without re-fetching Overpass. A local dev process only, so an
// in-memory Map is fine.
const routeRegistry = new Map();

// ---------- AUTH ----------

app.post("/api/auth/signup", async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }
  await db.read();
  const exists = db.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: randomUUID(), name, email, passwordHash, createdAt: Date.now() };
  db.data.users.push(user);
  await db.write();

  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  await db.read();
  const user = db.data.users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase());
  if (!user) return res.status(401).json({ error: "No account found with that email." });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Incorrect password." });

  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ---------- GEOCODING (Maharashtra-biased, free, key-less) ----------
// Photon gives real autocomplete-style prefix matching (much better than
// Nominatim for "still typing" queries); Nominatim is used as a fallback
// for the odd query Photon's index misses.

app.get("/api/geocode", requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json({ results: [] });

  const centerLat = (MAHARASHTRA_BBOX.minLat + MAHARASHTRA_BBOX.maxLat) / 2;
  const centerLon = (MAHARASHTRA_BBOX.minLon + MAHARASHTRA_BBOX.maxLon) / 2;

  try {
    const photonUrl = `${PHOTON_URL}?q=${encodeURIComponent(q)}&lat=${centerLat}&lon=${centerLon}&limit=8&lang=en`;
    const r = await fetch(photonUrl);
    const data = await r.json();

    let results = (data.features || [])
      .map((f) => {
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties || {};
        const label = [p.name, p.street, p.city || p.district, p.state]
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(", ");
        return { label: label || p.name || "Unnamed location", lat, lng: lon, state: p.state };
      })
      .filter((r) => isInsideMaharashtra(r.lat, r.lng));

    if (results.length === 0) {
      // fallback to Nominatim for anything Photon's index didn't catch
      const nomUrl = `${NOMINATIM_URL}?format=json&limit=6&countrycodes=in&q=${encodeURIComponent(q + ", Maharashtra")}`;
      const nr = await fetch(nomUrl, { headers: { "User-Agent": "RAASTA-local-dev-app (localhost demo)" } });
      const ndata = await nr.json();
      results = ndata
        .map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }))
        .filter((r) => isInsideMaharashtra(r.lat, r.lng));
    }

    res.json({ results: results.slice(0, 8) });
  } catch (err) {
    console.error("Geocode error:", err.message);
    res.status(502).json({ error: "Could not reach the geocoding service. Check your internet connection." });
  }
});

// ---------- ROUTING: real road graph + traffic-aware A* ----------

function buildRouteObject({ result, graph, startId, goalId, mode, label }) {
  const routeId = randomUUID();
  const segments = annotateEdges(result.edges, mode);
  const coordinates = [result.edges[0].coordinates[0], ...result.edges.map((e) => e.coordinates[1])];

  const freeflowSeconds = result.edges.reduce((sum, e) => sum + freeFlowCostSeconds(e), 0);
  const trafficSeconds = result.totalTimeSeconds;
  const estimatedDelaySeconds = Math.max(0, Math.round(trafficSeconds - freeflowSeconds));

  // Distance-weighted, not "one bad edge taints the whole route": a single
  // 40m congested stretch inside a 10km trip shouldn't earn the same HEAVY
  // badge as a route that's actually jammed for most of its length. This is
  // what was making every route card show red regardless of how small the
  // congested portion actually was.
  const totalDist = segments.reduce((sum, s) => sum + s.distanceMeters, 0) || 1;
  const blockedDist = segments.filter((s) => s.level === "blocked").reduce((sum, s) => sum + s.distanceMeters, 0);
  const heavyDist = segments.filter((s) => s.level === "heavy").reduce((sum, s) => sum + s.distanceMeters, 0);
  const moderateDist = segments.filter((s) => s.level === "moderate").reduce((sum, s) => sum + s.distanceMeters, 0);
  const heavyRatio = (heavyDist + blockedDist) / totalDist;
  const congestedRatio = (heavyDist + blockedDist + moderateDist) / totalDist;
  const overallLevel = blockedDist > 0 ? "heavy" : heavyRatio >= 0.25 ? "heavy" : congestedRatio >= 0.25 ? "moderate" : "clear";

  const route = {
    routeId,
    label,
    distanceMeters: Math.round(result.totalDistance),
    durationSeconds: Math.round(freeflowSeconds),
    estimatedDelaySeconds,
    overallLevel,
    mode,
    coordinates,
    segments,
  };

  routeRegistry.set(routeId, { graph, startId, goalId, edges: result.edges, mode });
  return route;
}

app.post("/api/route", requireAuth, async (req, res) => {
  const { origin, destination, mode } = req.body || {};
  if (!origin || !destination) {
    return res.status(400).json({ error: "Origin and destination are required." });
  }
  if (!isInsideMaharashtra(origin.lat, origin.lng) || !isInsideMaharashtra(destination.lat, destination.lng)) {
    return res.status(400).json({ error: "RAASTA currently only covers locations within Maharashtra state." });
  }

  try {
    const bbox = paddedBbox(origin, destination);
    const graph = await getRoadGraph(bbox);

    const startId = nearestNode(graph, origin);
    const goalId = nearestNode(graph, destination);
    if (startId == null || goalId == null) {
      return res.status(404).json({ error: "Could not find a road near one of those points." });
    }
    if (startId === goalId) {
      return res.status(400).json({ error: "Origin and destination resolve to the same road point." });
    }

    const isEmergency = mode === "emergency";
    const baseCostFn = (edge) => liveEdgeCostSeconds(edge, isEmergency ? "emergency" : "normal");

    const results = findRoutesWithAlternatives(graph, startId, goalId, baseCostFn, 3);
    if (results.length === 0) {
      return res.status(404).json({ error: "No drivable path could be found between those two points." });
    }

    const routeMode = isEmergency ? "emergency" : "normal";
    const routes = results.map((result, i) =>
      buildRouteObject({
        result,
        graph,
        startId,
        goalId,
        mode: routeMode,
        label: i === 0 ? (isEmergency ? "Emergency corridor" : "Fastest route") : `Alternative ${i}`,
      })
    );

    res.json({ routes });
  } catch (err) {
    console.error("Routing error:", err.message);
    res.status(502).json({ error: err.message || "Could not compute a route. Please try again." });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------- INCIDENT ENGINE: real edge blocking + rerouting ----------
// Unlike the earlier scripted-animation demo, this pins an actual OSM edge
// (shared by every tracked route/graph over that stretch of road) to a
// near-impassable cost. The existing traffic tick loop below picks this up
// on its very next pass and genuinely A*-reroutes around it.

app.post("/api/route/:routeId/incident", requireAuth, (req, res) => {
  const { routeId } = req.params;
  const meta = routeRegistry.get(routeId);
  if (!meta) {
    return res.status(404).json({ error: "That route isn't active. Start a journey first." });
  }

  const edges = meta.edges;
  const progress = Math.min(0.95, Math.max(0, Number(req.body?.progress) || 0));
  const currentIdx = Math.floor(progress * (edges.length - 1));

  // Find the first not-already-blocked edge somewhere ahead of the car so
  // the incident is meaningful (not behind where the driver already is).
  let targetIdx = null;
  for (let i = currentIdx + 1; i < edges.length; i++) {
    if (!isEdgeBlocked(edges[i].edgeKey)) {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx == null) targetIdx = edges.length - 1;
  const edge = edges[targetIdx];

  const incident = triggerIncident({
    edgeKey: edge.edgeKey,
    coordinates: edge.coordinates,
    distanceMeters: Math.round(edge.distance),
    routeId,
  });

  const [lon, lat] = edge.coordinates[0];
  const unit = nearestAvailableUnit({ lat, lng: lon });
  if (unit) {
    assignUnit(incident.id, unit.id);
    setUnitStatus(unit.id, "busy");
  }

  // Refresh immediately (force = true) so the caller's own UI updates
  // without waiting for the shared tick loop.
  const refreshed = refreshTrackedRoute(routeId, true);

  res.json({
    incident: { ...incident, assignedUnit: unit || null },
    segments: refreshed?.segments || null,
  });
});

app.get("/api/incidents", requireAuth, (req, res) => {
  res.json({ incidents: getAllIncidents() });
});

app.post("/api/incidents", requireAuth, (req, res) => {
  // Manual incident creation (e.g. from the Government dashboard), pinned
  // to an arbitrary point rather than a tracked route's edge.
  const { lat, lng, reason } = req.body || {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ error: "lat and lng are required." });
  }
  const edgeKey = `manual:${lat.toFixed(5)},${lng.toFixed(5)}:${randomUUID()}`;
  const incident = triggerIncident({
    edgeKey,
    coordinates: [[lng, lat], [lng, lat]],
    distanceMeters: 0,
    reason,
  });
  const unit = nearestAvailableUnit({ lat, lng });
  if (unit) {
    assignUnit(incident.id, unit.id);
    setUnitStatus(unit.id, "busy");
  }
  res.json({ incident: { ...incident, assignedUnit: unit || null } });
});

app.post("/api/incidents/:id/resolve", requireAuth, (req, res) => {
  const incident = resolveIncident(req.params.id);
  if (!incident) return res.status(404).json({ error: "Incident not found or already resolved." });
  if (incident.assignedUnitId) setUnitStatus(incident.assignedUnitId, "available");
  res.json({ incident });
});

app.get("/api/police-units", requireAuth, (req, res) => {
  res.json({ units: getUnits() });
});

app.get("/api/cctv", requireAuth, (req, res) => {
  res.json({ cameras: getCameras() });
});

// ---------- REAL-TIME TRAFFIC + A*-DRIVEN REROUTE SUGGESTIONS ----------

// Per-route cooldown so the driver always gets a chance to act on (or the
// countdown on) an alert before another one can replace it. Belt-and-braces
// alongside the traffic-smoothing fix in trafficEngine.js - even a
// perfectly legitimate jam shouldn't retrigger the decision popup faster
// than the driver can realistically respond to it.
const lastSuggestionAt = new Map(); // routeId -> timestamp
const SUGGESTION_COOLDOWN_MS = 15000; // a little longer than the 10s auto-continue window on the frontend

io.on("connection", (socket) => {
  socket.on("track-route", ({ routeId }) => {
    const meta = routeRegistry.get(routeId);
    if (!meta) return;
    socket.join(routeId);
    trackRoute(routeId, meta);
    lastSuggestionAt.delete(routeId); // fresh start (or restart) of this journey - clear any old cooldown
  });

  socket.on("stop-track", ({ routeId }) => {
    if (!routeId) return;
    socket.leave(routeId);
    stopTracking(routeId);
    lastSuggestionAt.delete(routeId);
  });

  socket.on("disconnect", () => {});
});

// global simulation clock - every tick, refresh live traffic on tracked
// routes AND re-run A* from scratch to see whether a genuinely better path
// has opened up elsewhere on the graph.
setInterval(() => {
  for (const routeId of getActiveRouteIds()) {
    const room = io.sockets.adapter.rooms.get(routeId);
    if (!room || room.size === 0) {
      // Nobody is actually listening for this route anymore (tab closed,
      // navigated away without ending the journey, etc). Without this,
      // an abandoned journey would sit here re-running A* on every tick
      // forever, and that cost only grows as more journeys get abandoned -
      // a big part of why the app could get slower and slower over a
      // session. The frontend now also stops tracking on its own when you
      // navigate away (see Dashboard.jsx), so this is now mostly a backstop.
      stopTracking(routeId);
      lastSuggestionAt.delete(routeId);
      continue;
    }

    const refreshed = refreshTrackedRoute(routeId);
    if (!refreshed) continue;

    io.to(routeId).emit("traffic-update", { routeId, segments: refreshed.segments });

    if (refreshed.newJams.length === 0) continue;

    const now = Date.now();
    const lastAt = lastSuggestionAt.get(routeId) || 0;
    if (now - lastAt < SUGGESTION_COOLDOWN_MS) continue; // driver's already mid-decision on this route - don't pile on

    lastSuggestionAt.set(routeId, now);

    const tracked = getTrackedRoute(routeId);
    const jam = refreshed.newJams[0];
    const isBlocked = jam.level === "blocked";
    io.to(routeId).emit("jam-alert", {
      routeId,
      segmentIndex: jam.index,
      level: jam.level,
      message: isBlocked
        ? `🚧 Incident reported ahead — road blocked (~${jam.distanceMeters}m). Searching for a safe detour...`
        : `Heavy traffic detected on your route (~${jam.distanceMeters}m stretch). Checking for a faster path...`,
    });

    // A* re-plan: is there a meaningfully better path right now?
    const currentCostNow = tracked.edges.reduce(
      (sum, e) => sum + liveEdgeCostSeconds(e, tracked.mode),
      0
    );
    const altCostFn = (edge) => liveEdgeCostSeconds(edge, tracked.mode);
    const altResult = aStar(tracked.graph, tracked.startId, tracked.goalId, altCostFn);

    if (altResult && altResult.totalTimeSeconds < currentCostNow * 0.9) {
      const altEdgeKeys = new Set(altResult.edges.map((e) => e.edgeKey));
      const overlap = tracked.edges.filter((e) => altEdgeKeys.has(e.edgeKey)).length / tracked.edges.length;
      if (overlap < 0.9) {
        const altRoute = buildRouteObject({
          result: altResult,
          graph: tracked.graph,
          startId: tracked.startId,
          goalId: tracked.goalId,
          mode: tracked.mode,
          label: "AI suggested route",
        });
        const savedMin = Math.max(1, Math.round((currentCostNow - altResult.totalTimeSeconds) / 60));
        io.to(routeId).emit("smart-reroute-suggestion", {
          routeId,
          route: altRoute,
          message: `A different path is now roughly ${savedMin} min faster than your current route.`,
        });
      }
    }
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`RAASTA backend running on http://localhost:${PORT}`);
});
