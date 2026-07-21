import { useProjects } from "../context/ProjectContext.js";

/**
 * Top-nav project selector. Scopes the session list and detail to one project;
 * the aggregate stats above stay cross-project regardless of what is picked.
 *
 * The chain badge beside it is a roll-up of every project's per-ledger chain
 * verdict — chains cannot be merged, so "all valid" means each verified and a
 * failure names the offenders.
 */
export function ProjectSelector(): React.ReactElement {
  const { projects, selected, setSelected, allChainsValid, invalidChains } = useProjects();

  return (
    <div className="project-selector">
      <label className="project-selector-label" htmlFor="project-select">
        Project
      </label>
      <select
        id="project-select"
        className="project-selector-dropdown"
        value={selected ?? ""}
        onChange={(e) => setSelected(e.target.value === "" ? null : e.target.value)}
      >
        <option value="">All Projects</option>
        {projects.map((p) => (
          <option key={p.path} value={p.name}>
            {p.name} ({p.sessionCount})
          </option>
        ))}
      </select>

      {projects.length > 0 && (
        <span
          className={`chain-badge${allChainsValid ? " valid" : " invalid"}`}
          title={
            allChainsValid
              ? "Every project's hash chain verifies"
              : `Chain broken in: ${invalidChains.map((p) => p.name).join(", ")}`
          }
        >
          {allChainsValid
            ? "✓ chains valid"
            : `⚠ ${invalidChains.length} of ${projects.length} chains invalid`}
        </span>
      )}
    </div>
  );
}
