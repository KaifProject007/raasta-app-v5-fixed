import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="brand-mark">
          <span className="brand-dot" />
          RAASTA
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {user ? (
            <Link to="/modes" className="btn btn-primary">Open dashboard</Link>
          ) : (
            <>
              <Link to="/auth" className="btn btn-ghost">Log in</Link>
              <Link to="/auth?tab=signup" className="btn btn-primary">Get started</Link>
            </>
          )}
        </div>
      </nav>

      <section className="landing-hero">
        <div className="hero-copy">
          <span className="eyebrow">Real-time adaptive traffic system</span>
          <h1>
            Every road tells you<br />
            <span className="accent">how it's flowing.</span>
          </h1>
          <p className="lede">
            RAASTA turns every route into a living thread — green where it's
            clear, amber where it's slowing, red where it's jammed — and
            warns the traffic behind you before it arrives. Built for daily
            commutes and life-saving emergency corridors alike.
          </p>
          <div className="hero-actions">
            <Link to="/auth?tab=signup" className="btn btn-primary">
              Create free account
            </Link>
            <Link to="/auth" className="btn btn-ghost">
              I already have an account
            </Link>
          </div>
          <div className="hero-stats">
            <div className="stat">
              <b>3</b>
              <span>route options per trip</span>
            </div>
            <div className="stat">
              <b>4s</b>
              <span>traffic refresh cycle</span>
            </div>
            <div className="stat">
              <b>&lt;300m</b>
              <span>jam-ahead alert radius</span>
            </div>
          </div>
        </div>

        <div className="thread-stage" aria-hidden="true">
          <svg viewBox="0 0 400 400">
            <circle className="thread-node n1" cx="60" cy="330" r="8" fill="#2E5AAC" />
            <circle className="thread-node n2" cx="340" cy="70" r="8" fill="#E23D3D" />

            <path
              className="thread-path delay-1"
              d="M 60 330 C 120 300, 140 250, 150 210"
              stroke="#1FAE6B"
            />
            <path
              className="thread-path delay-2"
              d="M 150 210 C 165 175, 190 165, 220 150"
              stroke="#F5A623"
            />
            <path
              className="thread-path delay-3"
              d="M 220 150 C 260 130, 300 100, 340 70"
              stroke="#E23D3D"
            />

            <path
              d="M 60 330 C 140 320, 220 260, 260 190 S 320 100, 340 70"
              stroke="#e2e8f1"
              strokeWidth="14"
              fill="none"
              opacity="0.5"
              strokeLinecap="round"
            />
          </svg>
          <div className="thread-caption">
            <span>PUNE &rarr; VIMAN NAGAR</span>
            <b>ETA 14 MIN &middot; 1 JAM AHEAD</b>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        RAASTA — Smart, Safe & Adaptive India. Map data from OpenStreetMap contributors, routing computed locally with A*.
      </footer>
    </div>
  );
}
