"use client";

import { useEffect, useRef, useState } from "react";
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
import { AlertTriangle, BarChart3, Gauge, Timer } from "lucide-react";

interface ToolStat {
  tool: string;
  calls: number;
  errors: number;
  avg_duration_ms: number;
}

interface TimeseriesPoint {
  day: string;
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
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/stats/me")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const avgLatency =
    stats && stats.per_tool.length > 0
      ? stats.per_tool.reduce((sum, t) => sum + t.avg_duration_ms * t.calls, 0) /
        Math.max(stats.total_requests, 1)
      : 0;

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
              <Card>
                <CardContent className="h-64 pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={stats.timeseries}>
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
              <Card>
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
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Breakdown</h3>
            <Card>
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
        </>
      )}
    </div>
  );
}
