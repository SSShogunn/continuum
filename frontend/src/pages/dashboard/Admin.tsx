import { useEffect, useState } from "react";
import { ApiError, useApiClient } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";

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

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">Loading…</div>
    );
  }

  if (forbidden) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center flex-col gap-4">
        <p className="text-muted-foreground">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-6 py-10 space-y-12">
      {/* Stats */}
      {stats && (
        <section>
          <h2 className="text-xl font-semibold mb-4">Usage stats (global)</h2>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent>
                <p className="text-muted-foreground text-xs mb-1">Total requests</p>
                <p className="text-2xl font-semibold">{stats.total_requests}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-muted-foreground text-xs mb-1">Total errors</p>
                <p className="text-2xl font-semibold">{stats.total_errors}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent>
                <p className="text-muted-foreground text-xs mb-1">Error rate</p>
                <p className="text-2xl font-semibold">{(stats.error_rate * 100).toFixed(1)}%</p>
              </CardContent>
            </Card>
          </div>
          {stats.per_tool.length > 0 && (
            <table className="w-full text-sm">
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
          )}
        </section>
      )}

      {/* Users */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Users ({users.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b">
              <th className="pb-2">Email</th>
              <th className="pb-2">Admin</th>
              <th className="pb-2">Joined</th>
              <th className="pb-2">Last sign in</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/50">
                <td className="py-2">{u.email ?? "—"}</td>
                <td className="py-2">{u.isAdmin ? "✓" : "—"}</td>
                <td className="py-2 text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="py-2 text-muted-foreground">
                  {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
