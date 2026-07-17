import { useSSEContext } from "../context/SSEContext.js";
import type { AggregateMetrics } from "../hooks/useAnalytics.js";

interface HeroBandProps {
  metrics: AggregateMetrics;
}

export function HeroBand({ metrics }: HeroBandProps): React.ReactElement {
  const { connected } = useSSEContext();
  const totalChecked = metrics.totalClaimsVerified + metrics.totalClaimsFalsified;
  // If claims exist, show real score. If sessions exist but no claims, that's a clean 100%.
  // Only show "—" if zero sessions tracked.
  const trustPct =
    totalChecked > 0
      ? Math.round(metrics.trustScore * 100)
      : metrics.totalSessions > 0
        ? 100
        : null;
  const trustColor =
    trustPct === null
      ? "var(--text-2)"
      : trustPct >= 90
        ? "var(--green)"
        : trustPct >= 70
          ? "var(--yellow)"
          : "var(--red)";

  const trustDetail =
    totalChecked > 0
      ? `${metrics.totalClaimsVerified} / ${totalChecked} claims verified`
      : metrics.totalSessions > 0
        ? "No claims to verify — clean sessions"
        : "No claims verified yet";

  return (
    <div className="hero-band">
      <div className="hero-trust">
        <div className="hero-trust-value" style={{ color: trustColor }}>
          {trustPct !== null ? `${trustPct}%` : "—"}
        </div>
        <div className="hero-trust-label">Trust Score</div>
        <div className="hero-trust-detail">{trustDetail}</div>
      </div>

      <div className="hero-divider" />

      <div className="hero-live">
        <div className="hero-live-header">
          <span className={`hero-live-dot${connected ? " connected" : ""}`} />
          <span className="hero-live-label">
            {connected ? "Live" : "Reconnecting"}
          </span>
        </div>
        <div className="hero-counters">
          <div className="hero-counter">
            <span className="hero-counter-value">{metrics.liesCaught}</span>
            <span className="hero-counter-label">Lies caught</span>
          </div>
          <div className="hero-counter">
            <span className="hero-counter-value">{metrics.totalBlocks}</span>
            <span className="hero-counter-label">Writes blocked</span>
          </div>
          <div className="hero-counter">
            <span className="hero-counter-value">{totalChecked}</span>
            <span className="hero-counter-label">Claims checked</span>
          </div>
          <div className="hero-counter">
            <span className="hero-counter-value">{metrics.totalSessions}</span>
            <span className="hero-counter-label">Sessions</span>
          </div>
        </div>
      </div>
    </div>
  );
}
