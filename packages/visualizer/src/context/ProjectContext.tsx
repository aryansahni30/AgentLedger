import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ApiResponse, ProjectSummary } from "../types.js";
import { useSSE } from "../hooks/useSSE.js";

/** Sentinel for the unfiltered "All Projects" view. */
export const ALL_PROJECTS = null;

interface ProjectContextValue {
  projects: ProjectSummary[];
  /** null = All Projects; otherwise a project name (basename) */
  selected: string | null;
  setSelected: (name: string | null) => void;
  /** roll-up: true only when every project's chain verifies */
  allChainsValid: boolean;
  /** projects whose chain failed to verify — named in the badge */
  invalidChains: ProjectSummary[];
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "agentledger.selectedProject";

function loadSelected(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ProjectProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selected, setSelectedState] = useState<string | null>(loadSelected);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchProjects = useCallback(() => {
    fetch("/api/projects")
      .then((r) => r.json() as Promise<ApiResponse<ProjectSummary[]>>)
      .then((body) => {
        if (body.success) setProjects(body.data);
      })
      .catch(() => {
        // keep last-known list on network failure
      });
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // A new project's first event arrives over SSE before the next poll; refetch
  // (debounced) so it appears in the selector without a reload.
  useSSE(() => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchProjects, 500);
  });

  // Cancel a pending refetch on unmount so it cannot fire into a dead component.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, []);

  const setSelected = useCallback((name: string | null) => {
    setSelectedState(name);
    try {
      if (name === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // storage disabled — selection still works for this session
    }
  }, []);

  // A remembered selection can name a project that no longer reports in; fall
  // back to All Projects rather than showing an empty, confusing list.
  useEffect(() => {
    if (selected !== null && projects.length > 0 && !projects.some((p) => p.name === selected)) {
      setSelected(null);
    }
  }, [selected, projects, setSelected]);

  const value = useMemo<ProjectContextValue>(() => {
    const invalidChains = projects.filter((p) => !p.chainValid);
    return {
      projects,
      selected,
      setSelected,
      allChainsValid: invalidChains.length === 0,
      invalidChains,
    };
  }, [projects, selected, setSelected]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjects(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (ctx === null) throw new Error("useProjects must be used within a ProjectProvider");
  return ctx;
}
