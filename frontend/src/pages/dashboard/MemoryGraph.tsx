import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeftRight,
  ArrowRight,
  Locate,
  Maximize2,
  PanelLeft,
  RotateCcw,
  Search,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { useTheme } from "@/lib/theme-context";
import { useApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/error-boundary";
import { EmptyState, ErrorState } from "@/components/states";
import { Page } from "@/components/page";
import {
  ForceGraph,
  type ForceGraphHandle,
  type GraphEdgeInput,
  type GraphNodeInput,
} from "@/components/graph/force-graph";
import {
  ENTITY_TYPES,
  ENTITY_TYPE_DESCRIPTIONS,
  entityColor,
} from "@/components/graph/entity-palette";

interface ApiNode {
  id: number;
  name: string;
  type: string;
  summary: string;
}

interface ApiEdge {
  id: number;
  source: number;
  target: number;
  predicate: string;
  fact: string;
  episode_name: string;
}

interface Relation {
  id: string;
  predicate: string;
  otherId: string;
  otherName: string;
  otherType: string;
  outgoing: boolean;
  fact: string;
  episode: string;
}

function readablePredicate(predicate: string) {
  return predicate.replace(/_/g, " ").toLowerCase();
}

export default function MemoryGraphPage() {
  const api = useApiClient();
  const { workspace, setWorkspaces } = useWorkspace();
  const { resolvedTheme } = useTheme();

  const [nodes, setNodes] = useState<ApiNode[]>([]);
  const [edges, setEdges] = useState<ApiEdge[]>([]);
  const [loadedWorkspace, setLoadedWorkspace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  // Below lg the rail overlays the plot, so it starts closed there rather than
  // covering the graph the user came to look at.
  const [railOpen, setRailOpen] = useState(
    () => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches
  );

  const graphHandle = useRef<ForceGraphHandle | null>(null);
  const railListRef = useRef<HTMLDivElement | null>(null);

  const loading = loadedWorkspace !== workspace && error === null;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<{ nodes: ApiNode[]; edges: ApiEdge[]; workspaces: string[] }>(
        `/api/memory/graph?workspace=${encodeURIComponent(workspace)}`
      )
      .then((data) => {
        if (cancelled) return;
        setNodes(data.nodes ?? []);
        setEdges(data.edges ?? []);
        setWorkspaces(data.workspaces ?? ["default"]);
        setSelectedId(null);
        setLoadedWorkspace(workspace);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, setWorkspaces, api]);

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    return counts;
  }, [nodes]);

  // Taxonomy order first so the legend never reshuffles, then anything the
  // extractor produced that the frontend taxonomy hasn't caught up with.
  const presentTypes = useMemo(() => {
    const known = new Set<string>(ENTITY_TYPES);
    return [
      ...ENTITY_TYPES.filter((t) => typeCounts.has(t)),
      ...[...typeCounts.keys()].filter((t) => !known.has(t)).sort(),
    ];
  }, [typeCounts]);

  const visible = useMemo(() => {
    const visibleNodes = nodes.filter((n) => !hiddenTypes.has(n.type));
    const ids = new Set(visibleNodes.map((n) => n.id));
    const visibleEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));

    const degree = new Map<number, number>();
    for (const e of visibleEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    const graphNodes: GraphNodeInput[] = visibleNodes.map((n) => ({
      id: String(n.id),
      label: n.name,
      type: n.type,
      degree: degree.get(n.id) ?? 0,
    }));
    const graphEdges: GraphEdgeInput[] = visibleEdges.map((e) => ({
      id: String(e.id),
      source: String(e.source),
      target: String(e.target),
      predicate: e.predicate,
    }));

    return { visibleEdges, graphNodes, graphEdges };
  }, [nodes, edges, hiddenTypes]);

  const nodeById = useMemo(
    () => new Map(nodes.map((n) => [String(n.id), n])),
    [nodes]
  );

  const relationsById = useMemo(() => {
    const map = new Map<string, Relation[]>();
    for (const e of visible.visibleEdges) {
      const source = String(e.source);
      const target = String(e.target);
      const sourceNode = nodeById.get(source);
      const targetNode = nodeById.get(target);
      if (!sourceNode || !targetNode) continue;

      if (!map.has(source)) map.set(source, []);
      if (!map.has(target)) map.set(target, []);
      map.get(source)!.push({
        id: `${e.id}-out`,
        predicate: e.predicate,
        otherId: target,
        otherName: targetNode.name,
        otherType: targetNode.type,
        outgoing: true,
        fact: e.fact,
        episode: e.episode_name,
      });
      map.get(target)!.push({
        id: `${e.id}-in`,
        predicate: e.predicate,
        otherId: source,
        otherName: sourceNode.name,
        otherType: sourceNode.type,
        outgoing: false,
        fact: e.fact,
        episode: e.episode_name,
      });
    }
    return map;
  }, [visible.visibleEdges, nodeById]);

  const ranked = useMemo(
    () =>
      [...visible.graphNodes].sort(
        (a, b) => b.degree - a.degree || a.label.localeCompare(b.label)
      ),
    [visible.graphNodes]
  );

  const query = search.trim().toLowerCase();

  const matchedIds = useMemo(() => {
    if (!query) return null;
    const set = new Set<string>();
    for (const n of visible.graphNodes) {
      if (n.label.toLowerCase().includes(query)) set.add(n.id);
    }
    return set;
  }, [visible.graphNodes, query]);

  const railNodes = useMemo(
    () => (matchedIds ? ranked.filter((n) => matchedIds.has(n.id)) : ranked),
    [ranked, matchedIds]
  );

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;
  const selectedRelations = selectedId ? relationsById.get(selectedId) ?? [] : [];

  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);

  function selectFromRail(id: string) {
    setSelectedId(id);
    graphHandle.current?.focusNode(id);
  }

  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  useEffect(() => {
    if (!selectedId) return;
    railListRef.current
      ?.querySelector(`[data-entity-id="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const hasHidden = hiddenTypes.size > 0;

  return (
    <Page
      title="Memory graph"
      description={
        loading
          ? `Loading "${workspace}"…`
          : `${visible.graphNodes.length} entities · ${visible.graphEdges.length} relations in "${workspace}"`
      }
      icon={Share2}
      fill
      bleed
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          aria-pressed={railOpen}
          onClick={() => setRailOpen((v) => !v)}
        >
          <PanelLeft className={cn("transition-transform", !railOpen && "rotate-180")} />
          <span className="hidden sm:inline">Index</span>
        </Button>
      }
    >
      <div className="relative flex min-h-0 flex-1">
        {/* ── Index rail ─────────────────────────────────────────────────── */}
        <AnimatePresence initial={false}>
          {railOpen && (
            <motion.aside
              key="rail"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-y-0 left-0 z-20 flex w-72 shrink-0 flex-col border-r bg-background lg:relative lg:z-auto"
            >
              <div className="space-y-3 border-b p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find an entity…"
                    className="h-8 pl-8 font-mono text-xs"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                      className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                      Types
                    </span>
                    {hasHidden && (
                      <button
                        onClick={() => setHiddenTypes(new Set())}
                        className="font-mono text-[10px] tracking-wide text-primary uppercase hover:underline"
                      >
                        Show all
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {loading
                      ? Array.from({ length: 7 }).map((_, i) => (
                          <Skeleton key={i} className="h-5 w-16 rounded-4xl" />
                        ))
                      : presentTypes.map((type) => {
                          const active = !hiddenTypes.has(type);
                          return (
                            <button
                              key={type}
                              onClick={() => toggleType(type)}
                              aria-pressed={active}
                              title={`${ENTITY_TYPE_DESCRIPTIONS[type]} — click to ${
                                active ? "hide" : "show"
                              }`}
                              className={cn(
                                "flex h-5 items-center gap-1.5 rounded-4xl border px-1.5 font-mono text-[10px] transition-colors",
                                active
                                  ? "border-border text-foreground hover:bg-muted"
                                  : "border-dashed border-border/60 text-muted-foreground/60"
                              )}
                            >
                              <span
                                className="size-2 shrink-0 rounded-full transition-opacity"
                                style={{
                                  backgroundColor: entityColor(type, resolvedTheme),
                                  opacity: active ? 1 : 0.35,
                                }}
                              />
                              {type}
                              <span className="tabular-nums opacity-60">{typeCounts.get(type)}</span>
                            </button>
                          );
                        })}
                  </div>
                </div>
              </div>

              <div ref={railListRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-3 py-1.5 backdrop-blur-sm">
                  <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
                    Entities
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    by links
                  </span>
                </div>

                {loading ? (
                  <div className="p-3">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-2 py-2">
                        <Skeleton className="size-2 shrink-0 rounded-full" />
                        <Skeleton className="h-3 flex-1" style={{ maxWidth: `${40 + ((i * 19) % 45)}%` }} />
                      </div>
                    ))}
                  </div>
                ) : railNodes.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {query
                      ? `No entity matches “${search}”.`
                      : "Every type is hidden — re-enable one above."}
                  </p>
                ) : (
                  railNodes.map((n) => {
                    const active = n.id === selectedId;
                    return (
                      <button
                        key={n.id}
                        data-entity-id={n.id}
                        onClick={() => selectFromRail(n.id)}
                        className={cn(
                          "relative flex w-full items-center gap-2 border-b border-border/50 py-2 pr-3 pl-3 text-left transition-colors last:border-b-0",
                          active ? "bg-accent" : "hover:bg-accent/50"
                        )}
                      >
                        {active && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: entityColor(n.type, resolvedTheme) }}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{n.label}</span>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {n.degree}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {railOpen && (
          <button
            aria-label="Close index"
            onClick={() => setRailOpen(false)}
            className="absolute inset-0 z-10 bg-background/60 lg:hidden"
          />
        )}

        {/* ── Canvas ─────────────────────────────────────────────────────── */}
        <div className="relative min-w-0 flex-1 bg-card">
          {error ? (
            <ErrorState
              title="Couldn't load the graph"
              description={error}
              className="h-full"
              action={
                <Button size="sm" variant="outline" onClick={() => setLoadedWorkspace(null)}>
                  Try again
                </Button>
              }
            />
          ) : loading ? (
            <div className="flex h-full items-center justify-center">
              <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
                Plotting cross-references…
              </p>
            </div>
          ) : nodes.length === 0 ? (
            <EmptyState
              icon={Share2}
              title="No cross-references filed yet"
              description={`Nothing in "${workspace}" has been decomposed into entities. Save a memory that names people, machines, or projects and its relationships get plotted here.`}
              className="h-full"
            />
          ) : visible.graphNodes.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="Every entity type is hidden"
              description="Re-enable a type in the index to plot it again."
              className="h-full"
              action={
                <Button size="sm" variant="outline" onClick={() => setHiddenTypes(new Set())}>
                  Show all types
                </Button>
              }
            />
          ) : (
            <ErrorBoundary
              fallback={
                <ErrorState
                  title="The graph view stopped responding"
                  description="Reload the page to plot it again."
                  className="h-full"
                />
              }
            >
              <ForceGraph
                nodes={visible.graphNodes}
                edges={visible.graphEdges}
                theme={resolvedTheme}
                selectedId={selectedId}
                matchedIds={matchedIds}
                onSelect={handleSelect}
                handleRef={graphHandle}
              />

              <p className="pointer-events-none absolute bottom-3 left-4 hidden font-mono text-[10px] tracking-wide text-muted-foreground/70 sm:block">
                Scroll to zoom · drag the sheet to pan · drag a node to pin it
              </p>

              <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-md border bg-background/90 backdrop-blur-sm">
                {(
                  [
                    ["Zoom in", ZoomIn, () => graphHandle.current?.zoomBy(1.4)],
                    ["Zoom out", ZoomOut, () => graphHandle.current?.zoomBy(1 / 1.4)],
                    ["Fit to view", Maximize2, () => graphHandle.current?.fit()],
                    ["Re-run layout, releasing pinned nodes", RotateCcw, () => graphHandle.current?.relayout()],
                  ] as const
                ).map(([label, Icon, onClick]) => (
                  <button
                    key={label}
                    title={label}
                    aria-label={label}
                    onClick={onClick}
                    className="flex size-8 items-center justify-center text-muted-foreground transition-colors not-last:border-b hover:bg-accent hover:text-foreground"
                  >
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
            </ErrorBoundary>
          )}
        </div>

        {/* ── Inspector ──────────────────────────────────────────────────── */}
        <AnimatePresence initial={false}>
          {selectedNode && (
            <motion.aside
              key="inspector"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-y-0 right-0 z-20 flex w-[min(22rem,88vw)] shrink-0 flex-col border-l bg-background xl:relative xl:z-auto"
            >
              <div className="flex items-start gap-2 border-b p-4">
                <span
                  className="mt-1.5 size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entityColor(selectedNode.type, resolvedTheme) }}
                />
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base leading-snug font-semibold break-words">
                    {selectedNode.name}
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {selectedNode.type}
                    </Badge>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {selectedRelations.length} relation
                      {selectedRelations.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    title="Centre on this entity"
                    aria-label="Centre on this entity"
                    onClick={() => graphHandle.current?.focusNode(selectedNode.id.toString())}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <Locate className="size-3.5" />
                  </button>
                  <button
                    title="Close"
                    aria-label="Close inspector"
                    onClick={() => setSelectedId(null)}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {selectedNode.summary && (
                  <p className="border-b px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                    {selectedNode.summary}
                  </p>
                )}

                <div className="sticky top-0 z-10 border-b bg-background/95 px-4 py-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase backdrop-blur-sm">
                  Cross-references
                </div>

                {selectedRelations.length === 0 ? (
                  <p className="px-4 py-6 text-xs text-muted-foreground">
                    Nothing links to this entity in the current view — a hidden type may be holding
                    its only relation.
                  </p>
                ) : (
                  <ul>
                    {selectedRelations.map((r) => (
                      <li key={r.id} className="border-b border-border/50 px-4 py-3 last:border-b-0">
                        <div className="flex items-center gap-1.5">
                          <ArrowRight
                            className={cn(
                              "size-3 shrink-0 text-muted-foreground",
                              !r.outgoing && "rotate-180"
                            )}
                          />
                          <span className="font-mono text-[10px] tracking-[0.06em] text-primary uppercase">
                            {readablePredicate(r.predicate)}
                          </span>
                        </div>
                        <button
                          onClick={() => selectFromRail(r.otherId)}
                          className="mt-1 flex w-full items-center gap-1.5 text-left"
                        >
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: entityColor(r.otherType, resolvedTheme) }}
                          />
                          <span className="min-w-0 truncate font-mono text-xs underline-offset-4 hover:underline">
                            {r.otherName}
                          </span>
                        </button>
                        {r.fact && (
                          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                            {r.fact}
                          </p>
                        )}
                        {r.episode && (
                          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">
                            filed under {r.episode}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
    </Page>
  );
}
