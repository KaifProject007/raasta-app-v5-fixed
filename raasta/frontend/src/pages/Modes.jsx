import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

const MODES = [
  {
    key: "citizen",
    to: "/app",
    icon: "🚗",
    title: "Citizen",
    subtitle: "Plan a trip, live traffic",
    body: "Search a route, see it colored live by congestion, and get rerouted the moment something changes ahead of you.",
    cta: "Open citizen view",
    className: "mode-citizen",
  },
  {
    key: "government",
    to: "/gov",
    icon: "🏛️",
    title: "Government",
    subtitle: "Control room dashboard",
    body: "Live incident feed, police unit deployment, and CCTV vehicle density across the city — everything a control room needs.",
    cta: "Open control room",
    className: "mode-government",
  },
  {
    key: "emergency",
    to: "/emergency",
    icon: "🚑",
    title: "Emergency",
    subtitle: "Ambulance & responders",
    body: "Request the fastest, safest corridor to a destination — biased away from congestion and handed off to a live map instantly.",
    cta: "Open emergency mode",
    className: "mode-emergency",
  },
];

export default function Modes() {
  const { user } = useAuth();

  return (
    <div className="modes-shell">
      <nav className="landing-nav">
        <div className="brand-mark">
          <span className="brand-dot" />
          RAASTA
        </div>
        <div className="modes-greeting">Hi, {user?.name?.split(" ")[0] || "there"} 👋</div>
      </nav>

      <div className="modes-hero">
        <span className="eyebrow">Choose your view</span>
        <h1>How are you using RAASTA today?</h1>
        <p className="lede">
          Same live road network, three different jobs to do with it.
        </p>
      </div>

      <div className="modes-grid">
        {MODES.map((m) => (
          <Link key={m.key} to={m.to} className={`mode-card ${m.className}`}>
            <div className="mode-card-icon">{m.icon}</div>
            <div className="mode-card-title">{m.title}</div>
            <div className="mode-card-subtitle">{m.subtitle}</div>
            <p className="mode-card-body">{m.body}</p>
            <span className="mode-card-cta">{m.cta} →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
