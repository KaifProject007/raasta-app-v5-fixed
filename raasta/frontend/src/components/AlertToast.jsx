import { useEffect, useState } from "react";

const LEVEL_COLOR = { clear: "#1FAE6B", moderate: "#F5A623", heavy: "#E23D3D", blocked: "#7A1010" };
const RING_CIRCUMFERENCE = 2 * Math.PI * 15; // r=15, matches the SVG below

export default function AlertToast({ alert, alternatives = [], onClose, onChooseRoute, onPreviewRoute, onClearPreview }) {
  // Countdown to auto-continue on the current route, so the popup can't sit
  // open and block the drive indefinitely - it gives a real decision window
  // (alert.deadline) instead of demanding an immediate tap.
  const [remainingMs, setRemainingMs] = useState(alert?.deadline ? alert.deadline - Date.now() : 0);

  useEffect(() => {
    if (!alert?.deadline) return;
    const tick = () => {
      const left = alert.deadline - Date.now();
      setRemainingMs(left);
      if (left <= 0) onClose();
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.deadline]);

  if (!alert) return null;

  const totalMs = 10000;
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  const dashOffset = RING_CIRCUMFERENCE * (1 - Math.max(0, remainingMs) / totalMs);

  return (
    <div className="alert-toast">
      <div className="icon">!</div>
      <div style={{ flex: 1 }}>
        <div className="title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>{alert.title || "Traffic jam detected ahead"}</span>
          {alert.deadline && (
            <span className="countdown-ring" title="Time left to choose before we keep you on the current route">
              <svg width="30" height="30" viewBox="0 0 34 34">
                <circle cx="17" cy="17" r="15" fill="none" stroke="#e6e9ef" strokeWidth="3" />
                <circle
                  cx="17" cy="17" r="15" fill="none" stroke="#2E5AAC" strokeWidth="3"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  transform="rotate(-90 17 17)"
                />
              </svg>
              <span className="countdown-num">{secondsLeft}</span>
            </span>
          )}
        </div>
        <div className="body">
          {alert.message}

          {alternatives.length > 0 ? (
            <>
              <div style={{ marginTop: 10, fontWeight: 600, color: "var(--ink)" }}>
                Choose a different route to continue on:
              </div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {alternatives.map((r) => (
                  <button
                    key={r.routeId}
                    className="btn btn-ghost"
                    style={{
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      fontSize: "0.8rem",
                      width: "100%",
                    }}
                    onClick={() => onChooseRoute(r)}
                    onMouseEnter={() => onPreviewRoute?.(r)}
                    onMouseLeave={() => onClearPreview?.()}
                    onFocus={() => onPreviewRoute?.(r)}
                    onBlur={() => onClearPreview?.()}
                  >
                    <span>{r.label}</span>
                    <span style={{ color: LEVEL_COLOR[r.overallLevel], fontWeight: 700, textTransform: "uppercase", fontSize: "0.7rem" }}>
                      {r.overallLevel}
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="btn btn-ghost"
                style={{ padding: "7px 14px", fontSize: "0.8rem", marginTop: 8 }}
                onClick={onClose}
              >
                Stay on this route
              </button>
            </>
          ) : (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost" style={{ padding: "7px 14px", fontSize: "0.8rem" }} onClick={onClose}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
      <button className="close" onClick={onClose} aria-label="Close alert">×</button>
    </div>
  );
}
