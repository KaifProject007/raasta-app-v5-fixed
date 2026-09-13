import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Auth() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "signup" ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, signup } = useAuth();
  const navigate = useNavigate();

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (tab === "signup") {
        await signup(name, email, password);
      } else {
        await login(email, password);
      }
      navigate("/modes");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="brand-mark" style={{ marginBottom: 24 }}>
          <span className="brand-dot" />
          RAASTA
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === "login" ? "active" : ""}`}
            onClick={() => setTab("login")}
            type="button"
          >
            Log in
          </button>
          <button
            className={`auth-tab ${tab === "signup" ? "active" : ""}`}
            onClick={() => setTab("signup")}
            type="button"
          >
            Sign up
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={onSubmit}>
          {tab === "signup" && (
            <div className="field">
              <label htmlFor="name">Full name</label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Aarav Sharma"
                required
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              minLength={6}
              required
            />
          </div>
          <button className="btn btn-primary btn-block" disabled={loading} type="submit">
            {loading ? "Please wait…" : tab === "signup" ? "Create account" : "Log in"}
          </button>
        </form>

        <div className="auth-switch">
          {tab === "signup" ? (
            <>Already have an account? <button onClick={() => setTab("login")}>Log in</button></>
          ) : (
            <>New to RAASTA? <button onClick={() => setTab("signup")}>Create one</button></>
          )}
        </div>
      </div>
    </div>
  );
}
