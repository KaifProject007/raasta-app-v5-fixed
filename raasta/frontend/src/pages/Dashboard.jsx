import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../services/api.js";
import { socket } from "../services/socket.js";
import MapView from "../components/MapView.jsx";
import RouteCard from "../components/RouteCard.jsx";
import AlertToast from "../components/AlertToast.jsx";
import TopNav from "../components/TopNav.jsx";

const JOURNEY_DURATION_MS = 60000; // simulated traversal time, independent of real ETA

// A jam anywhere on the route used to trigger the decision popup immediately,
// even if it was 8km ahead or already behind the car. This is the "decision
// zone": only jams within the next LOOKAHEAD_FRACTION of the remaining route
// (and never behind the car) are allowed to interrupt the driver.
const LOOKAHEAD_FRACTION = 0.2;
const MIN_LOOKAHEAD_SEGMENTS = 2;
const AUTO_CONTINUE_MS = 10000;

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

export default function Dashboard() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // handoff from the Emergency mode screen (pickup/destination chosen there)
  const handoff = location.state || null;

  const [originQuery, setOriginQuery] = useState(handoff?.originLabel || "");
  const [destQuery, setDestQuery] = useState(handoff?.destLabel || "");
  const [origin, setOrigin] = useState(handoff?.origin || null);
  const [destination, setDestination] = useState(handoff?.destination || null);
  const [focusField, setFocusField] = useState(null);

  const [emergencyMode, setEmergencyMode] = useState(!!handoff?.emergency);
  const [routes, setRoutes] = useState([]);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [routeError, setRouteError] = useState("");

  const [journeyActive, setJourneyActive] = useState(false);
  const [journeyProgress, setJourneyProgress] = useState(0);
  const [liveLog, setLiveLog] = useState([]);
  const [activeAlert, setActiveAlert] = useState(null);
  const [hoveredRouteId, setHoveredRouteId] = useState(null);

  const originResults = useDebouncedGeocode(focusField === "origin" ? originQuery : "");
  const destResults = useDebouncedGeocode(focusField === "destination" ? destQuery : "");

  const progressTimer = useRef(null);
  const progressStart = useRef(null);
  const pausedProgress = useRef(0); // progress (0..1) frozen at while a decision card is open
  const selectedRouteRef = useRef(null); // always-current mirror of selectedRoute, for use inside the socket callback
  const journeyProgressRef = useRef(0); // always-current mirror of journeyProgress, same reason
  const journeyActiveRef = useRef(false); // always-current mirror of journeyActive, for use in unmount cleanup

  // keep refs in sync so the socket callback (registered once) always sees
  // current values without needing to re-subscribe on every render
  useEffect(() => { selectedRouteRef.current = selectedRoute; }, [selectedRoute]);
  useEffect(() => { journeyProgressRef.current = journeyProgress; }, [journeyProgress]);
  useEffect(() => { journeyActiveRef.current = journeyActive; }, [journeyActive]);

  // Leaving this page mid-journey (e.g. tapping "Government" or "Emergency"
  // in the top nav, or logging out) used to leave the progress timer running
  // in the background forever and never tell the backend to stop tracking
  // this route - so the server kept re-running A* for it on every tick with
  // nobody left to receive the result. Each abandoned journey added its own
  // permanent background load, which is why things could feel like they got
  // slower and slower, especially noticeable right after "restarting" a
  // journey (now there'd be two routes being tracked instead of one).
  useEffect(() => {
    return () => {
      clearInterval(progressTimer.current);
      if (journeyActiveRef.current && selectedRouteRef.current) {
        socket.emit("stop-track", { routeId: selectedRouteRef.current.routeId });
      }
    };
  }, []);

  // Handed off from Emergency mode with an origin/destination already
  // picked — auto-run the search once, then clear the router state so a
  // page refresh doesn't silently redo it.
  useEffect(() => {
    if (handoff?.origin && handoff?.destination) {
      findRoutes();
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pauseForDecision() {
    clearInterval(progressTimer.current);
    pausedProgress.current = journeyProgressRef.current;
  }

  function resumeAfterDecision() {
    if (!journeyActive) return;
    progressStart.current = Date.now() - pausedProgress.current * JOURNEY_DURATION_MS;
    progressTimer.current = setInterval(() => {
      const elapsed = Date.now() - progressStart.current;
      const pct = Math.min(1, elapsed / JOURNEY_DURATION_MS);
      setJourneyProgress(pct);
      if (pct >= 1) stopJourney();
    }, 300);
  }

  // --- socket listeners for live traffic + jam alerts ---
  useEffect(() => {
    function onTrafficUpdate({ routeId, segments }) {
      setSelectedRoute((prev) => (prev && prev.routeId === routeId ? { ...prev, segments } : prev));
      setRoutes((prev) => prev.map((r) => (r.routeId === routeId ? { ...r, segments } : r)));
    }
    function onJamAlert(payload) {
      const current = selectedRouteRef.current;
      if (!current || current.routeId !== payload.routeId) return;

      // Decision-zone geofence: a jam used to interrupt the driver no matter
      // where it was on the route - behind the car, or 8km ahead. Now it only
      // fires for jams within the next slice of the remaining route.
      const totalSegments = current.segments.length;
      const currentSegmentIndex = Math.floor(journeyProgressRef.current * (totalSegments - 1));
      const lookahead = Math.max(MIN_LOOKAHEAD_SEGMENTS, Math.round(totalSegments * LOOKAHEAD_FRACTION));
      const aheadOfCar = payload.segmentIndex - currentSegmentIndex;
      if (aheadOfCar < 0 || aheadOfCar > lookahead) return;

      // Don't let a fresh jam alert stomp on a decision the driver is
      // already mid-way through making - only take over once the current
      // alert (if any) has cleared, or there is none yet. This mirrors the
      // guard smart-reroute-suggestion already had below; without it here
      // too, back-to-back alerts kept resetting each other's countdown so
      // the popup - and the frozen journey behind it - never actually
      // cleared on its own.
      setActiveAlert((prevAlert) => {
        if (prevAlert && prevAlert.deadline && prevAlert.deadline > Date.now()) return prevAlert;
        pauseForDecision();
        return { ...payload, deadline: Date.now() + AUTO_CONTINUE_MS };
      });
      setLiveLog((log) => [{ ...payload, time: new Date(), level: "heavy" }, ...log].slice(0, 20));
    }
    function onSmartReroute(payload) {
      setSelectedRoute((current) => {
        if (current && current.routeId === payload.routeId) {
          setRoutes((prev) =>
            prev.some((r) => r.routeId === payload.route.routeId) ? prev : [...prev, payload.route]
          );
          // Give this its own deadline so it behaves the same as a jam alert
          // (auto-continues instead of sitting open forever) and never
          // silently overwrites an in-progress jam-alert's countdown with a
          // deadline-less alert - only take over once the current alert
          // (if any) has cleared, or there is none yet.
          setActiveAlert((prevAlert) => {
            if (prevAlert && prevAlert.deadline && prevAlert.deadline > Date.now()) return prevAlert;
            pauseForDecision();
            return { routeId: payload.routeId, message: payload.message, title: "Faster route found", deadline: Date.now() + AUTO_CONTINUE_MS };
          });
          setLiveLog((log) => [{ message: payload.message, time: new Date(), level: "moderate" }, ...log].slice(0, 20));
        }
        return current;
      });
    }
    socket.on("traffic-update", onTrafficUpdate);
    socket.on("jam-alert", onJamAlert);
    socket.on("smart-reroute-suggestion", onSmartReroute);
    return () => {
      socket.off("traffic-update", onTrafficUpdate);
      socket.off("jam-alert", onJamAlert);
      socket.off("smart-reroute-suggestion", onSmartReroute);
    };
  }, []);

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

  async function findRoutes() {
    if (!origin || !destination) return;
    setLoadingRoutes(true);
    setRouteError("");
    stopJourney();
    try {
      const { routes } = await api.route({ origin, destination, mode: emergencyMode ? "emergency" : "normal" });
      setRoutes(routes);
      setSelectedRoute(routes[0] || null);
    } catch (err) {
      setRouteError(err.message);
      setRoutes([]);
      setSelectedRoute(null);
    } finally {
      setLoadingRoutes(false);
    }
  }

  function selectRoute(route) {
    if (journeyActive) {
      switchToRoute(route, "You switched routes manually.");
    } else {
      setSelectedRoute(route);
    }
  }

  // Swap the route currently being driven WITHOUT ending the journey -
  // stop tracking the old route's traffic, start tracking the new one,
  // and keep the simulated car moving (at its current % progress).
  function switchToRoute(route, logMessage) {
    setSelectedRoute((prev) => {
      if (prev && prev.routeId !== route.routeId) {
        socket.emit("stop-track", { routeId: prev.routeId });
      }
      return route;
    });
    socket.emit("track-route", { routeId: route.routeId });
    setActiveAlert(null);
    setLiveLog((log) => [{ message: `Rerouted to "${route.label}". ${logMessage || ""}`.trim(), time: new Date(), level: "moderate" }, ...log].slice(0, 20));
    resumeAfterDecision();
  }

  function startJourney() {
    if (!selectedRoute) return;
    clearInterval(progressTimer.current); // guard against a leftover timer if this ever fires while one's already running
    socket.emit("track-route", { routeId: selectedRoute.routeId });
    setJourneyActive(true);
    setJourneyProgress(0);
    setLiveLog([]);
    progressStart.current = Date.now();
    progressTimer.current = setInterval(() => {
      const elapsed = Date.now() - progressStart.current;
      const pct = Math.min(1, elapsed / JOURNEY_DURATION_MS);
      setJourneyProgress(pct);
      if (pct >= 1) stopJourney();
    }, 300);
  }

  function stopJourney() {
    if (selectedRoute) socket.emit("stop-track", { routeId: selectedRoute.routeId });
    clearInterval(progressTimer.current);
    setJourneyActive(false);
    setActiveAlert(null);
  }

  // routes other than the one currently jammed, offered as tappable choices in the alert
  const rerouteOptions = selectedRoute
    ? routes.filter((r) => r.routeId !== selectedRoute.routeId)
    : [];

  function chooseRerouteOption(route) {
    switchToRoute(route, "Continuing your journey on the new route.");
  }

  function dismissAlert() {
    setActiveAlert(null);
    resumeAfterDecision();
  }

  // Hover-preview: highlight a route's full path on the map while the
  // pointer is over its card, and clear the moment it leaves - nothing
  // stays highlighted after the fact.
  function previewRoute(route) {
    setHoveredRouteId(route.routeId);
  }
  function clearRoutePreview() {
    setHoveredRouteId(null);
  }

  const eta = selectedRoute
    ? Math.round((selectedRoute.durationSeconds + selectedRoute.estimatedDelaySeconds) / 60)
    : null;

  // triggers a real incident on an OSM edge ahead of the car's current
  // position on the tracked route - see POST /api/route/:routeId/incident
  const [simulatingIncident, setSimulatingIncident] = useState(false);
  async function simulateIncidentAhead() {
    if (!selectedRoute || !journeyActive) return;
    setSimulatingIncident(true);
    try {
      const { segments } = await api.simulateIncident(selectedRoute.routeId, journeyProgressRef.current);
      if (segments) {
        setSelectedRoute((prev) => (prev && prev.routeId === selectedRoute.routeId ? { ...prev, segments } : prev));
        setRoutes((prev) => prev.map((r) => (r.routeId === selectedRoute.routeId ? { ...r, segments } : r)));
      }
      setLiveLog((log) => [
        { message: "🚧 Simulated incident triggered ahead on your route.", time: new Date(), level: "blocked" },
        ...log,
      ].slice(0, 20));
    } catch (err) {
      setLiveLog((log) => [
        { message: `Could not simulate incident: ${err.message}`, time: new Date(), level: "heavy" },
        ...log,
      ].slice(0, 20));
    } finally {
      setSimulatingIncident(false);
    }
  }

  return (
    <div className="app-shell">
      <TopNav active="citizen" />
      <div className="dashboard">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="user-chip">
            <div className="avatar">{user?.name?.[0]?.toUpperCase() || "U"}</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{user?.name}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--ink-faint)" }}>{user?.email}</div>
            </div>
          </div>
          <button className="logout-link" onClick={logout}>Log out</button>
        </div>

        <div className="sidebar-body">
          <div>
            <div className="section-label">Plan your trip</div>
            <div className="route-form">
              <div className="route-input-row">
                <span className="dot-origin" />
                <input
                  placeholder="From — current location or address"
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
                  placeholder="To — where do you want to go?"
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

              <div className="emergency-toggle">
                <span className="label">🚑 Emergency corridor</span>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={emergencyMode}
                    onChange={(e) => setEmergencyMode(e.target.checked)}
                  />
                  <span className="track" />
                </label>
              </div>

              <button
                className={`btn btn-block ${emergencyMode ? "btn-emergency" : "btn-primary"}`}
                onClick={findRoutes}
                disabled={!origin || !destination || loadingRoutes}
              >
                {loadingRoutes ? "Finding routes…" : emergencyMode ? "Find fastest safe corridor" : "Find routes"}
              </button>
              {routeError && <div className="auth-error">{routeError}</div>}
            </div>
          </div>

          {routes.length > 0 && (
            <div>
              <div className="section-label">Route options</div>
              <div className="route-list">
                {routes.map((r) => (
                  <RouteCard
                    key={r.routeId}
                    route={r}
                    selected={selectedRoute?.routeId === r.routeId}
                    onSelect={selectRoute}
                    onHover={previewRoute}
                    onHoverEnd={clearRoutePreview}
                  />
                ))}
              </div>
            </div>
          )}

          {selectedRoute && (
            <div className="eta-panel">
              <div className="row">
                <span className="big">{eta} min</span>
                <span className="muted">{selectedRoute.label}</span>
              </div>
              <div className="muted" style={{ marginTop: 8 }}>
                {journeyActive
                  ? `Journey in progress — ${Math.round(journeyProgress * 100)}% complete`
                  : "Not started yet"}
              </div>
              <div className="journey-controls" style={{ marginTop: 14 }}>
                {!journeyActive ? (
                  <button className="btn btn-primary btn-block" onClick={startJourney}>Start journey</button>
                ) : (
                  <>
                    <button className="btn btn-ghost btn-block" style={{ background: "white" }} onClick={stopJourney}>
                      End journey
                    </button>
                    <button
                      className="btn btn-ghost btn-block"
                      style={{ marginTop: 8, background: "white" }}
                      onClick={simulateIncidentAhead}
                      disabled={simulatingIncident}
                    >
                      {simulatingIncident ? "Reporting…" : "🚧 Simulate incident ahead"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {liveLog.length > 0 && (
            <div>
              <div className="section-label">Live traffic log</div>
              <div className="live-log">
                {liveLog.map((item, i) => (
                  <div key={i} className={`live-log-item ${item.level}`}>
                    <time>{item.time.toLocaleTimeString()}</time>
                    {item.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {routes.length === 0 && (
            <div className="empty-state">
              Search a starting point and destination above to see live, color-coded routes.
            </div>
          )}
        </div>
      </aside>

      <MapView
        origin={origin}
        destination={destination}
        candidateRoutes={routes}
        selectedRoute={selectedRoute}
        journeyActive={journeyActive}
        journeyProgress={journeyProgress}
        hoveredRouteId={hoveredRouteId}
      />

      <AlertToast
        alert={activeAlert}
        alternatives={rerouteOptions}
        onClose={dismissAlert}
        onChooseRoute={chooseRerouteOption}
        onPreviewRoute={previewRoute}
        onClearPreview={clearRoutePreview}
      />
      </div>
    </div>
  );
}
