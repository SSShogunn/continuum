"use client";

import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";

interface Fact {
  content: string;
  valid_from: string;
}

interface Entity {
  entity_display: string;
  entity_type: string;
  relation: string;
}

interface MemoryEntry {
  name: string;
  type: string;
  description: string;
  content: string;
  updated_at: string;
  facts: Fact[];
  entities: Entity[];
}

interface TokenMeta {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: "bg-blue-900/40 text-blue-300",
  org: "bg-purple-900/40 text-purple-300",
  place: "bg-green-900/40 text-green-300",
  date: "bg-orange-900/40 text-orange-300",
  concept: "bg-pink-900/40 text-pink-300",
  project: "bg-cyan-900/40 text-cyan-300",
};

export default function DashboardPage() {
  const [workspace, setWorkspace] = useState("default");
  const [workspaces, setWorkspaces] = useState<string[]>(["default"]);
  const [newWorkspace, setNewWorkspace] = useState("");
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then(setTokens);
  }, []);

  useEffect(() => {
    fetch(`/api/memory?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((data) => {
        setMemory(data.entries ?? []);
        setWorkspaces(data.workspaces ?? ["default"]);
        setLoading(false);
      });
  }, [workspace]);

  function toggleExpanded(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function deleteMemory(name: string) {
    if (!window.confirm(`Delete memory "${name}"? This also removes its extracted facts and graph entities.`)) {
      return;
    }
    const res = await fetch(`/api/memory/${encodeURIComponent(name)}?workspace=${encodeURIComponent(workspace)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setMemory((prev) => prev.filter((e) => e.name !== name));
    }
  }

  function switchWorkspace(ws: string) {
    setLoading(true);
    setWorkspace(ws);
  }

  function switchToNewWorkspace() {
    const ws = newWorkspace.trim();
    if (!ws) return;
    if (!workspaces.includes(ws)) setWorkspaces((prev) => [...prev, ws]);
    switchWorkspace(ws);
    setNewWorkspace("");
  }

  async function mintToken() {
    setMinting(true);
    setMintError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "default" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMintError(`Error ${res.status}: ${data.detail ?? JSON.stringify(data)}`);
        return;
      }
      setNewToken(data.token);
      setTokens((prev) =>
        ([{ id: data.id, label: data.label, createdAt: data.createdAt, revokedAt: null, lastUsedAt: null }] as TokenMeta[]).concat(
          prev.map((t) => ({ ...t, revokedAt: t.revokedAt ?? new Date().toISOString() }))
        )
      );
    } catch (e) {
      setMintError(String(e));
    } finally {
      setMinting(false);
    }
  }

  async function copy() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const activeToken = tokens.find((t) => !t.revokedAt);

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="font-semibold text-lg">Continuum</span>
        <UserButton />
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-12">
        {/* MCP Token */}
        <section>
          <h2 className="text-xl font-semibold mb-4">MCP Token</h2>
          {newToken ? (
            <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 space-y-3">
              <p className="text-yellow-300 text-sm font-medium">
                Copy this token now — it will not be shown again.
              </p>
              <code className="block text-xs break-all text-gray-200 bg-gray-900 rounded p-3 font-mono">
                {newToken}
              </code>
              <button
                onClick={copy}
                className="px-4 py-2 rounded bg-yellow-600 hover:bg-yellow-500 text-sm font-medium transition-colors"
              >
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
            </div>
          ) : (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
              {activeToken ? (
                <p className="text-sm text-gray-400">
                  Active token: <span className="text-gray-200">{activeToken.label}</span>{" "}
                  — created {new Date(activeToken.createdAt).toLocaleDateString()}
                </p>
              ) : (
                <p className="text-sm text-gray-400">No active token. Generate one to use Continuum with MCP clients.</p>
              )}
              <button
                onClick={mintToken}
                disabled={minting}
                className="px-4 py-2 rounded bg-white text-gray-950 text-sm font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {minting ? "Generating…" : activeToken ? "Rotate token" : "Generate token"}
              </button>
              {mintError && (
                <p className="text-red-400 text-xs mt-2 font-mono">{mintError}</p>
              )}
            </div>
          )}
        </section>

        {/* Memory */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Memory</h2>
            <div className="flex items-center gap-2">
              <select
                value={workspace}
                onChange={(e) => switchWorkspace(e.target.value)}
                className="bg-gray-900 border border-gray-800 rounded text-sm px-2 py-1.5"
              >
                {workspaces.map((ws) => (
                  <option key={ws} value={ws}>
                    {ws}
                  </option>
                ))}
              </select>
              <input
                value={newWorkspace}
                onChange={(e) => setNewWorkspace(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && switchToNewWorkspace()}
                placeholder="new workspace…"
                className="bg-gray-900 border border-gray-800 rounded text-sm px-2 py-1.5 w-32 placeholder:text-gray-600"
              />
              <button
                onClick={switchToNewWorkspace}
                className="px-2 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm transition-colors"
              >
                Go
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : memory.length === 0 ? (
            <p className="text-gray-500 text-sm">
              No memory entries in &quot;{workspace}&quot; yet. Use your MCP token with an AI client to create some.
            </p>
          ) : (
            <ul className="space-y-2">
              {memory.map((e) => {
                const isOpen = expanded.has(e.name);
                return (
                  <li key={e.name} className="bg-gray-900 border border-gray-800 rounded-lg">
                    <button
                      onClick={() => toggleExpanded(e.name)}
                      className="w-full text-left px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{e.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">{e.type}</span>
                          <span className="text-gray-600 text-xs">{isOpen ? "▾" : "▸"}</span>
                        </div>
                      </div>
                      <p className="text-gray-400 text-xs mt-1">{e.description}</p>
                      <p className="text-gray-600 text-xs mt-1">Updated {new Date(e.updated_at).toLocaleString()}</p>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 space-y-4 border-t border-gray-800 pt-3">
                        <div>
                          <h3 className="text-xs font-medium text-gray-500 uppercase mb-1">Content</h3>
                          <p className="text-sm text-gray-300 whitespace-pre-wrap">{e.content}</p>
                        </div>

                        {e.facts.length > 0 && (
                          <div>
                            <h3 className="text-xs font-medium text-gray-500 uppercase mb-1">Facts</h3>
                            <ul className="list-disc list-inside space-y-1">
                              {e.facts.map((f, i) => (
                                <li key={i} className="text-sm text-gray-300">
                                  {f.content}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {e.entities.length > 0 && (
                          <div>
                            <h3 className="text-xs font-medium text-gray-500 uppercase mb-1">Entities</h3>
                            <div className="flex flex-wrap gap-1.5">
                              {e.entities.map((ent, i) => (
                                <span
                                  key={i}
                                  title={ent.relation}
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    ENTITY_TYPE_COLORS[ent.entity_type] ?? "bg-gray-800 text-gray-300"
                                  }`}
                                >
                                  {ent.entity_display}
                                  <span className="opacity-60"> · {ent.entity_type}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => deleteMemory(e.name)}
                          className="text-xs px-3 py-1.5 rounded bg-red-950 hover:bg-red-900 text-red-300 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
