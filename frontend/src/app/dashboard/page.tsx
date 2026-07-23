"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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

  async function confirmDelete() {
    if (!pendingDelete) return;
    const name = pendingDelete;
    setPendingDelete(null);
    const res = await fetch(`/api/memory/${encodeURIComponent(name)}?workspace=${encodeURIComponent(workspace)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setMemory((prev) => prev.filter((e) => e.name !== name));
    }
  }

  function switchWorkspace(ws: string | null) {
    if (!ws) return;
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
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-lg">Continuum</span>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/dashboard" className="text-foreground">Memory</Link>
            <Link href="/dashboard/memory-graph" className="hover:text-foreground transition-colors">Graph</Link>
            <Link href="/dashboard/playground" className="hover:text-foreground transition-colors">Playground</Link>
          </nav>
        </div>
        <UserButton />
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-12">
        {/* MCP Token */}
        <section>
          <h2 className="text-xl font-semibold mb-4">MCP Token</h2>
          {newToken ? (
            <Card className="border-yellow-700 bg-yellow-900/20">
              <CardContent className="space-y-3">
                <p className="text-yellow-300 text-sm font-medium">
                  Copy this token now — it will not be shown again.
                </p>
                <code className="block text-xs break-all bg-black/30 rounded p-3 font-mono">
                  {newToken}
                </code>
                <Button onClick={copy} className="bg-yellow-600 hover:bg-yellow-500 text-white">
                  {copied ? "Copied!" : "Copy to clipboard"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-3">
                {activeToken ? (
                  <p className="text-sm text-muted-foreground">
                    Active token: <span className="text-foreground">{activeToken.label}</span>{" "}
                    — created {new Date(activeToken.createdAt).toLocaleDateString()}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No active token. Generate one to use Continuum with MCP clients.</p>
                )}
                <Button onClick={mintToken} disabled={minting}>
                  {minting ? "Generating…" : activeToken ? "Rotate token" : "Generate token"}
                </Button>
                {mintError && (
                  <p className="text-destructive text-xs mt-2 font-mono">{mintError}</p>
                )}
              </CardContent>
            </Card>
          )}
        </section>

        {/* Memory */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Memory</h2>
            <div className="flex items-center gap-2">
              <Select value={workspace} onValueChange={switchWorkspace}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws} value={ws}>
                      {ws}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={newWorkspace}
                onChange={(e) => setNewWorkspace(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && switchToNewWorkspace()}
                placeholder="new workspace…"
                className="w-32"
              />
              <Button variant="secondary" onClick={switchToNewWorkspace}>
                Go
              </Button>
            </div>
          </div>

          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : memory.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No memory entries in &quot;{workspace}&quot; yet. Use your MCP token with an AI client to create some.
            </p>
          ) : (
            <div className="space-y-2">
              {memory.map((e) => {
                const isOpen = expanded.has(e.name);
                return (
                  <Card key={e.name} className="py-0 overflow-hidden">
                    <button
                      onClick={() => toggleExpanded(e.name)}
                      className="w-full text-left px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">{e.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{e.type}</Badge>
                          <span className="text-muted-foreground text-xs">{isOpen ? "▾" : "▸"}</span>
                        </div>
                      </div>
                      <p className="text-muted-foreground text-xs mt-1">{e.description}</p>
                      <p className="text-muted-foreground/70 text-xs mt-1">Updated {new Date(e.updated_at).toLocaleString()}</p>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 space-y-4 border-t pt-3">
                        <div>
                          <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">Content</h3>
                          <p className="text-sm whitespace-pre-wrap">{e.content}</p>
                        </div>

                        {e.facts.length > 0 && (
                          <div>
                            <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">Facts</h3>
                            <ul className="list-disc list-inside space-y-1">
                              {e.facts.map((f, i) => (
                                <li key={i} className="text-sm">
                                  {f.content}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {e.entities.length > 0 && (
                          <div>
                            <h3 className="text-xs font-medium text-muted-foreground uppercase mb-1">Entities</h3>
                            <div className="flex flex-wrap gap-1.5">
                              {e.entities.map((ent, i) => (
                                <span
                                  key={i}
                                  title={ent.relation}
                                  className={`text-xs px-2 py-0.5 rounded ${
                                    ENTITY_TYPE_COLORS[ent.entity_type] ?? "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {ent.entity_display}
                                  <span className="opacity-60"> · {ent.entity_type}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setPendingDelete(e.name)}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete memory?</DialogTitle>
            <DialogDescription>
              Delete &quot;{pendingDelete}&quot;? This also removes its extracted facts and graph entities.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
