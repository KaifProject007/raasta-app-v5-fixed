// Fixed CCTV camera list around the Pune metro area. Vehicle counts are
// simulated with the same deterministic seeded-random technique as
// trafficEngine's road congestion, so a given camera+tick always reports
// the same reading (and different cameras aren't all suspiciously in sync).

import { seededRandom } from "./geo.js";
import { currentTick } from "./trafficEngine.js";

const CAMERAS = [
  { id: "CCTV-01", name: "FC Road Junction", lat: 18.5236, lng: 73.8478 },
  { id: "CCTV-02", name: "Shivajinagar Court Signal", lat: 18.5308, lng: 73.8446 },
  { id: "CCTV-03", name: "Hinjewadi Phase 1 Gate", lat: 18.5908, lng: 73.7382 },
  { id: "CCTV-04", name: "Viman Nagar Bridge", lat: 18.5675, lng: 73.9146 },
  { id: "CCTV-05", name: "Swargate Junction", lat: 18.5017, lng: 73.8607 },
  { id: "CCTV-06", name: "Wakad Chowk", lat: 18.5978, lng: 73.7645 },
  { id: "CCTV-07", name: "Hadapsar Bypass", lat: 18.5083, lng: 73.9284 },
  { id: "CCTV-08", name: "Kothrud Depot Signal", lat: 18.5089, lng: 73.8067 },
];

export function getCameras(tick = currentTick()) {
  return CAMERAS.map((c) => {
    const rand = seededRandom(`${c.id}:${tick}`);
    const vehicleCount = Math.floor(rand() * 80) + 5;
    const density = vehicleCount > 60 ? "heavy" : vehicleCount > 30 ? "moderate" : "clear";
    return { ...c, vehicleCount, density };
  });
}
