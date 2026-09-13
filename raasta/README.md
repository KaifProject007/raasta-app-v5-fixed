# RAASTA — Real-time Adaptive Traffic & Safety Platform (Maharashtra)

A full local web app (React + Node.js) built from your RAASTA idea report:
sign up / log in, search a trip, see genuinely different colored "thread"
routes computed by A* search over the real Maharashtra road network, watch
live simulated traffic evolve edge-by-edge, get jam alerts with real
alternative routes to switch to, and an emergency-corridor mode for
ambulances. Runs entirely on `localhost` — nothing is deployed anywhere.

## How routing actually works now

Earlier versions of this app asked a third-party routing server for
"alternative routes" and only painted colors on top — which is why it could
return a nonsense 127km loop for a 15km trip, and why "reroute" had nothing
real to switch to. That's been replaced with a proper routing engine:

1. **Real road graph** — when you search a trip, the backend fetches the
   actual OpenStreetMap road network for the area around your two points
   from the free Overpass API, and builds it into a graph: intersections
   are nodes, road segments between them are edges (`backend/graphService.js`).
2. **Live traffic per real edge** — every one of those real road segments
   gets its own simulated, evolving congestion level (`backend/trafficEngine.js`).
   Two different routes that share the same stretch of road see the *same*
   traffic on it, because it's keyed to the real edge, not to "one route's
   10th slice."
3. **A\* search, not a black box** — `backend/pathfinder.js` runs A* (with an
   admissible straight-line/max-speed heuristic) over that graph, using
   live traffic-weighted edge costs. This is the actual "which way is
   currently fastest" decision, computed by us, not fetched pre-made.
4. **Real alternative routes** — to offer 2-3 genuinely different options
   (not the same road with a different paint job), we run A* again with
   the previous route's edges penalized, forcing it to find a materially
   different corridor. Every alternative shown is a real, drivable path
   with its own live-computed distance and ETA.
5. **AI re-planning while you drive** — every 4 seconds, for any route
   you're actively driving, the backend re-runs A* from scratch with the
   *current* live traffic. If a meaningfully better path exists (≥10%
   faster, and not just a near-duplicate of your current route), it's
   pushed to you as a `smart-reroute-suggestion` — a real, alternative,
   already-computed route, not a canned message. You choose whether to
   switch; the app never silently reroutes you.

## What's real vs. simulated (read this first)

| Piece | Service / method | Real or simulated |
|---|---|---|
| Road network (intersections, streets) | OpenStreetMap via the free Overpass API | Real |
| Map tiles + 3D buildings/terrain | [OpenFreeMap](https://openfreemap.org) (MapLibre GL, no key) | Real |
| Address search | [Photon](https://photon.komoot.io) (OSM-based autocomplete), Nominatim fallback | Real |
| Route-finding decision (A*, alternatives) | Our own `pathfinder.js`, running on the real graph | Real algorithm, run locally |
| **Live traffic congestion per road** | RAASTA's own simulation (`trafficEngine.js`) | **Simulated** |
| Jam alerts / "faster path found" | Triggered by real A* comparisons against simulated traffic | Real decision logic, simulated inputs |

There is no free, key-less source of real live traffic anywhere (Google,
TomTom, HERE all require a paid account). Everything *around* that number —
the road graph, the pathfinding, the alternative-route search, the
re-planning — is real and runs locally. If you later get a paid traffic
data key, you only need to change `liveEdgeCostSeconds()` in
`trafficEngine.js` to pull a real number instead of a simulated one; the
graph, A*, and alternative-route logic don't need to change at all.

## Three modes: Citizen, Government, Emergency

After logging in you land on **`/modes`** — "Choose your view" — and pick one
of three real, separate experiences that all share the same live backend:

- **🚗 Citizen** (`/app`) — the trip planner described above, now with a
  **"🚧 Simulate incident ahead"** button while a journey is active. This
  doesn't play a scripted animation — it calls
  `POST /api/route/:routeId/incident`, which picks a real, un-blocked OSM
  edge somewhere ahead of your simulated position, pins it to a
  near-impassable cost in `trafficEngine.js`, and dispatches the nearest
  available police unit. The existing live-tracking loop picks the block up
  on its very next tick (or immediately, via a forced refresh) and genuinely
  A\*-reroutes around it — the same "AI suggested route" mechanism used for
  ordinary congestion, just triggered by a real blocked edge instead of a
  random traffic score.
- **🏛️ Government** (`/gov`) — a control-room dashboard polling the backend
  every 5 seconds: live KPIs (active incidents, units available, cameras
  showing heavy traffic), an incident feed with a dispatch recommendation
  per incident and a "mark as cleared" action, the police unit roster with
  live availability, and a CCTV grid with deterministic simulated vehicle
  counts per camera.
- **🚑 Emergency** (`/emergency`) — a dedicated dispatch screen (pickup,
  destination, vehicle type) that hands off straight into the citizen map
  with emergency-mode routing pre-selected and the search already run.

## How the incident engine works

`backend/incidentEngine.js` is a small registry keyed by real OSM edge:
`triggerIncident`, `resolveIncident`, `getActiveIncidents`/`getAllIncidents`,
`isEdgeBlocked`. `trafficEngine.edgeState()` checks this registry before
generating a simulated reading, so a blocked edge reports a `"blocked"`
level (60x cost multiplier) instead of a random congestion score, for
*every* consumer of that edge — any route or tracked journey sharing that
stretch of road sees the same block. `backend/policeUnits.js` and
`backend/cctv.js` are fixed, believable rosters (not tied to any real data
source) that the incident flow and Government dashboard read from.



Fetching and searching a road graph for the whole country on every request
would be enormous and slow. `backend/geo.js` hard-codes Maharashtra's
bounding box: trips outside it are rejected server-side, address search is
filtered to results inside it, and the map itself can't be panned/zoomed
out of it (`maxBounds` in `MapView.jsx`). To cover a different state or
region, change `MAHARASHTRA_BBOX` in `backend/geo.js` and the matching
`MAHARASHTRA_BOUNDS` in `frontend/src/components/MapView.jsx`.

## Architecture

```
raasta-app/
├── backend/     Node.js + Express + Socket.io
│   ├── server.js          API routes + the live A*-replanning loop
│   ├── geo.js              Maharashtra bounding box + geo helpers + seededRandom
│   ├── graphService.js     Fetches & caches the real road graph (Overpass)
│   ├── pathfinder.js       A* search + alternative-route generation
│   ├── trafficEngine.js    Live per-road-edge traffic simulation + incident-aware "blocked" level
│   ├── incidentEngine.js   Real OSM-edge incident registry (trigger/resolve/list)
│   ├── policeUnits.js      Fixed patrol roster + nearest-available dispatch
│   ├── cctv.js             Fixed CCTV camera list + simulated live vehicle counts
│   ├── auth.js             JWT auth helpers
│   └── db.js               Tiny local JSON "database" (lowdb) for accounts
└── frontend/    React (Vite) + MapLibre GL
    ├── src/pages/Landing.jsx        Marketing/landing page (animated hero)
    ├── src/pages/Auth.jsx           Login / signup
    ├── src/pages/Modes.jsx          "Choose your view" mode-switcher
    ├── src/pages/Dashboard.jsx      Citizen mode: search, routes, live tracking
    ├── src/components/MapView.jsx        3D/2D map, colored route threads
    ├── src/components/TopNav.jsx         Shared nav across all three modes
    ├── src/components/GovernmentPanel.jsx  Control-room dashboard
    └── src/components/EmergencyPanel.jsx   Emergency dispatch screen
```

Nothing is written to disk except a local `backend/data/db.json` file
holding the accounts you create (passwords are hashed with bcrypt — never
stored in plain text).

## Requirements

- [Node.js](https://nodejs.org) 18 or newer (includes `npm`)
- An internet connection (the free map/road-graph/geocoding services above
  are fetched live — only the traffic layer is simulated locally)

## Setup — first time only

Open two terminals.

**Terminal 1 — backend**
```bash
cd raasta-app/backend
npm install
npm start
```
You should see `RAASTA backend running on http://localhost:4000`.

**Terminal 2 — frontend**
```bash
cd raasta-app/frontend
npm install
npm run dev
```
Vite will print a local URL — open **http://localhost:5173** in your
browser.

## Using it

1. You land on the marketing page — nothing about the app is shown until
   you sign up.
2. Create a free account (name, email, any password 6+ characters) or log
   in if you already made one. Accounts are stored only on your machine.
3. In the dashboard, type a starting point and destination — search is
   restricted to locations inside Maharashtra (that's a deliberate scope
   decision, see "Why Maharashtra only" above).
4. Click **Find routes** to see 2-3 genuinely different, real, drivable
   route options — each computed by A* search, each with its own live
   color-coded traffic, distance in km, and ETA.
5. Toggle **3D view / Top view** with the buttons on the map.
6. Click **Start journey** to simulate driving the route. Every 4 seconds
   the backend re-checks live traffic on every real road edge on your
   route and re-runs A* to see if a better path exists elsewhere. If a
   stretch turns red, you'll get an alert — and if a meaningfully faster
   route is available, it's offered to you by name so you can tap to
   switch to it (the app itself never silently reroutes you).
7. Flip on **🚑 Emergency corridor** before searching to get an
   ambulance-style route: it's biased toward the clearest stretches, drawn
   as a thicker dashed corridor on the map, and labeled "Emergency
   corridor" in the route list.
8. While a journey is active, click **🚧 Simulate incident ahead** to block
   a real road edge ahead of you — watch the alert fire, a police unit get
   dispatched, and the app genuinely reroute around it.
9. Open **🏛️ Government** from the top nav (in a second tab is fine) to
   watch that same incident show up live in the control-room dashboard,
   with a recommended action and a "mark as cleared" button.
10. Try **🚑 Emergency** from the top nav for a dedicated dispatch form that
    hands off straight into a live emergency-mode map.

## Notes & honest limitations

- **First search in a new area takes a few seconds** — the backend is
  fetching real OpenStreetMap road data for that area from Overpass and
  building a graph out of it. It's cached in memory for 15 minutes, so
  searching nearby again is instant.
- The public Overpass API is free but shared and rate-limited — avoid
  firing off many searches back-to-back. If you see a routing error
  mentioning Overpass, wait a few seconds and try again.
- Road directions (one-way streets) are respected where OpenStreetMap has
  that tagged; a small number of roads may be missing that tag upstream.
- "Vehicles behind you" is simulated as a broadcast to everyone currently
  tracking the same route (open the dashboard in a second browser tab,
  start the same route in both, and you'll see both tabs get the same jam
  alert and the same AI-suggested alternative at the same moment).
- This is a local development build (`npm run dev` / `npm start`) — it is
  intentionally **not** configured for deployment, per your request.
