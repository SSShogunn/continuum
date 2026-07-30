"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

export default function DashboardPage() {
  const { workspace, setWorkspaces } = useWorkspace();
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadedWorkspace, setLoadedWorkspace] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loading = loadedWorkspace !== workspace;

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

  return (
    <>
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <section>
          <div className="flex items-center justify-between mb-1">
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
          <Link href="/dashboard/settings?tab=tokens" className="text-muted-foreground text-xs hover:text-foreground transition-colors">
            Manage your MCP token in Settings →
          </Link>
          {importMessage && (
            <p className="text-xs text-muted-foreground mt-3">{importMessage}</p>
          )}

          <div className="mt-4">
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
          </div>
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
