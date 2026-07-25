"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Connection {
  client_id: string;
  name: string | null;
  granted_at: string;
  last_used_at: string | null;
  token_count: number;
}

interface ManualToken {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

function clientLabel(conn: Connection) {
  return conn.name || `Client ${conn.client_id.slice(0, 8)}`;
}

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [manualTokens, setManualTokens] = useState<ManualToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<Connection | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch("/api/connections")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Error ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setConnections(data.connections ?? []);
        setManualTokens(data.manual_tokens ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  async function confirmDisconnect() {
    if (!pendingDisconnect) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/connections/${encodeURIComponent(pendingDisconnect.client_id)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.client_id !== pendingDisconnect.client_id));
      }
    } finally {
      setDisconnecting(false);
      setPendingDisconnect(null);
    }
  }

  const activeManualToken = manualTokens.find((t) => !t.revokedAt);

  return (
    <>
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        <section>
          <h2 className="text-xl font-semibold mb-4">Connected clients</h2>

          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : error ? (
            <p className="text-destructive text-sm">Failed to load connections: {error}</p>
          ) : connections.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No connected clients yet — connect Claude.ai or Claude Code via OAuth to see them here.
            </p>
          ) : (
            <div className="space-y-2">
              {connections.map((conn) => (
                <Card key={conn.client_id}>
                  <CardContent className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{clientLabel(conn)}</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Connected {new Date(conn.granted_at).toLocaleDateString()} · Last used{" "}
                        {conn.last_used_at ? new Date(conn.last_used_at).toLocaleString() : "never"}
                      </p>
                    </div>
                    <Button variant="destructive" size="sm" onClick={() => setPendingDisconnect(conn)}>
                      Disconnect
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {!loading && !error && manualTokens.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-4">Manual tokens</h2>
            <p className="text-muted-foreground text-sm mb-3">
              Tokens generated directly from the dashboard, not tied to an OAuth client.
            </p>
            <Card>
              <CardContent>
                {activeManualToken ? (
                  <p className="text-sm text-muted-foreground">
                    Active token: <span className="text-foreground">{activeManualToken.label}</span>{" "}
                    — created {new Date(activeManualToken.createdAt).toLocaleDateString()}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">No active manual token.</p>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </main>

      <Dialog open={pendingDisconnect !== null} onOpenChange={(open) => !open && setPendingDisconnect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect client?</DialogTitle>
            <DialogDescription>
              Disconnect &quot;{pendingDisconnect ? clientLabel(pendingDisconnect) : ""}&quot;? This
              revokes all active tokens for this client — it will need to reconnect via OAuth to
              use Continuum again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDisconnect(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDisconnect} disabled={disconnecting}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
