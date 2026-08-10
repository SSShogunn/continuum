import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type {
  GraphCanvasRef,
  GraphNode as ReaGraphNode,
  GraphEdge as ReaGraphEdge,
  Theme as ReaGraphTheme,
} from "reagraph";
import { Maximize, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { useTheme } from "@/lib/theme-context";
import { useApiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ErrorBoundary } from "@/components/error-boundary";

// troika-three-text's WebGL SDF text renderer throws an uncaught rejection
// instead of degrading quietly when ANGLE_instanced_arrays is unavailable
// (software rendering, some VMs/integrated GPUs) — swallow just that failure
// so it can't take down the whole dashboard.
function useSuppressWebglTextErrors() {
  useEffect(() => {
    function onRejection(event: PromiseRejectionEvent) {
      const message = String(event.reason?.message ?? event.reason ?? "");
      if (message.includes("ANGLE_instanced_arrays") || message.includes("WebGL SDF generation")) {
        event.preventDefault();
      }
    }
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
}

function GraphUnsupportedFallback() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <p className="text-muted-foreground text-sm max-w-sm">
        The graph view couldn&apos;t start 3D rendering in this browser. Try a different browser or
        device — this is usually a missing WebGL feature, not a data problem.
      </p>
    </div>
  );
}

// troika-three-text's floating labels use their own implicit offscreen canvas for
// SDF text generation, and webgl-sdf-generator hardcodes a plain WebGL1 context for
// it (`canvas.getContext('webgl', { depth: false })`) regardless of what the main
// 3D scene uses — it never requests WebGL2. On hybrid-GPU laptops that offscreen
// canvas can land on a different GPU (often the integrated one) than the visible
// canvas, with different WebGL1 extension support, so a general WebGL2-capability
// check doesn't predict this. Replicate the library's own context creation exactly
// and check for the specific extension (ANGLE_instanced_arrays) it needs; troika's
// own JS fallback for a missing extension is itself broken and throws instead of
// degrading, so this is checked and avoided up front rather than caught after the
// fact. Every other graph feature (nodes, edges, click-to-inspect) works without labels.
function detectGraphLabelSupport(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { depth: false }) as WebGLRenderingContext | null;
    return !!gl?.getExtension("ANGLE_instanced_arrays");
  } catch {
    return false;
  }
}

function useLabelsSupported() {
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    setSupported(detectGraphLabelSupport());
  }, []);
  return supported;
}

const GraphCanvas = lazy(() => import("reagraph").then((m) => ({ default: m.GraphCanvas })));

const CONTROL_BUTTON_CLASS =
  "flex items-center justify-center rounded-md border bg-secondary/40 size-8 hover:bg-secondary transition-colors";

function useReagraphTheme(resolvedTheme: "light" | "dark") {
  const [themes, setThemes] = useState<{ light: ReaGraphTheme; dark: ReaGraphTheme } | null>(null);

  useEffect(() => {
    import("reagraph").then((m) => setThemes({ light: m.lightTheme, dark: m.darkTheme }));
  }, []);

  return themes?.[resolvedTheme];
}

interface GraphNode {
  id: number;
  name: string;
  type: string;
  summary: string;
}

interface GraphEdge {
  id: number;
  source: number;
  target: number;
  predicate: string;
  fact: string;
  episode_name: string;
}

interface Connection {
  predicate: string;
  other: string;
  outgoing: boolean;
  fact: string;
  episode_name: string;
}

interface NodeData {
  type: string;
  summary: string;
  connections: Connection[];
}

// One colour per entity type in the taxonomy (taxonomy.py).
const ENTITY_TYPE_COLORS: Record<string, string> = {
  person: "#60a5fa",
  organization: "#c084fc",
  place: "#4ade80",
  machine: "#22d3ee",
  service: "#f472b6",
  technology: "#facc15",
  config: "#fb923c",
  network: "#2dd4bf",
  project: "#818cf8",
  task: "#f87171",
  event: "#a3e635",
  concept: "#9ca3af",
};

const DEFAULT_COLOR = "#9ca3af";

function buildGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  hiddenTypes: Set<string>
): { nodes: ReaGraphNode[]; edges: ReaGraphEdge[] } {
  const visible = nodes.filter((n) => !hiddenTypes.has(n.type));
  const visibleIds = new Set(visible.map((n) => n.id));
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));

  const connections = new Map<number, Connection[]>();
  const degree = new Map<number, number>();
  const graphEdges: ReaGraphEdge[] = [];

  for (const e of edges) {
    if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    graphEdges.push({
      id: String(e.id),
      source: String(e.source),
      target: String(e.target),
      label: e.predicate,
    });
    if (!connections.has(e.source)) connections.set(e.source, []);
    if (!connections.has(e.target)) connections.set(e.target, []);
    connections.get(e.source)!.push({
      predicate: e.predicate,
      other: nameById.get(e.target) ?? "?",
      outgoing: true,
      fact: e.fact,
      episode_name: e.episode_name,
    });
    connections.get(e.target)!.push({
      predicate: e.predicate,
      other: nameById.get(e.source) ?? "?",
      outgoing: false,
      fact: e.fact,
      episode_name: e.episode_name,
    });
  }

  const graphNodes: ReaGraphNode[] = visible.map((n) => ({
    id: String(n.id),
    label: n.name,
    fill: ENTITY_TYPE_COLORS[n.type] ?? DEFAULT_COLOR,
    size: 5 + Math.min((degree.get(n.id) ?? 0) * 1.5, 15),
    data: {
      type: n.type,
      summary: n.summary,
      connections: connections.get(n.id) ?? [],
    } as NodeData,
  }));

  return { nodes: graphNodes, edges: graphEdges };
}

export default function MemoryGraphPage() {
  useSuppressWebglTextErrors();
  const api = useApiClient();
  const { workspace, setWorkspaces } = useWorkspace();
  const { resolvedTheme } = useTheme();
  const reagraphTheme = useReagraphTheme(resolvedTheme);
  const labelsSupported = useLabelsSupported();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<{ label: string; data: NodeData } | null>(null);
  const [search, setSearch] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  useEffect(() => {
    api
      .get<{ nodes: GraphNode[]; edges: GraphEdge[]; workspaces: string[] }>(
        `/api/memory/graph?workspace=${encodeURIComponent(workspace)}`
      )
      .then((data) => {
        setNodes(data.nodes ?? []);
        setEdges(data.edges ?? []);
        setWorkspaces(data.workspaces ?? ["default"]);
        setSelected(null);
      });
  }, [workspace, setWorkspaces, api]);

  // Only show legend toggles for types actually present in the graph.
  const presentTypes = useMemo(() => {
    const set = new Set(nodes.map((n) => n.type));
    return Object.keys(ENTITY_TYPE_COLORS).filter((t) => set.has(t));
  }, [nodes]);

  const graph = useMemo(
    () => buildGraph(nodes, edges, hiddenTypes),
    [nodes, edges, hiddenTypes]
  );

  const selections = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return graph.nodes.filter((n) => (n.label ?? "").toLowerCase().includes(q)).map((n) => n.id);
  }, [graph.nodes, search]);

  const graphRef = useRef<GraphCanvasRef | null>(null);

  useEffect(() => {
    if (graph.nodes.length === 0) return;
    const id = requestAnimationFrame(() => graphRef.current?.fitNodesInView());
    return () => cancelAnimationFrame(id);
  }, [graph.nodes, graph.edges, selected]);

  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <main className="px-6 py-6 h-[calc(100vh-3.75rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4 gap-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-xl font-semibold shrink-0">Memory graph</h2>
          {!labelsSupported && (
            <span className="text-muted-foreground text-xs truncate" title="A WebGL feature the node labels need isn't available on this GPU — click a node to see its name instead.">
              (labels unavailable in this browser)
            </span>
          )}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search entities…"
          className="max-w-xs"
        />
      </div>

      <div className="flex items-center flex-wrap gap-1.5 mb-4 text-xs shrink-0">
        <span className="text-muted-foreground uppercase tracking-wide mr-0.5">Entities</span>
        {presentTypes.map((type) => {
          const active = !hiddenTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 transition-opacity ${
                active ? "opacity-100" : "opacity-40"
              }`}
              title={active ? `Hide ${type}` : `Show ${type}`}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: ENTITY_TYPE_COLORS[type] }} />
              {type}
            </button>
          );
        })}
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        <Card surface="chrome" className="flex-1 overflow-hidden py-0">
          <CardContent className="p-0 relative h-full">
            {graph.nodes.length === 0 ? (
              <p className="text-muted-foreground text-sm p-6">
                No graph data in &quot;{workspace}&quot; yet — save a memory with named entities to see connections here.
              </p>
            ) : (
              <>
                <ErrorBoundary fallback={<GraphUnsupportedFallback />}>
                  <Suspense fallback={null}>
                    <GraphCanvas
                      ref={graphRef}
                      nodes={graph.nodes}
                      edges={graph.edges}
                      selections={selections}
                      theme={reagraphTheme}
                      layoutType="forceDirected2d"
                      labelType={labelsSupported ? "all" : "none"}
                      edgeArrowPosition="end"
                      draggable
                      onNodeClick={(n) => setSelected({ label: n.label ?? n.id, data: n.data as NodeData })}
                      onCanvasClick={() => setSelected(null)}
                    />
                  </Suspense>
                </ErrorBoundary>
                <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
                  <button className={CONTROL_BUTTON_CLASS} title="Zoom in" onClick={() => graphRef.current?.zoomIn()}>
                    <ZoomIn className="size-4" />
                  </button>
                  <button className={CONTROL_BUTTON_CLASS} title="Zoom out" onClick={() => graphRef.current?.zoomOut()}>
                    <ZoomOut className="size-4" />
                  </button>
                  <button className={CONTROL_BUTTON_CLASS} title="Fit to view" onClick={() => graphRef.current?.fitNodesInView()}>
                    <Maximize className="size-4" />
                  </button>
                  <button className={CONTROL_BUTTON_CLASS} title="Reset view" onClick={() => graphRef.current?.resetControls()}>
                    <RotateCcw className="size-4" />
                  </button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <AnimatePresence>
          {selected && (
            <motion.div
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="w-80 shrink-0"
            >
              <Card surface="chrome" className="overflow-y-auto h-full">
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-sm">{selected.label}</h3>
                    <Badge variant="secondary">{selected.data.type}</Badge>
                  </div>
                  {selected.data.summary && (
                    <p className="text-sm text-muted-foreground">{selected.data.summary}</p>
                  )}
                  <ul className="space-y-2">
                    {selected.data.connections.map((c, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">
                          {c.outgoing ? `${c.predicate} → ${c.other}` : `${c.other} ${c.predicate} →`}
                        </span>
                        <p className="text-xs text-muted-foreground">{c.fact}</p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
