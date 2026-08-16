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
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Page, Section } from "@/components/page";
import { EmptyState, ErrorState, StatGridSkeleton, PanelSkeleton } from "@/components/states";
import { useApiClient } from "@/lib/api-client";
import { AlertTriangle, BarChart3, Gauge, Timer, Database, Share2, Plug } from "lucide-react";

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

  const toolSeries = useMemo(() => {
    if (!stats) return [];
    const days = Array.from(new Set(stats.timeseries.map((p) => p.day))).sort();
    const byTool = new Map<string, Map<string, number>>();
    for (const p of stats.timeseries) {
      const series = byTool.get(p.tool) ?? new Map<string, number>();
      series.set(p.day, (series.get(p.day) ?? 0) + p.calls);
      byTool.set(p.tool, series);
    }
    return Array.from(byTool.entries())
      .map(([tool, series]) => ({
        tool,
        total: Array.from(series.values()).reduce((sum, n) => sum + n, 0),
        points: days.map((day) => ({ day, calls: series.get(day) ?? 0 })),
      }))
      .sort((a, b) => b.total - a.total);
  }, [stats]);

  const toolPeak = useMemo(
    () => Math.max(1, ...toolSeries.flatMap((s) => s.points.map((p) => p.calls))),
    [toolSeries]
  );

  return (
    <Page
      title="Overview"
      description="Your Continuum usage across all clients"
      icon={BarChart3}
    >
      {loading ? (
        <div className="space-y-10">
          <StatGridSkeleton />
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <PanelSkeleton />
            <PanelSkeleton />
          </div>
        </div>
      ) : error ? (
        <ErrorState title="Couldn't load your stats" description={error} />
      ) : !stats || stats.total_requests === 0 ? (
        <EmptyState
          icon={Plug}
          title="No tool calls yet"
          description="Once an AI client connects with your MCP token, its activity shows up here."
          action={
            <Link
              to="/dashboard/connections"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Connect a client
            </Link>
          }
        />
      ) : (
        <div className="space-y-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <Section title="Calls (last 14 days)">
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
            </Section>

            <Section title="Calls by tool">
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
            </Section>
          </div>

          <Section title="Calls by tool over time">
            <Card surface="chrome">
              <CardContent>
                <p className="text-muted-foreground text-xs mb-4">
                  One line per tool, drawn on a shared scale so heights compare directly.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-5">
                  {toolSeries.map((series) => (
                    <div key={series.tool}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-xs truncate" title={series.tool}>
                          {series.tool}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                          {series.total}
                        </span>
                      </div>
                      <div className="h-12 mt-1.5">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={series.points} margin={{ top: 3, right: 2, bottom: 0, left: 2 }}>
                            <XAxis dataKey="day" hide />
                            <YAxis hide domain={[0, toolPeak]} />
                            <Tooltip
                              labelFormatter={(d) => (typeof d === "string" ? new Date(d).toLocaleDateString() : d)}
                              formatter={(value: number) => [value, series.tool]}
                              contentStyle={TOOLTIP_CONTENT_STYLE}
                              itemStyle={TOOLTIP_ITEM_STYLE}
                              labelStyle={TOOLTIP_LABEL_STYLE}
                            />
                            <Line
                              type="monotone"
                              dataKey="calls"
                              stroke="var(--chart-1)"
                              strokeWidth={2}
                              dot={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </Section>

          <Section title="Breakdown">
            <Card surface="chrome">
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
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
          </Section>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Section title="Memory breakdown">
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
            </Section>

            <Section title="Graph">
              <div className="grid grid-cols-2 gap-4">
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
              </div>
            </Section>
          </div>
        </div>
      )}
    </Page>
  );
}
