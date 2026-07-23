"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import type { GraphNode as ReaGraphNode, GraphEdge as ReaGraphEdge } from "reagraph";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const GraphCanvas = dynamic(() => import("reagraph").then((m) => m.GraphCanvas), { ssr: false });

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

interface NodeData {
  kind: "memory" | "entity";
  typeKey: string;
  memory?: MemoryEntry;
  connections: { name: string; relation: string }[];
}

const MEMORY_TYPE_COLORS: Record<string, string> = {
  project: "#22d3ee",
  preference: "#a78bfa",
  user: "#facc15",
  reference: "#34d399",
};

const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: "#60a5fa",
  org: "#c084fc",
  place: "#4ade80",
  date: "#fb923c",
  concept: "#f472b6",
  project: "#22d3ee",
};

const DEFAULT_COLOR = "#9ca3af";

function buildGraph(memory: MemoryEntry[]): { nodes: ReaGraphNode[]; edges: ReaGraphEdge[] } {
  const nodeMap = new Map<string, ReaGraphNode>();
  const degree = new Map<string, number>();
  const edges: ReaGraphEdge[] = [];

  const seenEdges = new Set<string>();

  for (const m of memory) {
    const memId = `mem:${m.name}`;
    if (!nodeMap.has(memId)) {
      nodeMap.set(memId, {
        id: memId,
        label: m.name,
        fill: MEMORY_TYPE_COLORS[m.type] ?? DEFAULT_COLOR,
        data: { kind: "memory", typeKey: m.type, memory: m, connections: [] } as NodeData,
      });
    }
    for (const ent of m.entities) {
      const entId = `ent:${ent.entity_display}|${ent.entity_type}`;
      let entNode = nodeMap.get(entId);
      if (!entNode) {
        entNode = {
          id: entId,
          label: ent.entity_display,
          fill: ENTITY_TYPE_COLORS[ent.entity_type] ?? DEFAULT_COLOR,
          data: { kind: "entity", typeKey: ent.entity_type, connections: [] } as NodeData,
        };
        nodeMap.set(entId, entNode);
      }
      (entNode.data as NodeData).connections.push({ name: m.name, relation: ent.relation });

      const edgeId = `${memId}->${entId}`;
      if (seenEdges.has(edgeId)) continue;
      seenEdges.add(edgeId);

      degree.set(memId, (degree.get(memId) ?? 0) + 1);
      degree.set(entId, (degree.get(entId) ?? 0) + 1);
      edges.push({
        id: edgeId,
        source: memId,
        target: entId,
        label: ent.relation,
      });
    }
  }

  const nodes = Array.from(nodeMap.values()).map((n) => {
    const d = degree.get(n.id) ?? 0;
    const isMemory = (n.data as NodeData).kind === "memory";
    return { ...n, size: isMemory ? 8 + Math.min(d * 2.5, 20) : 5 + Math.min(d * 1.5, 12) };
  });

  return { nodes, edges };
}

export default function MemoryGraphPage() {
  const [workspace, setWorkspace] = useState("default");
  const [workspaces, setWorkspaces] = useState<string[]>(["default"]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [selected, setSelected] = useState<{ label: string; data: NodeData } | null>(null);

  useEffect(() => {
    fetch(`/api/memory?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((data) => {
        setMemory(data.entries ?? []);
        setWorkspaces(data.workspaces ?? ["default"]);
        setSelected(null);
      });
  }, [workspace]);

  const { nodes, edges } = useMemo(() => buildGraph(memory), [memory]);

  return (
    <div className="min-h-screen">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-semibold text-lg">Continuum</span>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/dashboard" className="hover:text-foreground transition-colors">Memory</Link>
            <Link href="/dashboard/memory-graph" className="text-foreground">Graph</Link>
            <Link href="/dashboard/playground" className="hover:text-foreground transition-colors">Playground</Link>
          </nav>
        </div>
        <UserButton />
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Memory graph</h2>
          <Select value={workspace} onValueChange={(ws) => ws && setWorkspace(ws)}>
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
        </div>

        <div className="flex gap-4">
          <Card className="flex-1 overflow-hidden py-0">
            <CardContent className="p-0 relative h-[600px]">
              {nodes.length === 0 ? (
                <p className="text-muted-foreground text-sm p-6">
                  No graph data in &quot;{workspace}&quot; yet — save a memory with named entities to see connections here.
                </p>
              ) : (
                <GraphCanvas
                  nodes={nodes}
                  edges={edges}
                  layoutType="forceDirected2d"
                  labelType="all"
                  edgeArrowPosition="none"
                  draggable
                  onNodeClick={(n) => setSelected({ label: n.label ?? n.id, data: n.data as NodeData })}
                  onCanvasClick={() => setSelected(null)}
                />
              )}
            </CardContent>
          </Card>

          {selected && (
            <Card className="w-80 shrink-0">
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm">{selected.label}</h3>
                  <Badge variant="secondary">{selected.data.typeKey}</Badge>
                </div>
                {selected.data.kind === "memory" && selected.data.memory && (
                  <p className="text-sm whitespace-pre-wrap">{selected.data.memory.content}</p>
                )}
                {selected.data.kind === "entity" && (
                  <ul className="space-y-2">
                    {selected.data.connections.map((c, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{c.name}</span>
                        <p className="text-xs text-muted-foreground">{c.relation}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
