"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  GraphCanvasRef,
  GraphNode as ReaGraphNode,
  GraphEdge as ReaGraphEdge,
  Theme as ReaGraphTheme,
} from "reagraph";
import { Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { useTheme } from "@/lib/theme-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const GraphCanvas = dynamic(() => import("reagraph").then((m) => m.GraphCanvas), { ssr: false });

const CONTROL_BUTTON_CLASS =
  "flex items-center justify-center rounded-md border bg-secondary/40 size-8 hover:bg-secondary transition-colors";

function useReagraphTheme(resolvedTheme: "light" | "dark") {
  const [themes, setThemes] = useState<{ light: ReaGraphTheme; dark: ReaGraphTheme } | null>(null);

  useEffect(() => {
    import("reagraph").then((m) => setThemes({ light: m.lightTheme, dark: m.darkTheme }));
  }, []);

  return themes?.[resolvedTheme];
}

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
  const { workspace, setWorkspaces } = useWorkspace();
  const { resolvedTheme } = useTheme();
  const reagraphTheme = useReagraphTheme(resolvedTheme);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [selected, setSelected] = useState<{ label: string; data: NodeData } | null>(null);
  const [search, setSearch] = useState("");
  const [hiddenEntityTypes, setHiddenEntityTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/memory?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => r.json())
      .then((data) => {
        setMemory(data.entries ?? []);
        setWorkspaces(data.workspaces ?? ["default"]);
        setSelected(null);
      });
  }, [workspace, setWorkspaces]);

  const filteredMemory = useMemo(
    () =>
      memory.map((m) => ({
        ...m,
        entities: m.entities.filter((e) => !hiddenEntityTypes.has(e.entity_type)),
      })),
    [memory, hiddenEntityTypes]
  );

  const { nodes, edges } = useMemo(() => buildGraph(filteredMemory), [filteredMemory]);

  const selections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return nodes.filter((n) => (n.label ?? "").toLowerCase().includes(q)).map((n) => n.id);
  }, [nodes, search]);

  const graphRef = useRef<GraphCanvasRef | null>(null);

  useEffect(() => {
    if (nodes.length === 0) return;
    const id = requestAnimationFrame(() => graphRef.current?.fitNodesInView());
    return () => cancelAnimationFrame(id);
  }, [nodes, edges, selected]);

  function toggleEntityType(type: string) {
    setHiddenEntityTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <main className="px-6 py-6 h-[calc(100vh-3.75rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4 gap-4 shrink-0">
        <h2 className="text-xl font-semibold shrink-0">Memory graph</h2>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search nodes…"
          className="max-w-xs"
        />
      </div>

      <div className="flex items-center flex-wrap gap-4 mb-4 text-xs shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground uppercase tracking-wide">Memory</span>
          {Object.entries(MEMORY_TYPE_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1 text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
              {type}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-muted-foreground uppercase tracking-wide mr-0.5">Entities</span>
          {Object.entries(ENTITY_TYPE_COLORS).map(([type, color]) => {
            const active = !hiddenEntityTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleEntityType(type)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 transition-opacity ${
                  active ? "opacity-100" : "opacity-40"
                }`}
                title={active ? `Hide ${type}` : `Show ${type}`}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                {type}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <Card className="flex-1 overflow-hidden py-0">
          <CardContent className="p-0 relative h-full">
            {nodes.length === 0 ? (
              <p className="text-muted-foreground text-sm p-6">
                No graph data in &quot;{workspace}&quot; yet — save a memory with named entities to see connections here.
              </p>
            ) : (
              <>
                <GraphCanvas
                  ref={graphRef}
                  nodes={nodes}
                  edges={edges}
                  selections={selections}
                  theme={reagraphTheme}
                  layoutType="forceDirected2d"
                  labelType="all"
                  edgeArrowPosition="none"
                  draggable
                  onNodeClick={(n) => setSelected({ label: n.label ?? n.id, data: n.data as NodeData })}
                  onCanvasClick={() => setSelected(null)}
                />
                <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
                  <button
                    className={CONTROL_BUTTON_CLASS}
                    title="Zoom in"
                    onClick={() => graphRef.current?.zoomIn()}
                  >
                    <ZoomIn className="size-4" />
                  </button>
                  <button
                    className={CONTROL_BUTTON_CLASS}
                    title="Zoom out"
                    onClick={() => graphRef.current?.zoomOut()}
                  >
                    <ZoomOut className="size-4" />
                  </button>
                  <button
                    className={CONTROL_BUTTON_CLASS}
                    title="Fit to view"
                    onClick={() => graphRef.current?.fitNodesInView()}
                  >
                    <Maximize className="size-4" />
                  </button>
                  <button
                    className={CONTROL_BUTTON_CLASS}
                    title="Reset view"
                    onClick={() => graphRef.current?.resetControls()}
                  >
                    <RotateCcw className="size-4" />
                  </button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {selected && (
          <Card className="w-80 shrink-0 overflow-y-auto">
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
                      <button
                        className="font-medium hover:underline"
                        onClick={() => {
                          const m = memory.find((mm) => mm.name === c.name);
                          if (m) setSelected({ label: m.name, data: { kind: "memory", typeKey: m.type, memory: m, connections: [] } });
                        }}
                      >
                        {c.name}
                      </button>
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
  );
}
