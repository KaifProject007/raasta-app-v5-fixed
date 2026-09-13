const BASE = "/api";

function authHeaders() {
  const token = localStorage.getItem("raasta_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data;
}

export const api = {
  signup: (payload) =>
    fetch(`${BASE}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(handle),

  login: (payload) =>
    fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(handle),

  me: () => fetch(`${BASE}/auth/me`, { headers: authHeaders() }).then(handle),

  geocode: (q) =>
    fetch(`${BASE}/geocode?q=${encodeURIComponent(q)}`, { headers: authHeaders() }).then(handle),

  route: (payload) =>
    fetch(`${BASE}/route`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    }).then(handle),

  simulateIncident: (routeId, progress) =>
    fetch(`${BASE}/route/${routeId}/incident`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ progress }),
    }).then(handle),

  incidents: () => fetch(`${BASE}/incidents`, { headers: authHeaders() }).then(handle),

  resolveIncident: (id) =>
    fetch(`${BASE}/incidents/${id}/resolve`, { method: "POST", headers: authHeaders() }).then(handle),

  policeUnits: () => fetch(`${BASE}/police-units`, { headers: authHeaders() }).then(handle),

  cctv: () => fetch(`${BASE}/cctv`, { headers: authHeaders() }).then(handle),
};
