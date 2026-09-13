import { useEffect, useState } from "react";
import { api } from "../services/api.js";
import TopNav from "./TopNav.jsx";

const POLL_MS = 5000;

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

function recommendationFor(incident) {
  if (incident.status !== "active") return "Resolved — road reopened.";
  if (incident.assignedUnit) {
    return `Dispatch ${incident.assignedUnit.name} (~${Math.round(
      incident.assignedUnit.distanceMeters / 100
    ) / 10}km away). Recommend diverting traffic around this stretch until cleared.`;
  }
  return "No unit assigned yet. Recommend nearest available patrol be dispatched.";
}

export default function GovernmentPanel() {
  const [incidents, setIncidents] = useState([]);
  const [units, setUnits] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolvingId, setResolvingId] = useState(null);

  async function refresh() {
    try {
      const [incidentsRes, unitsRes, cctvRes] = await Promise.all([
        api.incidents(),
        api.policeUnits(),
        api.cctv(),
      ]);
      setIncidents(incidentsRes.incidents || []);
      setUnits(unitsRes.units || []);
      setCameras(cctvRes.cameras || []);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleResolve(incidentId) {
    setResolvingId(incidentId);
    try {
      await api.resolveIncident(incidentId);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolvingId(null);
    }
  }

  const activeIncidents = incidents.filter((i) => i.status === "active");
  const availableUnits = units.filter((u) => u.status === "available");
  const heavyCameras = cameras.filter((c) => c.density === "heavy").length;

  return (
    <div className="app-shell">
      <TopNav active="government" />
      <div className="gov-panel">
        <div className="gov-header">
          <h1>Control Room Dashboard</h1>
          <p className="muted">Live incidents, patrol deployment and CCTV density — refreshes every 5s.</p>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

        <div className="gov-kpis">
          <div className="kpi-card">
            <span className="kpi-value">{activeIncidents.length}</span>
            <span className="kpi-label">Active incidents</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-value">{availableUnits.length}/{units.length}</span>
            <span className="kpi-label">Units available</span>
          </div>
          <div className="kpi-card">
            <span className="kpi-value">{heavyCameras}/{cameras.length}</span>
            <span className="kpi-label">Cameras showing heavy traffic</span>
          </div>
        </div>

        <div className="gov-grid">
          <div className="gov-section">
            <div className="section-label">Incident feed</div>
            {loading && incidents.length === 0 && <div className="empty-state">Loading…</div>}
            {!loading && incidents.length === 0 && (
              <div className="empty-state">No incidents reported. Trigger one from the Citizen view to see it here live.</div>
            )}
            <div className="incident-list">
              {incidents.map((inc) => (
                <div key={inc.id} className={`incident-card ${inc.status}`}>
                  <div className="incident-top">
                    <span className={`status-pill ${inc.status}`}>{inc.status}</span>
                    <span className="muted">{timeAgo(inc.triggeredAt)}</span>
                  </div>
                  <div className="incident-reason">{inc.reason}</div>
                  <div className="incident-recommendation">{recommendationFor(inc)}</div>
                  {inc.status === "active" && (
                    <button
                      className="btn btn-ghost"
                      style={{ marginTop: 10, fontSize: "0.8rem", padding: "6px 12px" }}
                      onClick={() => handleResolve(inc.id)}
                      disabled={resolvingId === inc.id}
                    >
                      {resolvingId === inc.id ? "Clearing…" : "Mark as cleared"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="gov-section">
            <div className="section-label">Police units</div>
            <div className="unit-list">
              {units.map((u) => (
                <div key={u.id} className="unit-row">
                  <span className={`unit-dot ${u.status}`} />
                  <div style={{ flex: 1 }}>
                    <div className="unit-name">{u.name}</div>
                    <div className="muted" style={{ fontSize: "0.75rem" }}>{u.id}</div>
                  </div>
                  <span className={`status-pill ${u.status}`}>{u.status}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="gov-section gov-section-wide">
            <div className="section-label">CCTV network</div>
            <div className="cctv-grid">
              {cameras.map((c) => (
                <div key={c.id} className={`cctv-card ${c.density}`}>
                  <div className="cctv-name">{c.name}</div>
                  <div className="cctv-count">{c.vehicleCount} vehicles</div>
                  <div className="cctv-density">{c.density}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
