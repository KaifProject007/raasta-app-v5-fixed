// Geographic helpers, and the hard boundary that keeps this whole app
// scoped to Maharashtra only (per product decision - state-wide India
// would mean an enormous road graph to fetch/hold/search on every request).

// Approximate real bounding box of Maharashtra state.
export const MAHARASHTRA_BBOX = {
  minLon: 72.6,
  minLat: 15.6,
  maxLon: 80.9,
  maxLat: 22.1,
};

export function isInsideMaharashtra(lat, lon) {
  return (
    lat >= MAHARASHTRA_BBOX.minLat &&
    lat <= MAHARASHTRA_BBOX.maxLat &&
    lon >= MAHARASHTRA_BBOX.minLon &&
    lon <= MAHARASHTRA_BBOX.maxLon
  );
}

export function haversineMeters([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

/** Padded bounding box around two points, used to fetch just enough road graph for one trip. */
export function paddedBbox(a, b, paddingDeg = 0.06) {
  const minLon = Math.min(a.lng, b.lng) - paddingDeg;
  const maxLon = Math.max(a.lng, b.lng) + paddingDeg;
  const minLat = Math.min(a.lat, b.lat) - paddingDeg;
  const maxLat = Math.max(a.lat, b.lat) + paddingDeg;

  // clamp to Maharashtra so a trip near the border never pulls in a
  // huge out-of-state graph
  return {
    minLon: Math.max(minLon, MAHARASHTRA_BBOX.minLon),
    minLat: Math.max(minLat, MAHARASHTRA_BBOX.minLat),
    maxLon: Math.min(maxLon, MAHARASHTRA_BBOX.maxLon),
    maxLat: Math.min(maxLat, MAHARASHTRA_BBOX.maxLat),
  };
}

export function bboxKey(bbox) {
  const r = (n) => Math.round(n * 100) / 100; // ~1km grid, keeps cache hit rate reasonable
  return `${r(bbox.minLon)},${r(bbox.minLat)},${r(bbox.maxLon)},${r(bbox.maxLat)}`;
}

// Deterministic PRNG from a string seed - same seed always produces the
// same sequence. Shared by trafficEngine (edge congestion) and cctv
// (simulated live vehicle counts) so both stay reproducible per tick.
export function seededRandom(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
