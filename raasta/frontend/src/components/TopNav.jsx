import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function TopNav({ active }) {
  const { user, logout } = useAuth();

  return (
    <div className="top-nav">
      <Link to="/modes" className="brand-mark small">
        <span className="brand-dot" />
        RAASTA
      </Link>

      <div className="top-nav-links">
        <Link to="/app" className={active === "citizen" ? "active" : ""}>
          🚗 Citizen
        </Link>
        <Link to="/gov" className={active === "government" ? "active" : ""}>
          🏛️ Government
        </Link>
        <Link to="/emergency" className={active === "emergency" ? "active" : ""}>
          🚑 Emergency
        </Link>
      </div>

      <div className="top-nav-user">
        <span className="top-nav-name">{user?.name}</span>
        <button className="logout-link" onClick={logout}>Log out</button>
      </div>
    </div>
  );
}
