import { useEffect, useRef, type RefObject } from "react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { entityColor } from "./entity-palette";

export interface GraphNodeInput {
  id: string;
  label: string;
  type: string;
  degree: number;
}

export interface GraphEdgeInput {
  id: string;
  source: string;
  target: string;
  predicate: string;
}

export interface ForceGraphHandle {
  zoomBy(factor: number): void;
  fit(): void;
  relayout(): void;
  focusNode(id: string): void;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  degree: number;
  r: number;
  pinned: boolean;
}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  id: string;
  predicate: string;
}

type RGB = [number, number, number];

interface Palette {
  surface: RGB;
  grid: RGB;
  gridAlpha: number;
  line: RGB;
  text: RGB;
  muted: RGB;
  accent: RGB;
}

const MIN_SCALE = 0.08;
const MAX_SCALE = 6;
const CURVATURE = 0.11;
const LABEL_PX = 11;
const EDGE_LABEL_PX = 9.5;

function rgba(c: RGB, alpha: number) {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
}

function radiusFor(degree: number) {
  return Math.min(22, 5 + Math.sqrt(degree) * 2.4);
}

// getComputedStyle hands back whatever notation the token was authored in
// (hex, rgba(), oklch()) — painting one pixel and reading it back is the only
// parse that covers all of them, and it recovers the token's own alpha too.
function readPalette(el: HTMLElement): Palette {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const styles = getComputedStyle(el);

  function read(token: string, fallback: RGB): { rgb: RGB; alpha: number } {
    const value = styles.getPropertyValue(token).trim();
    if (!probe || !value) return { rgb: fallback, alpha: 1 };
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = "#000000";
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return { rgb: [d[0], d[1], d[2]], alpha: d[3] / 255 };
  }

  const border = read("--border", [128, 128, 128]);
  return {
    surface: read("--card", [26, 28, 31]).rgb,
    grid: border.rgb,
    gridAlpha: border.alpha,
    line: border.rgb,
    text: read("--foreground", [240, 240, 240]).rgb,
    muted: read("--muted-foreground", [160, 160, 160]).rgb,
    accent: read("--primary", [224, 86, 60]).rgb,
  };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function ForceGraph({
  nodes,
  edges,
  theme,
  selectedId,
  matchedIds,
  onSelect,
  handleRef,
}: {
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  theme: "light" | "dark";
  selectedId: string | null;
  matchedIds: ReadonlySet<string> | null;
  onSelect: (id: string | null) => void;
  handleRef: RefObject<ForceGraphHandle | null>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);
  const simEdgesRef = useRef<SimEdge[]>([]);
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());
  const positionsRef = useRef<Map<string, { x: number; y: number; pinned: boolean }>>(new Map());
  const byDegreeRef = useRef<SimNode[]>([]);

  const paletteRef = useRef<Palette | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  const selectedRef = useRef<string | null>(selectedId);
  const matchedRef = useRef<ReadonlySet<string> | null>(matchedIds);
  const hoverRef = useRef<string | null>(null);
  const themeRef = useRef(theme);

  const rafRef = useRef<number | null>(null);
  const tweenRef = useRef<number | null>(null);
  const fadeRef = useRef({ start: 0, active: false });
  const needsFitRef = useRef(false);
  const fitRef = useRef<() => void>(() => {});
  // d3-zoom stamps its transform onto the canvas element when a behavior is
  // attached, so re-running the setup effect would snap the view back to the
  // identity transform. Callbacks reach it through a ref to keep that effect
  // mounted exactly once.
  const onSelectRef = useRef(onSelect);

  // ── drawing ────────────────────────────────────────────────────────────────
  const drawRef = useRef<() => void>(() => {});
  const requestDrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    function requestDraw() {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        drawRef.current();
      });
    }
    requestDrawRef.current = requestDraw;

    drawRef.current = function draw() {
      const canvas = canvasRef.current;
      const palette = paletteRef.current;
      if (!canvas || !palette) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { width, height } = sizeRef.current;
      if (width === 0 || height === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const t = transformRef.current;
      const k = t.k;
      const simNodes = simNodesRef.current;
      const simEdges = simEdgesRef.current;
      const mode = themeRef.current;

      let fade = 1;
      if (fadeRef.current.active) {
        fade = Math.min((performance.now() - fadeRef.current.start) / 420, 1);
        fade = 1 - Math.pow(1 - fade, 3);
        if (fade >= 1) fadeRef.current.active = false;
        else requestDraw();
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = rgba(palette.surface, 1);
      ctx.fillRect(0, 0, width, height);

      ctx.translate(t.x, t.y);
      ctx.scale(k, k);

      // Plotting grid — a drafting-sheet reference that pans with the layout so
      // panning a large graph never feels like sliding across an empty void.
      const step = k < 0.35 ? 240 : k < 0.9 ? 120 : 60;
      const x0 = Math.floor(-t.x / k / step) * step;
      const y0 = Math.floor(-t.y / k / step) * step;
      const x1 = (width - t.x) / k;
      const y1 = (height - t.y) / k;
      const dot = 1 / k;
      ctx.fillStyle = rgba(palette.grid, Math.min(1, palette.gridAlpha * 1.8) * fade);
      for (let x = x0; x < x1; x += step) {
        for (let y = y0; y < y1; y += step) {
          ctx.fillRect(x, y, dot, dot);
        }
      }

      const focusId = hoverRef.current ?? selectedRef.current;
      const neighbors = focusId ? adjacencyRef.current.get(focusId) : null;
      const matched = matchedRef.current;

      function nodeEmphasis(id: string) {
        if (focusId) return id === focusId || neighbors?.has(id) ? 1 : 0.16;
        if (matched) return matched.has(id) ? 1 : 0.14;
        return 1;
      }

      // ── edges ──
      ctx.lineCap = "round";
      const focusedEdges: SimEdge[] = [];
      for (const e of simEdges) {
        const s = e.source as SimNode;
        const d = e.target as SimNode;
        if (s.x == null || d.x == null) continue;

        const isFocused = focusId != null && (s.id === focusId || d.id === focusId);
        if (isFocused) {
          focusedEdges.push(e);
          continue;
        }
        let alpha = 0.42;
        if (focusId) alpha = 0.05;
        else if (matched) alpha = matched.has(s.id) || matched.has(d.id) ? 0.42 : 0.06;

        ctx.strokeStyle = rgba(palette.line, alpha * fade);
        ctx.lineWidth = 1.1 / k;
        ctx.beginPath();
        const mx = (s.x + d.x!) / 2;
        const my = (s.y! + d.y!) / 2;
        const cx = mx - (d.y! - s.y!) * CURVATURE;
        const cy = my + (d.x! - s.x!) * CURVATURE;
        ctx.moveTo(s.x!, s.y!);
        ctx.quadraticCurveTo(cx, cy, d.x!, d.y!);
        ctx.stroke();

        if (k > 0.6) drawArrow(ctx, cx, cy, d, palette, alpha * 1.3 * fade, k);
      }

      for (const e of focusedEdges) {
        const s = e.source as SimNode;
        const d = e.target as SimNode;
        const mx = (s.x! + d.x!) / 2;
        const my = (s.y! + d.y!) / 2;
        const cx = mx - (d.y! - s.y!) * CURVATURE;
        const cy = my + (d.x! - s.x!) * CURVATURE;

        ctx.strokeStyle = rgba(palette.accent, 0.85);
        ctx.lineWidth = 1.7 / k;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.quadraticCurveTo(cx, cy, d.x!, d.y!);
        ctx.stroke();
        drawArrow(ctx, cx, cy, d, palette, 0.95, k, palette.accent);
      }

      // ── nodes ──
      for (const n of simNodes) {
        if (n.x == null) continue;
        const alpha = nodeEmphasis(n.id) * fade;
        const color = entityColor(n.type, mode);

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(n.x, n.y!, n.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.6 / k;
        ctx.strokeStyle = rgba(palette.surface, 0.9);
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (n.id === selectedRef.current) {
          // The ink-stamp impression: a struck ring plus its lighter halo,
          // the same "stamped, not highlighted" language the auth cards use.
          ctx.strokeStyle = rgba(palette.accent, 0.95);
          ctx.lineWidth = 1.8 / k;
          ctx.beginPath();
          ctx.arc(n.x, n.y!, n.r + 5 / k + 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = rgba(palette.accent, 0.32);
          ctx.lineWidth = 1 / k;
          ctx.beginPath();
          ctx.arc(n.x, n.y!, n.r + 10 / k + 2, 0, Math.PI * 2);
          ctx.stroke();
        } else if (n.id === hoverRef.current) {
          ctx.strokeStyle = rgba(palette.text, 0.7);
          ctx.lineWidth = 1.4 / k;
          ctx.beginPath();
          ctx.arc(n.x, n.y!, n.r + 4 / k + 1.5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (matched?.has(n.id)) {
          ctx.strokeStyle = rgba(palette.accent, 0.75);
          ctx.lineWidth = 1.4 / k;
          ctx.beginPath();
          ctx.arc(n.x, n.y!, n.r + 4 / k + 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ── labels ──
      const labelIds = new Set<string>();
      if (focusId) {
        labelIds.add(focusId);
        neighbors?.forEach((id) => labelIds.add(id));
      } else {
        const budget = Math.min(byDegreeRef.current.length, Math.max(8, Math.round(k * 34)));
        for (let i = 0; i < budget; i++) labelIds.add(byDegreeRef.current[i].id);
        if (matched) matched.forEach((id) => labelIds.add(id));
      }

      const fontPx = LABEL_PX / k;
      ctx.font = `500 ${fontPx}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      for (const n of simNodes) {
        if (n.x == null || !labelIds.has(n.id)) continue;
        const isFocus = n.id === focusId;
        const text = truncate(n.label, isFocus ? 40 : 24);
        const y = n.y! + n.r + fontPx * 0.95;
        const w = ctx.measureText(text).width;
        const padX = 4 / k;
        const padY = 2.5 / k;

        ctx.globalAlpha = nodeEmphasis(n.id) * fade;
        ctx.fillStyle = rgba(palette.surface, 0.86);
        roundedRect(
          ctx,
          n.x - w / 2 - padX,
          y - fontPx / 2 - padY,
          w + padX * 2,
          fontPx + padY * 2,
          3 / k
        );
        ctx.fill();
        ctx.fillStyle = rgba(palette.text, isFocus ? 1 : 0.82);
        ctx.fillText(text, n.x, y);
        ctx.globalAlpha = 1;
      }

      // ── predicate labels, only for the focused neighbourhood ──
      if (focusedEdges.length > 0 && focusedEdges.length <= 24 && k > 0.35) {
        const edgeFont = EDGE_LABEL_PX / k;
        ctx.font = `500 ${edgeFont}px "IBM Plex Mono", ui-monospace, monospace`;
        for (const e of focusedEdges) {
          const s = e.source as SimNode;
          const d = e.target as SimNode;
          const mx = (s.x! + d.x!) / 2;
          const my = (s.y! + d.y!) / 2;
          const cx = mx - (d.y! - s.y!) * CURVATURE;
          const cy = my + (d.x! - s.x!) * CURVATURE;
          const px = 0.25 * s.x! + 0.5 * cx + 0.25 * d.x!;
          const py = 0.25 * s.y! + 0.5 * cy + 0.25 * d.y!;
          const text = truncate(e.predicate.replace(/_/g, " "), 26);
          const w = ctx.measureText(text).width;
          ctx.fillStyle = rgba(palette.surface, 0.94);
          roundedRect(
            ctx,
            px - w / 2 - 4 / k,
            py - edgeFont / 2 - 2.5 / k,
            w + 8 / k,
            edgeFont + 5 / k,
            3 / k
          );
          ctx.fill();
          ctx.fillStyle = rgba(palette.accent, 0.95);
          ctx.fillText(text, px, py);
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // Every draw input the canvas reads lives in a ref, so props are mirrored
  // once per render and a repaint is queued from the same place.
  useEffect(() => {
    selectedRef.current = selectedId;
    matchedRef.current = matchedIds;
    themeRef.current = theme;
    onSelectRef.current = onSelect;
    requestDrawRef.current();
  });

  // ── simulation ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const cached = positionsRef.current;
    const simNodes: SimNode[] = nodes.map((n) => {
      const prev = cached.get(n.id);
      const node: SimNode = {
        id: n.id,
        label: n.label,
        type: n.type,
        degree: n.degree,
        r: radiusFor(n.degree),
        pinned: prev?.pinned ?? false,
        x: prev?.x,
        y: prev?.y,
      };
      if (node.pinned) {
        node.fx = prev?.x;
        node.fy = prev?.y;
      }
      return node;
    });

    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simEdges: SimEdge[] = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({
        id: e.id,
        predicate: e.predicate,
        source: byId.get(e.source)!,
        target: byId.get(e.target)!,
      }));

    const adjacency = new Map<string, Set<string>>();
    for (const n of simNodes) adjacency.set(n.id, new Set());
    for (const e of edges) {
      adjacency.get(e.source)?.add(e.target);
      adjacency.get(e.target)?.add(e.source);
    }

    simNodesRef.current = simNodes;
    simEdgesRef.current = simEdges;
    adjacencyRef.current = adjacency;
    byDegreeRef.current = [...simNodes].sort((a, b) => b.degree - a.degree);

    simRef.current?.stop();
    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance((l) => 52 + (l.source as SimNode).r + (l.target as SimNode).r)
          .strength(0.32)
      )
      .force("charge", forceManyBody<SimNode>().strength(-280).distanceMax(900))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 18).strength(0.85))
      .force("x", forceX(0).strength(0.045))
      .force("y", forceY(0).strength(0.055))
      .alphaDecay(0.026);

    sim.on("tick", () => {
      const store = positionsRef.current;
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const entry = store.get(n.id);
        if (entry) {
          entry.x = n.x;
          entry.y = n.y;
          entry.pinned = n.pinned;
        } else {
          store.set(n.id, { x: n.x, y: n.y, pinned: n.pinned });
        }
      }
      requestDrawRef.current();
    });

    simRef.current = sim;

    // A type filter keeps most nodes, so their cached positions carry over and
    // the layout only nudges. A workspace switch shares almost nothing, and
    // that is what earns a fresh settle-and-fit.
    const known = simNodes.reduce((count, n) => count + (cached.has(n.id) ? 1 : 0), 0);
    const firstLayout = simNodes.length > 0 && known < simNodes.length / 2;
    if (firstLayout) {
      fadeRef.current = { start: performance.now(), active: true };
      // Settle off-screen first so the graph resolves into a readable shape
      // instead of animating out of a knot in front of the user.
      sim.tick(simNodes.length > 600 ? 40 : 120);
      needsFitRef.current = true;
      queueMicrotask(() => {
        if (!needsFitRef.current || sizeRef.current.width === 0) return;
        needsFitRef.current = false;
        handleRef.current?.fit();
      });
    }
    requestDrawRef.current();

    return () => {
      sim.stop();
    };
  }, [nodes, edges, handleRef]);

  // ── canvas setup: palette, sizing, zoom, pointer ───────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    paletteRef.current = readPalette(container);

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      // The first layout finishes before the observer reports a size, so the
      // pending fit is claimed here rather than dropped on a zero-width canvas.
      if (needsFitRef.current && rect.width > 0) {
        needsFitRef.current = false;
        fitRef.current();
      }
      requestDrawRef.current();
    });
    observer.observe(container);

    function worldFromEvent(event: { clientX: number; clientY: number }) {
      const rect = canvas!.getBoundingClientRect();
      const t = transformRef.current;
      return {
        x: (event.clientX - rect.left - t.x) / t.k,
        y: (event.clientY - rect.top - t.y) / t.k,
      };
    }

    function hitTest(event: { clientX: number; clientY: number }): SimNode | null {
      const { x, y } = worldFromEvent(event);
      const slack = 6 / transformRef.current.k;
      let best: SimNode | null = null;
      let bestDist = Infinity;
      for (const n of simNodesRef.current) {
        if (n.x == null || n.y == null) continue;
        const dist = Math.hypot(n.x - x, n.y - y);
        if (dist <= n.r + slack && dist < bestDist) {
          best = n;
          bestDist = dist;
        }
      }
      return best;
    }

    const zoomBehavior = d3Zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_SCALE, MAX_SCALE])
      .filter((event: Event) => {
        if (event.type === "wheel") return true;
        if ((event as MouseEvent).button) return false;
        const source = event as unknown as { clientX?: number; clientY?: number };
        if (source.clientX == null) return true;
        return hitTest(source as { clientX: number; clientY: number }) === null;
      })
      .on("zoom", (event: { transform: ZoomTransform }) => {
        transformRef.current = event.transform;
        requestDrawRef.current();
      });

    zoomRef.current = zoomBehavior;
    const selection = select(canvas);
    selection.call(zoomBehavior).on("dblclick.zoom", null);

    let dragging: SimNode | null = null;
    let pointerStart: { x: number; y: number } | null = null;
    let moved = false;

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const hit = hitTest(event);
      pointerStart = { x: event.clientX, y: event.clientY };
      moved = false;
      if (!hit) return;
      dragging = hit;
      canvas!.setPointerCapture(event.pointerId);
      simRef.current?.alphaTarget(0.24).restart();
      const world = worldFromEvent(event);
      hit.fx = world.x;
      hit.fy = world.y;
    }

    function onPointerMove(event: PointerEvent) {
      if (pointerStart && !moved) {
        moved = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4;
      }
      if (dragging) {
        const world = worldFromEvent(event);
        dragging.fx = world.x;
        dragging.fy = world.y;
        requestDrawRef.current();
        return;
      }
      const hit = hitTest(event);
      const id = hit?.id ?? null;
      canvas!.style.cursor = id ? "pointer" : "grab";
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        requestDrawRef.current();
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (dragging) {
        dragging.pinned = true;
        positionsRef.current.set(dragging.id, {
          x: dragging.fx ?? dragging.x ?? 0,
          y: dragging.fy ?? dragging.y ?? 0,
          pinned: true,
        });
        simRef.current?.alphaTarget(0);
        if (canvas!.hasPointerCapture(event.pointerId)) {
          canvas!.releasePointerCapture(event.pointerId);
        }
      }
      if (!moved) {
        const hit = hitTest(event);
        onSelectRef.current(hit?.id ?? null);
      }
      dragging = null;
      pointerStart = null;
    }

    function onPointerLeave() {
      if (hoverRef.current !== null) {
        hoverRef.current = null;
        requestDrawRef.current();
      }
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);

    return () => {
      observer.disconnect();
      selection.on(".zoom", null);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  useEffect(() => {
    if (containerRef.current) paletteRef.current = readPalette(containerRef.current);
    requestDrawRef.current();
  }, [theme]);

  // ── imperative controls ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;

    function applyTransform(target: ZoomTransform, animate: boolean) {
      const zoomBehavior = zoomRef.current;
      if (!canvas || !zoomBehavior) return;
      if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);

      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!animate || reduced) {
        zoomBehavior.transform(select(canvas), target);
        return;
      }
      const start = transformRef.current;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min((now - t0) / 320, 1);
        const e = 1 - Math.pow(1 - p, 3);
        const k = start.k * Math.pow(target.k / start.k, e);
        const x = start.x + (target.x - start.x) * e;
        const y = start.y + (target.y - start.y) * e;
        zoomBehavior.transform(select(canvas), zoomIdentity.translate(x, y).scale(k));
        tweenRef.current = p < 1 ? requestAnimationFrame(step) : null;
      };
      tweenRef.current = requestAnimationFrame(step);
    }

    function fit() {
      const { width, height } = sizeRef.current;
      const simNodes = simNodesRef.current;
      if (width === 0 || simNodes.length === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        minX = Math.min(minX, n.x - n.r);
        minY = Math.min(minY, n.y - n.r);
        maxX = Math.max(maxX, n.x + n.r);
        maxY = Math.max(maxY, n.y + n.r);
      }
      if (!Number.isFinite(minX)) return;
      const pad = 56;
      const k = Math.max(
        MIN_SCALE,
        Math.min(
          2.2,
          Math.min((width - pad * 2) / (maxX - minX || 1), (height - pad * 2) / (maxY - minY || 1))
        )
      );
      applyTransform(
        zoomIdentity
          .translate(width / 2 - ((minX + maxX) / 2) * k, height / 2 - ((minY + maxY) / 2) * k)
          .scale(k),
        true
      );
    }

    fitRef.current = fit;

    handleRef.current = {
      fit,
      zoomBy(factor) {
        const { width, height } = sizeRef.current;
        const t = transformRef.current;
        const k = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.k * factor));
        const cx = width / 2;
        const cy = height / 2;
        applyTransform(
          zoomIdentity.translate(cx - ((cx - t.x) / t.k) * k, cy - ((cy - t.y) / t.k) * k).scale(k),
          true
        );
      },
      relayout() {
        for (const n of simNodesRef.current) {
          n.pinned = false;
          n.fx = null;
          n.fy = null;
          positionsRef.current.delete(n.id);
        }
        simRef.current?.alpha(0.9).restart();
      },
      focusNode(id) {
        const node = simNodesRef.current.find((n) => n.id === id);
        const { width, height } = sizeRef.current;
        if (!node || node.x == null || width === 0) return;
        const k = Math.max(transformRef.current.k, 1.15);
        applyTransform(
          zoomIdentity.translate(width / 2 - node.x * k, height / 2 - node.y! * k).scale(k),
          true
        );
      },
    };

    return () => {
      if (tweenRef.current !== null) cancelAnimationFrame(tweenRef.current);
      handleRef.current = null;
    };
  }, [handleRef]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Force-directed plot of ${nodes.length} entities and ${edges.length} relations. The entity index lists the same entities as keyboard-reachable buttons.`}
        className="block size-full touch-none"
        style={{ cursor: "grab" }}
      />
    </div>
  );
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  target: SimNode,
  palette: Palette,
  alpha: number,
  k: number,
  color?: RGB
) {
  const dx = target.x! - cx;
  const dy = target.y! - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const gap = target.r + 3.5 / k;
  const tipX = target.x! - ux * gap;
  const tipY = target.y! - uy * gap;
  const size = 5 / k;

  ctx.strokeStyle = rgba(color ?? palette.line, alpha);
  ctx.lineWidth = 1.3 / k;
  ctx.beginPath();
  ctx.moveTo(tipX - ux * size - uy * size * 0.62, tipY - uy * size + ux * size * 0.62);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - ux * size + uy * size * 0.62, tipY - uy * size - ux * size * 0.62);
  ctx.stroke();
}
