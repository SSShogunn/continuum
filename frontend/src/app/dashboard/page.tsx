"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MemoryEntry {
  name: string;
  type: string;
  description: string;
  content: string;
  created_at?: string;
  updated_at: string;
  archived_at?: string | null;
}

interface TokenMeta {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export default function DashboardPage() {
  const { workspace, setWorkspaces } = useWorkspace();
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadedWorkspace, setLoadedWorkspace] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loading = loadedWorkspace !== workspace;

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
        setLoadedWorkspace(workspace);
      });
  }, [workspace, setWorkspaces]);

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

  function exportMemory() {
    const payload = {
      format: "continuum-memory-export",
      version: "1",
      exported_at: new Date().toISOString(),
      workspace,
      memories: memory,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `continuum-memory-${workspace}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMessage(null);
    try {
      const parsed = JSON.parse(await file.text());
      const memories = Array.isArray(parsed) ? parsed : parsed.memories;
      if (!Array.isArray(memories)) {
        throw new Error("Expected a JSON array of memories, or an object with a 'memories' array.");
      }
      const res = await fetch(`/api/memory/import?workspace=${encodeURIComponent(workspace)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memories }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Import failed");
      const skippedCount = data.skipped?.length ?? 0;
      setImportMessage(
        `Imported ${data.imported} entr${data.imported === 1 ? "y" : "ies"}.` +
          (skippedCount ? ` Skipped ${skippedCount}.` : "")
      );
      const refreshed = await fetch(`/api/memory?workspace=${encodeURIComponent(workspace)}`).then((r) => r.json());
      setMemory(refreshed.entries ?? []);
    } catch (err) {
      setImportMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
    <>
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
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? "Importing…" : "Import"}
              </Button>
              <Button variant="outline" size="sm" onClick={exportMemory} disabled={memory.length === 0}>
                Export
              </Button>
            </div>
          </div>
          {importMessage && (
            <p className="text-xs text-muted-foreground mb-3">{importMessage}</p>
          )}

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
              Delete &quot;{pendingDelete}&quot;? This also removes its graph edges.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
