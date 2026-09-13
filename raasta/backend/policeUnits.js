// Fixed roster of patrol units around the Pune metro area, with simple
// nearest-available dispatch logic. A real deployment would pull this
// from a CAD/dispatch system - this is a fixed, believable stand-in so
// the Government dashboard has something real to assign incidents to.

import { haversineMeters } from "./geo.js";

const UNITS = [
  { id: "PU-01", name: "Shivajinagar Patrol", lat: 18.5304, lng: 73.8567, status: "available" },
  { id: "PU-02", name: "Hinjewadi Highway Unit", lat: 18.5913, lng: 73.7389, status: "available" },
  { id: "PU-03", name: "Viman Nagar Beat", lat: 18.5679, lng: 73.9143, status: "available" },
  { id: "PU-04", name: "Kothrud Response Van", lat: 18.5074, lng: 73.8077, status: "available" },
  { id: "PU-05", name: "Hadapsar Patrol", lat: 18.5089, lng: 73.9260, status: "available" },
  { id: "PU-06", name: "Wakad Traffic Post", lat: 18.5975, lng: 73.7898, status: "available" },
  { id: "PU-07", name: "Swargate Rapid Unit", lat: 18.5017, lng: 73.8607, status: "available" },
];

export function getUnits() {
  return UNITS.map((u) => ({ ...u }));
}

export function nearestAvailableUnit(point) {
  let best = null;
  let bestDist = Infinity;
  for (const u of UNITS) {
    if (u.status !== "available") continue;
    const d = haversineMeters([point.lng, point.lat], [u.lng, u.lat]);
    if (d < bestDist) {
      bestDist = d;
      best = u;
    }
  }
  return best ? { ...best, distanceMeters: Math.round(bestDist) } : null;
}

export function setUnitStatus(id, status) {
  const u = UNITS.find((u) => u.id === id);
  if (u) u.status = status;
  return u ? { ...u } : null;
}

export function getUnit(id) {
  const u = UNITS.find((u) => u.id === id);
  return u ? { ...u } : null;
}
