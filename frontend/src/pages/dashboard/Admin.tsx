import { useEffect, useState } from "react";
import { ApiError, useApiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Gauge, Percent, ShieldCheck, Users } from "lucide-react";

interface User {
  id: string;
  email: string | null;
  isAdmin: boolean;
  createdAt: number;
  lastSignInAt: number | null;
}

interface ToolStat {
  tool: string;
  calls: number;
  errors: number;
  avg_duration_ms: number;
}

interface Stats {
  total_requests: number;
  total_errors: number;
  error_rate: number;
  per_tool: ToolStat[];
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
  return (
    <Card>
      <CardContent className="flex items-start justify-between">
        <div>
          <p className="text-muted-foreground text-xs mb-1.5">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">
            {value}
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

export default function AdminPage() {
  const api = useApiClient();
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get<User[]>("/api/admin/users"), api.get<Stats>("/api/admin/stats")])
      .then(([usersData, statsData]) => {
        setUsers(usersData);
        setStats(statsData);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) {
          setForbidden(true);
        }
        setLoading(false);
      });
  }, [api]);

  return (
    <div className="px-6 py-6 space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ShieldCheck className="size-4" />
        </div>
        <div>
          <h1 className="text-sm font-semibold leading-tight">Admin</h1>
          <p className="text-xs text-muted-foreground">Global usage stats and account list</p>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : forbidden ? (
        <p className="text-muted-foreground text-sm">You don&apos;t have permission to view this page.</p>
      ) : (
        <>
          {stats && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard
                  label="Total requests"
                  value={stats.total_requests}
                  icon={Gauge}
                  tone="bg-chart-1/15 text-chart-1"
                />
                <StatCard
                  label="Total errors"
                  value={stats.total_errors}
                  icon={AlertTriangle}
                  tone="bg-chart-4/15 text-chart-4"
                />
                <StatCard
                  label="Error rate"
                  value={Number((stats.error_rate * 100).toFixed(1))}
                  suffix="%"
                  icon={Percent}
                  tone="bg-chart-3/15 text-chart-3"
                />
              </div>

              {stats.per_tool.length > 0 && (
                <section>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3">Breakdown by tool</h3>
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
                              <td className="py-2.5 font-mono">{t.tool}</td>
                              <td className="py-2.5">{t.calls}</td>
                              <td className="py-2.5">{t.errors}</td>
                              <td className="py-2.5">{t.avg_duration_ms}ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                </section>
              )}
            </>
          )}

          <section>
            <h3 className="text-sm font-medium text-muted-foreground mb-3">Users ({users.length})</h3>
            {users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Users className="size-5" />
                </div>
                <p className="text-muted-foreground text-sm">No users yet.</p>
              </div>
            ) : (
              <Card surface="chrome">
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="pb-2 font-medium">Email</th>
                        <th className="pb-2 font-medium">Role</th>
                        <th className="pb-2 font-medium">Joined</th>
                        <th className="pb-2 font-medium">Last sign in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-b border-border/50 last:border-0">
                          <td className="py-2.5 font-medium">{u.email ?? "—"}</td>
                          <td className="py-2.5">
                            {u.isAdmin ? (
                              <Badge>Admin</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2.5 text-muted-foreground">
                            {new Date(u.createdAt).toLocaleDateString()}
                          </td>
                          <td className="py-2.5 text-muted-foreground">
                            {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
