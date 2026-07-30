"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface MemoryEntry {
  name: string;
  type: string;
  description: string;
  content: string;
  updated_at: string;
}

interface GraphNode {
  id: string;
  name: string;
  type: string;
}

type Mode = "all" | "search" | "select" | "entity";

export default function ExportPage() {
  const { workspace } = useWorkspace();
  const [mode, setMode] = useState<Mode>("all");

  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [nodesLoaded, setNodesLoaded] = useState(false);

  const [query, setQuery] = useState("");
  const [entity, setEntity] = useState("");

  const [output, setOutput] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const [loadedWorkspace, setLoadedWorkspace] = useState(workspace);
  if (workspace !== loadedWorkspace) {
    setLoadedWorkspace(workspace);
    setEntriesLoaded(false);
    setNodesLoaded(false);
    setSelected(new Set());
    setOutput(null);
  }

  useEffect(() => {
    if (mode === "select" && !entriesLoaded) {
      fetch(`/api/memory?workspace=${encodeURIComponent(workspace)}`)
        .then((r) => r.json())
        .then((data) => {
          setEntries(data.entries ?? []);
          setEntriesLoaded(true);
        });
    }
    if (mode === "entity" && !nodesLoaded) {
      fetch(`/api/memory/graph?workspace=${encodeURIComponent(workspace)}`)
        .then((r) => r.json())
        .then((data) => {
          setNodes(data.nodes ?? []);
          setNodesLoaded(true);
        });
    }
  }, [mode, workspace, entriesLoaded, nodesLoaded]);

  function toggleSelected(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function generate() {
    setGenerating(true);
    setOutput(null);
    try {
      const body: Record<string, unknown> = { workspace, mode };
      if (mode === "search") body.query = query;
      if (mode === "select") body.names = Array.from(selected);
      if (mode === "entity") body.entity = entity;

      const res = await fetch("/api/memory/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setOutput(res.ok ? data.prompt : `Error ${res.status}: ${data.detail ?? JSON.stringify(data)}`);
    } catch (e) {
      setOutput(`Error: ${String(e)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function copy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canGenerate =
    mode === "all" ||
    (mode === "search" && query.trim().length > 0) ||
    (mode === "select" && selected.size > 0) ||
    (mode === "entity" && entity.trim().length > 0);

  return (
    <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h2 className="text-xl font-semibold mb-1">Export prompt</h2>
        <p className="text-muted-foreground text-sm">
          Assemble your memories and knowledge graph into a plain-text prompt you can paste into
          any AI tool, without connecting Continuum via MCP.
        </p>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="all">Full dump</TabsTrigger>
          <TabsTrigger value="search">Topic search</TabsTrigger>
          <TabsTrigger value="select">Manual selection</TabsTrigger>
          <TabsTrigger value="entity">Entity lookup</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <p className="text-sm text-muted-foreground mt-3">
            Include every memory entry in the &quot;{workspace}&quot; workspace.
          </p>
        </TabsContent>

        <TabsContent value="search">
          <Input
            className="mt-3"
            placeholder="e.g. homelab networking setup"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </TabsContent>

        <TabsContent value="select">
          <div className="mt-3 space-y-2 max-h-80 overflow-y-auto">
            {!entriesLoaded ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground text-sm">No memory entries in this workspace.</p>
            ) : (
              entries.map((e) => (
                <label
                  key={e.name}
                  className="flex items-start gap-2 px-3 py-2 rounded-md border cursor-pointer hover:bg-secondary/50"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(e.name)}
                    onChange={() => toggleSelected(e.name)}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{e.name}</span>
                      <Badge variant="secondary">{e.type}</Badge>
                    </div>
                    <p className="text-muted-foreground text-xs mt-0.5">{e.description}</p>
                  </div>
                </label>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="entity">
          <Input
            className="mt-3"
            list="entity-options"
            placeholder="e.g. freyr"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
          />
          <datalist id="entity-options">
            {nodes.map((n) => (
              <option key={n.id} value={n.name} />
            ))}
          </datalist>
        </TabsContent>
      </Tabs>

      <Button onClick={generate} disabled={!canGenerate || generating}>
        {generating ? "Generating…" : "Generate"}
      </Button>

      {output !== null && (
        <Card>
          <CardContent className="space-y-3">
            <Textarea readOnly value={output} className="min-h-64 font-mono text-xs" />
            <div className="flex items-center gap-3">
              <Button onClick={copy}>{copied ? "Copied!" : "Copy to clipboard"}</Button>
              <span className="text-muted-foreground text-xs">{output.length} characters</span>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
