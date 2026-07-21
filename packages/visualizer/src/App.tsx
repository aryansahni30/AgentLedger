import { useMemo, useState } from "react";
import { useAnalytics } from "./hooks/useAnalytics.js";
import { useProjects } from "./context/ProjectContext.js";
import { HeroBand } from "./components/HeroBand.js";
import { TrustChart } from "./components/TrustChart.js";
import { SessionList } from "./components/SessionList.js";
import { SessionDetail } from "./components/SessionDetail.js";
import { ProjectSelector } from "./components/ProjectSelector.js";

export function App(): React.ReactElement {
  const { aggregate, sessions, trends, loading } = useAnalytics();
  const { selected } = useProjects();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // The session list and detail respond to the project filter; the aggregate
  // stats and trend chart above deliberately do not — they are cross-project.
  const visibleSessions = useMemo(
    () => (selected === null ? sessions : sessions.filter((s) => s.project === selected)),
    [sessions, selected],
  );

  const selectedSession =
    selectedRunId !== null
      ? (visibleSessions.find((s) => s.runId === selectedRunId) ?? null)
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
        <div className="app-header-spacer" />
        <ProjectSelector />
      </header>

      <main className="app-main">
        <div className="app-aggregate-label">
          Trust across all projects
          {selected !== null && (
            <span className="app-aggregate-note"> — unaffected by the “{selected}” filter</span>
          )}
        </div>
        <HeroBand metrics={aggregate} />
        <TrustChart data={trends} />

        <div className="app-content">
          <div className="app-sessions">
            <SessionList
              sessions={visibleSessions}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
              scopeLabel={selected}
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
