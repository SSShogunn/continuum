"use client";

import { createContext, useContext, useState } from "react";

interface WorkspaceContextValue {
  workspace: string;
  workspaces: string[];
  setWorkspace: (ws: string) => void;
  setWorkspaces: (workspaces: string[]) => void;
  addWorkspace: (ws: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const STORAGE_KEY = "continuum:workspace";

function readStoredWorkspace(): string {
  if (typeof window === "undefined") return "default";
  return window.localStorage.getItem(STORAGE_KEY) ?? "default";
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspaceState] = useState(readStoredWorkspace);
  const [workspaces, setWorkspaces] = useState<string[]>(["default"]);

  function setWorkspace(ws: string) {
    setWorkspaceState(ws);
    window.localStorage.setItem(STORAGE_KEY, ws);
  }

  function addWorkspace(ws: string) {
    setWorkspaces((prev) => (prev.includes(ws) ? prev : [...prev, ws]));
    setWorkspace(ws);
  }

  return (
    <WorkspaceContext.Provider
      value={{ workspace, workspaces, setWorkspace, setWorkspaces, addWorkspace }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within a WorkspaceProvider");
  return ctx;
}
