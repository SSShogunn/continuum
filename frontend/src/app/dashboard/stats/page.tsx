"use client";

import { useEffect, useState } from "react";
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-muted-foreground text-xs mb-1">{label}</p>
        <p className="text-2xl font-semibold">{value}</p>
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
    <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
      <h2 className="text-xl font-semibold">Your usage</h2>

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
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total calls" value={String(stats.total_requests)} />
            <StatCard label="Error rate" value={`${(stats.error_rate * 100).toFixed(1)}%`} />
            <StatCard label="Avg latency" value={`${Math.round(avgLatency)}ms`} />
          </div>

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
                    <Line type="monotone" dataKey="calls" stroke="#22d3ee" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="errors" stroke="#f87171" strokeWidth={2} dot={false} />
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
                    <Bar dataKey="calls" fill="#a78bfa" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <table className="w-full text-sm mt-4">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="pb-2">Tool</th>
                  <th className="pb-2">Calls</th>
                  <th className="pb-2">Errors</th>
                  <th className="pb-2">Avg duration</th>
                </tr>
              </thead>
              <tbody>
                {stats.per_tool.map((t) => (
                  <tr key={t.tool} className="border-b border-border/50">
                    <td className="py-2 font-mono">{t.tool}</td>
                    <td className="py-2">{t.calls}</td>
                    <td className="py-2">{t.errors}</td>
                    <td className="py-2">{t.avg_duration_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
