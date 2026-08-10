import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  AreaChart,
  Area,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { relativeTime, stringToHue } from "@/lib/utils";
import { useApiClient } from "@/lib/api-client";
import { AlertTriangle, BarChart3, Gauge, Timer, Database, Share2 } from "lucide-react";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

interface ToolStat {
  tool: string;
  calls: number;
  errors: number;
  avg_duration_ms: number;
}

interface TimeseriesPoint {
  day: string;
  tool: string;
  calls: number;
  errors: number;
}

interface Stats {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  per_tool: ToolStat[];
  timeseries: TimeseriesPoint[];
}

interface ActivityRow {
  tool: string;
  status: string;
  duration_ms: number;
  timestamp: string;
  arguments: string | null;
  error: string | null;
}

interface MemoryStats {
  total_entries: number;
  by_type: { type: string; count: number }[];
  by_workspace: { workspace: string; count: number }[];
  created_per_day: { day: string; count: number }[];
}

interface GraphStats {
  node_count: number;
  edge_count: number;
  by_type: { type: string; count: number }[];
  top_entities: { name: string; type: string; degree: number }[];
}

const TOOLTIP_CONTENT_STYLE = {
  fontSize: 12,
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
};
const TOOLTIP_ITEM_STYLE = { color: "var(--popover-foreground)" };
const TOOLTIP_LABEL_STYLE = { color: "var(--popover-foreground)" };

function useCountUp(value: number, duration = 500) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const from = prevRef.current;
    const to = value;
    if (from === to) return;
    let start: number | null = null;
    let raf: number;
    function step(ts: number) {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(step);
      else prevRef.current = to;
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}

function StatCard({
  label,
  value,
  suffix = "",
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  suffix?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}) {
  const display = useCountUp(value);
  return (
    <Card>
      <CardContent className="flex items-start justify-between">
        <div>
          <p className="text-muted-foreground text-xs mb-1.5">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {display}
            {suffix}
          </p>
        </div>
        <div className={`flex size-8 items-center justify-center rounded-md shrink-0 ${tone}`}>
          <Icon className="size-4" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function StatsPage() {
  const api = useApiClient();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentErrors, setRecentErrors] = useState<ActivityRow[]>([]);
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null);

  useEffect(() => {
    api
      .get<Stats>("/api/stats/me")
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });

    api
      .get<{ activity: ActivityRow[] }>("/api/stats/activity?limit=5&status=error")
      .then((data) => setRecentErrors(data.activity ?? []))
      .catch(() => {});

    api
      .get<MemoryStats>("/api/memory/stats")
      .then((data) => setMemoryStats(data))
      .catch(() => {});

    api
      .get<GraphStats>("/api/memory/graph/stats")
      .then((data) => setGraphStats(data))
      .catch(() => {});
  }, [api]);

  const avgLatency =
    stats && stats.per_tool.length > 0
      ? stats.per_tool.reduce((sum, t) => sum + t.avg_duration_ms * t.calls, 0) /
        Math.max(stats.total_requests, 1)
      : 0;

  const tools = useMemo(
    () => Array.from(new Set(stats?.timeseries.map((p) => p.tool) ?? [])).sort(),
    [stats]
  );

  const dailyTotals = useMemo(() => {
    if (!stats) return [];
    const byDay = new Map<string, { day: string; calls: number; errors: number }>();
    for (const p of stats.timeseries) {
      const entry = byDay.get(p.day) ?? { day: p.day, calls: 0, errors: 0 };
      entry.calls += p.calls;
      entry.errors += p.errors;
      byDay.set(p.day, entry);
    }
    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [stats]);

  const stackedByDay = useMemo(() => {
    if (!stats) return [];
    const byDay = new Map<string, Record<string, number | string>>();
    for (const p of stats.timeseries) {
      const entry = byDay.get(p.day) ?? { day: p.day };
      entry[p.tool] = p.calls;
      byDay.set(p.day, entry);
    }
    return Array.from(byDay.values()).sort((a, b) =>
      (a.day as string).localeCompare(b.day as string)
    );
  }, [stats]);

  const mostConnected = graphStats?.top_entities?.[0];

  return (
    <div className="px-6 py-6 space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <BarChart3 className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Overview</h1>
            <p className="text-xs text-muted-foreground">Your Continuum usage across all clients</p>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : error ? (
        <p className="text-destructive text-sm">Failed to load stats: {error}</p>
      ) : !stats || stats.total_requests === 0 ? (
        <p className="text-muted-foreground text-sm">
          No tool calls yet — use your MCP token with an AI client to see activity here.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              label="Total calls"
              value={stats.total_requests}
              icon={Gauge}
              tone="bg-chart-1/15 text-chart-1"
            />
            <StatCard
              label="Error rate"
              value={Number((stats.error_rate * 100).toFixed(1))}
              suffix="%"
              icon={AlertTriangle}
              tone="bg-chart-4/15 text-chart-4"
            />
            <StatCard
              label="Avg latency"
              value={Math.round(avgLatency)}
              suffix="ms"
              icon={Timer}
              tone="bg-chart-2/15 text-chart-2"
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Calls (last 14 days)</h3>
              <Card surface="chrome">
                <CardContent className="h-64 pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyTotals}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis
                        dataKey="day"
                        tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                      <Tooltip
                        labelFormatter={(d) => (typeof d === "string" ? new Date(d).toLocaleDateString() : d)}
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                      />
                      <Line type="monotone" dataKey="calls" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="errors" stroke="var(--chart-4)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>

            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Calls by tool</h3>
              <Card surface="chrome">
                <CardContent className="h-64 pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.per_tool} layout="vertical" margin={{ left: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="tool" tick={{ fontSize: 11 }} width={140} />
                      <Tooltip
                        contentStyle={TOOLTIP_CONTENT_STYLE}
                        itemStyle={TOOLTIP_ITEM_STYLE}
                        labelStyle={TOOLTIP_LABEL_STYLE}
                      />
                      <Bar dataKey="calls" fill="var(--chart-3)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </section>
          </div>

          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Calls by tool over time</h3>
            <Card surface="chrome">
              <CardContent className="h-64 pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stackedByDay}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis
                      dataKey="day"
                      tickFormatter={(d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(d) => (typeof d === "string" ? new Date(d).toLocaleDateString() : d)}
                      contentStyle={TOOLTIP_CONTENT_STYLE}
                      itemStyle={TOOLTIP_ITEM_STYLE}
                      labelStyle={TOOLTIP_LABEL_STYLE}
                    />
                    {tools.map((tool, i) => (
                      <Area
                        key={tool}
                        type="monotone"
                        dataKey={tool}
                        stackId="1"
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                        fillOpacity={0.5}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </section>

          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Breakdown</h3>
            <Card surface="chrome">
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="pb-2 font-medium">Tool</th>
                      <th className="pb-2 font-medium">Calls</th>
                      <th className="pb-2 font-medium">Errors</th>
                      <th className="pb-2 font-medium">Avg duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.per_tool.map((t) => (
                      <tr key={t.tool} className="border-b border-border/50 last:border-0">
                        <td className="py-2 font-mono">{t.tool}</td>
                        <td className="py-2">{t.calls}</td>
                        <td className="py-2">{t.errors}</td>
                        <td className="py-2">{t.avg_duration_ms}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-muted-foreground">Recent errors</h3>
                <Link to="/dashboard/activity" className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                  View all
                </Link>
              </div>
              <Card surface="chrome">
                <CardContent className="p-0">
                  {recentErrors.length === 0 ? (
                    <p className="text-muted-foreground text-sm p-4">No recent errors.</p>
                  ) : (
                    recentErrors.map((e, i) => (
                      <Link
                        key={`${e.timestamp}-${i}`}
                        to="/dashboard/activity"
                        className="relative flex items-center gap-3 pl-4 pr-3 py-2.5 border-b last:border-b-0 hover:bg-accent/50 transition-colors"
                      >
                        <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-chart-4" />
                        <span className="font-mono text-xs truncate flex-1 min-w-0">{e.tool}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[40%]">
                          {e.error ?? "—"}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">{relativeTime(e.timestamp)}</span>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            </section>

            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Memory breakdown</h3>
              <Card surface="chrome">
                <CardContent className="space-y-3">
                  {!memoryStats || memoryStats.total_entries === 0 ? (
                    <p className="text-muted-foreground text-sm">No memory entries yet.</p>
                  ) : (
                    <>
                      <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={memoryStats.by_type} layout="vertical" margin={{ left: 24 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                            <YAxis type="category" dataKey="type" tick={{ fontSize: 11 }} width={100} />
                            <Tooltip
                              contentStyle={TOOLTIP_CONTENT_STYLE}
                              itemStyle={TOOLTIP_ITEM_STYLE}
                              labelStyle={TOOLTIP_LABEL_STYLE}
                            />
                            <Bar dataKey="count" fill="var(--chart-1)" radius={[0, 4, 4, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      {memoryStats.by_workspace.length > 1 && (
                        <div className="pt-2 border-t space-y-1.5">
                          <p className="text-xs text-muted-foreground">By workspace</p>
                          {memoryStats.by_workspace.map((w) => (
                            <div key={w.workspace} className="flex items-center justify-between text-xs">
                              <span className="font-mono">{w.workspace}</span>
                              <span className="text-muted-foreground">{w.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>

          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Graph</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Entities"
                value={graphStats?.node_count ?? 0}
                icon={Database}
                tone="bg-chart-1/15 text-chart-1"
              />
              <StatCard
                label="Edges"
                value={graphStats?.edge_count ?? 0}
                icon={Share2}
                tone="bg-chart-3/15 text-chart-3"
              />
              <Card>
                <CardContent className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs mb-1.5">Most connected</p>
                    <p className="text-sm font-semibold truncate">
                      {mostConnected ? mostConnected.name : "—"}
                    </p>
                    {mostConnected && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {mostConnected.degree} connection{mostConnected.degree === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                  <div
                    className="flex size-8 items-center justify-center rounded-md shrink-0"
                    style={{
                      backgroundColor: mostConnected ? `oklch(0.7 0.16 ${stringToHue(mostConnected.type)} / 0.15)` : undefined,
                      color: mostConnected ? `oklch(0.55 0.16 ${stringToHue(mostConnected.type)})` : undefined,
                    }}
                  >
                    <Share2 className="size-4" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
