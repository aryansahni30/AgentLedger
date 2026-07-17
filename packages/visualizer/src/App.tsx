import { useState } from "react";
import { useAnalytics } from "./hooks/useAnalytics.js";
import { HeroBand } from "./components/HeroBand.js";
import { TrustChart } from "./components/TrustChart.js";
import { SessionList } from "./components/SessionList.js";
import { SessionDetail } from "./components/SessionDetail.js";

export function App(): React.ReactElement {
  const { aggregate, sessions, trends, loading } = useAnalytics();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const selectedSession =
    selectedRunId !== null
      ? (sessions.find((s) => s.runId === selectedRunId) ?? null)
      : null;

  if (loading && sessions.length === 0) {
    return (
      <div className="app-loading">
        <div className="app-loading-text">Loading AgentLedger…</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-logo">AgentLedger</h1>
        <span className="app-tagline">Trust Layer</span>
      </header>

      <main className="app-main">
        <HeroBand metrics={aggregate} />
        <TrustChart data={trends} />

        <div className="app-content">
          <div className="app-sessions">
            <SessionList
              sessions={sessions}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
            />
          </div>
          <div className="app-detail">
            <SessionDetail session={selectedSession} />
          </div>
        </div>
      </main>
    </div>
  );
}
