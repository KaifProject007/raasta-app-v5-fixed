import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api.js";
import TopNav from "./TopNav.jsx";

function useDebouncedGeocode(query) {
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (!query || query.trim().length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const { results } = await api.geocode(query);
        setResults(results);
      } catch {
        setResults([]);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);
  return results;
}

export default function EmergencyPanel() {
  const navigate = useNavigate();

  const [originQuery, setOriginQuery] = useState("");
  const [destQuery, setDestQuery] = useState("");
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [focusField, setFocusField] = useState(null);
  const [vehicleType, setVehicleType] = useState("ambulance");

  const originResults = useDebouncedGeocode(focusField === "origin" ? originQuery : "");
  const destResults = useDebouncedGeocode(focusField === "destination" ? destQuery : "");

  function pickSuggestion(field, place) {
    if (field === "origin") {
      setOrigin({ lat: place.lat, lng: place.lng });
      setOriginQuery(place.label);
    } else {
      setDestination({ lat: place.lat, lng: place.lng });
      setDestQuery(place.label);
    }
    setFocusField(null);
  }

  function dispatch() {
    if (!origin || !destination) return;
    navigate("/app", {
      state: {
        origin,
        destination,
        originLabel: originQuery,
        destLabel: destQuery,
        emergency: true,
        vehicleType,
      },
    });
  }

  return (
    <div className="app-shell">
      <TopNav active="emergency" />
      <div className="emergency-panel">
        <div className="emergency-card">
          <span className="eyebrow" style={{ color: "var(--emergency)" }}>Emergency dispatch</span>
          <h1>Request the fastest safe corridor</h1>
          <p className="lede">
            Emergency routing is biased away from congestion and clears a corridor
            in real time as it drives. Enter a pickup and destination to hand off
            straight into the live map.
          </p>

          <div className="field" style={{ marginTop: 24 }}>
            <label>Vehicle type</label>
            <div className="vehicle-toggle">
              {[
                { key: "ambulance", label: "🚑 Ambulance" },
                { key: "fire", label: "🚒 Fire" },
                { key: "police", label: "🚓 Police" },
              ].map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={vehicleType === v.key ? "active" : ""}
                  onClick={() => setVehicleType(v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="route-input-row" style={{ marginTop: 18 }}>
            <span className="dot-origin" />
            <input
              placeholder="Pickup location"
              value={originQuery}
              onFocus={() => setFocusField("origin")}
              onChange={(e) => setOriginQuery(e.target.value)}
            />
            {focusField === "origin" && originResults.length > 0 && (
              <ul className="suggestions">
                {originResults.map((r, i) => (
                  <li key={i} onClick={() => pickSuggestion("origin", r)}>{r.label}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="route-input-row">
            <span className="dot-dest" />
            <input
              placeholder="Destination (hospital, incident site…)"
              value={destQuery}
              onFocus={() => setFocusField("destination")}
              onChange={(e) => setDestQuery(e.target.value)}
            />
            {focusField === "destination" && destResults.length > 0 && (
              <ul className="suggestions">
                {destResults.map((r, i) => (
                  <li key={i} onClick={() => pickSuggestion("destination", r)}>{r.label}</li>
                ))}
              </ul>
            )}
          </div>

          <button
            className="btn btn-emergency btn-block"
            style={{ marginTop: 18 }}
            disabled={!origin || !destination}
            onClick={dispatch}
          >
            Find fastest safe corridor →
          </button>
        </div>
      </div>
    </div>
  );
}
