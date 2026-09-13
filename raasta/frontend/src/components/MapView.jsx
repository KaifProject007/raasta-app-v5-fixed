import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";

// Free, key-less vector basemap - no signup, no billing, no rate-limit wall.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const DEFAULT_CENTER = [73.8567, 18.5204]; // Pune, India

// Keep the whole app scoped to Maharashtra - mirrors backend/geo.js
const MAHARASHTRA_BOUNDS = [
  [72.4, 15.4], // southwest
  [81.1, 22.3], // northeast
];

const EMPTY_FC = { type: "FeatureCollection", features: [] };

function clearLayer(map, id) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

function segmentsToFeatureCollection(segments, mode) {
  return {
    type: "FeatureCollection",
    features: segments.map((s) => ({
      type: "Feature",
      properties: {
        color: s.color,
        width: mode === "emergency" ? 8 : 6,
        emergency: mode === "emergency",
      },
      geometry: { type: "LineString", coordinates: s.coordinates },
    })),
  };
}

export default function MapView({
  origin,
  destination,
  candidateRoutes = [],
  selectedRoute,
  journeyActive,
  journeyProgress, // 0..1
  hoveredRouteId, // routeId being hovered in the sidebar/alert list, or null
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({ origin: null, destination: null, car: null });
  const [ready, setReady] = useState(false);
  const [is3D, setIs3D] = useState(true);

  // init map once
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: 12,
      pitch: 60,
      bearing: -12,
      antialias: true,
      maxBounds: MAHARASHTRA_BOUNDS,
      minZoom: 6,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    map.on("load", () => {
      map.addSource("selected-route", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "selected-route-line",
        type: "line",
        source: "selected-route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "selected-route-dash",
        type: "line",
        source: "selected-route",
        filter: ["==", ["get", "emergency"], true],
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [1, 2] },
      });
      setReady(true);
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  // origin / destination markers
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;

    if (origin) {
      if (!markersRef.current.origin) {
        const el = document.createElement("div");
        el.style.cssText =
          "width:16px;height:16px;border-radius:50%;background:#2E5AAC;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)";
        markersRef.current.origin = new maplibregl.Marker({ element: el }).setLngLat([origin.lng, origin.lat]).addTo(map);
      } else {
        markersRef.current.origin.setLngLat([origin.lng, origin.lat]);
      }
    }
    if (destination) {
      if (!markersRef.current.destination) {
        const el = document.createElement("div");
        el.style.cssText =
          "width:16px;height:16px;border-radius:50%;background:#E23D3D;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)";
        markersRef.current.destination = new maplibregl.Marker({ element: el }).setLngLat([destination.lng, destination.lat]).addTo(map);
      } else {
        markersRef.current.destination.setLngLat([destination.lng, destination.lat]);
      }
    }

    if (origin && destination) {
      const bounds = new maplibregl.LngLatBounds();
      bounds.extend([origin.lng, origin.lat]);
      bounds.extend([destination.lng, destination.lat]);
      map.fitBounds(bounds, { padding: 120, duration: 800, pitch: is3D ? 60 : 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, origin, destination]);

  // faint candidate routes (unselected alternatives). One of them lights up
  // in the accent color, drawn on top, when its card is hovered - and drops
  // straight back to neutral gray the instant the hover ends. Nothing about
  // this state persists once the pointer moves away.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    candidateRoutes.forEach((route, i) => {
      const id = `candidate-${i}`;
      clearLayer(map, id);
      if (selectedRoute && route.routeId === selectedRoute.routeId) return;
      const isHovered = hoveredRouteId === route.routeId;
      map.addSource(id, {
        type: "geojson",
        data: { type: "Feature", geometry: { type: "LineString", coordinates: route.coordinates } },
      });
      map.addLayer({
        id,
        type: "line",
        source: id,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": isHovered ? "#2E5AAC" : "#c3cbd8",
          "line-width": isHovered ? 6 : 4,
          "line-opacity": isHovered ? 0.95 : 0.7,
        },
      });
      // keep the hovered route's line above the others so it isn't occluded
      if (isHovered) map.moveLayer(id);
    });
    return () => candidateRoutes.forEach((_, i) => clearLayer(map, `candidate-${i}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, candidateRoutes, selectedRoute, hoveredRouteId]);

  // selected route drawn as colored threads - ONE source updated via setData,
  // not one map layer per segment (real road graphs can have 50-200+ edges
  // per trip, and recreating that many layers every traffic tick would be slow).
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const source = map.getSource("selected-route");
    if (!source) return;
    if (!selectedRoute) {
      source.setData(EMPTY_FC);
      return;
    }
    source.setData(segmentsToFeatureCollection(selectedRoute.segments, selectedRoute.mode));
  }, [ready, selectedRoute]);

  // moving "you are here" marker along the route while journey is active
  useEffect(() => {
    if (!ready || !selectedRoute || !journeyActive) return;
    const map = mapRef.current;
    const coords = selectedRoute.coordinates;
    const idx = Math.min(coords.length - 1, Math.floor(journeyProgress * (coords.length - 1)));
    const [lng, lat] = coords[idx];

    if (!markersRef.current.car) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:22px;height:22px;border-radius:50%;background:#10151C;border:3px solid white;box-shadow:0 0 0 6px rgba(46,90,172,0.25)";
      markersRef.current.car = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    } else {
      markersRef.current.car.setLngLat([lng, lat]);
    }
    map.easeTo({ center: [lng, lat], duration: 600 });
  }, [ready, selectedRoute, journeyActive, journeyProgress]);

  function toggleView() {
    const map = mapRef.current;
    const next = !is3D;
    setIs3D(next);
    map.easeTo({ pitch: next ? 60 : 0, bearing: next ? -12 : 0, duration: 700 });
  }

  return (
    <div className="map-area">
      <div ref={containerRef} className="map-canvas" />

      <div className="map-controls">
        <div className="view-toggle">
          <button className={is3D ? "active" : ""} onClick={() => !is3D && toggleView()}>3D view</button>
          <button className={!is3D ? "active" : ""} onClick={() => is3D && toggleView()}>Top view</button>
        </div>
      </div>

      <div className="map-legend">
        <div className="item"><span className="swatch" style={{ background: "#1FAE6B" }} /> Clear</div>
        <div className="item"><span className="swatch" style={{ background: "#F5A623" }} /> Moderate</div>
        <div className="item"><span className="swatch" style={{ background: "#E23D3D" }} /> Heavy</div>
        <div className="item"><span className="swatch" style={{ background: "#7A1010" }} /> Blocked</div>
      </div>
    </div>
  );
}
