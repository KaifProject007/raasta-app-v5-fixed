const LEVEL_COLOR = { clear: "#1FAE6B", moderate: "#F5A623", heavy: "#E23D3D", blocked: "#7A1010" };

function fmtDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtDuration(s) {
  const min = Math.round(s / 60);
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`;
}

export default function RouteCard({ route, selected, onSelect, onHover, onHoverEnd }) {
  return (
    <div
      className={`route-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(route)}
      onMouseEnter={() => onHover?.(route)}
      onMouseLeave={() => onHoverEnd?.()}
      onFocus={() => onHover?.(route)}
      onBlur={() => onHoverEnd?.()}
      role="button"
      tabIndex={0}
    >
      <div className="route-card-top">
        <span className="name">{route.label}</span>
        <span className="level-pill" style={{ background: LEVEL_COLOR[route.overallLevel] }}>
          {route.overallLevel}
        </span>
      </div>
      <div className="route-card-meta">
        <span>{fmtDistance(route.distanceMeters)}</span>
        <span>{fmtDuration(route.durationSeconds + route.estimatedDelaySeconds)}</span>
        {route.estimatedDelaySeconds > 0 && (
          <span style={{ color: "#E23D3D" }}>+{Math.round(route.estimatedDelaySeconds / 60)}m delay</span>
        )}
      </div>
      <div className="segment-bar">
        {route.segments.map((s) => (
          <span key={s.index} style={{ background: s.color }} title={s.message} />
        ))}
      </div>
    </div>
  );
}
