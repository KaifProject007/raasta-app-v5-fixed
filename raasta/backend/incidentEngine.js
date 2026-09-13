// Real incident registry. Unlike the demo HTML (which just plays a scripted
// animation), triggering an incident here pins an actual OSM edge - the
// same edge object every route/tracker on that stretch of road shares - to
// a near-impassable cost. trafficEngine.edgeState() checks this registry on
// every read, so any tracked journey or fresh route request immediately
// sees the block and A* genuinely routes around it.

import { randomUUID } from "crypto";

const incidents = new Map(); // id -> incident
const blockedByEdge = new Map(); // edgeKey -> incident id

const REASONS = [
  "Accident reported by a nearby driver",
  "Vehicle breakdown blocking the lane",
  "Tree fall reported after heavy wind",
  "Road under emergency repair",
];

export function triggerIncident({ edgeKey, coordinates, distanceMeters, reason, routeId = null }) {
  const existingId = blockedByEdge.get(edgeKey);
  if (existingId && incidents.has(existingId) && incidents.get(existingId).status === "active") {
    return incidents.get(existingId); // already blocked - don't double-fire
  }

  const incident = {
    id: randomUUID(),
    edgeKey,
    coordinates,
    distanceMeters,
    reason: reason || REASONS[Math.floor(Math.random() * REASONS.length)],
    routeId,
    status: "active",
    triggeredAt: Date.now(),
    resolvedAt: null,
    assignedUnitId: null,
  };
  incidents.set(incident.id, incident);
  blockedByEdge.set(edgeKey, incident.id);
  return incident;
}

export function resolveIncident(id) {
  const incident = incidents.get(id);
  if (!incident || incident.status !== "active") return null;
  incident.status = "resolved";
  incident.resolvedAt = Date.now();
  blockedByEdge.delete(incident.edgeKey);
  return incident;
}

export function assignUnit(incidentId, unitId) {
  const incident = incidents.get(incidentId);
  if (incident) incident.assignedUnitId = unitId;
  return incident;
}

export function getIncident(id) {
  return incidents.get(id) || null;
}

export function getActiveIncidents() {
  return [...incidents.values()]
    .filter((i) => i.status === "active")
    .sort((a, b) => b.triggeredAt - a.triggeredAt);
}

export function getAllIncidents() {
  return [...incidents.values()].sort((a, b) => b.triggeredAt - a.triggeredAt);
}

export function isEdgeBlocked(edgeKey) {
  return blockedByEdge.has(edgeKey);
}
