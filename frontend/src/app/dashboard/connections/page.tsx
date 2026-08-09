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

const MCP_URL =
  process.env.NEXT_PUBLIC_CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org";
const CLAUDE_CODE_CONNECT_COMMAND = `claude mcp add --transport http continuum ${MCP_URL}/mcp`;

function GettingStarted() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(CLAUDE_CODE_CONNECT_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section>
      <h2 className="text-xl font-semibold mb-4">Getting started</h2>
      <div className="space-y-3">
        <Card>
          <CardContent className="space-y-2">
            <p className="font-medium text-sm">Claude Code</p>
            <p className="text-muted-foreground text-xs">
              Run this in a terminal — it opens a browser to sign in and connect:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs break-all bg-muted rounded p-3 font-mono">
                {CLAUDE_CODE_CONNECT_COMMAND}
              </code>
              <Button onClick={copy} variant="outline" size="sm">
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1">
            <p className="font-medium text-sm">Claude.ai</p>
            <p className="text-muted-foreground text-xs">
              Settings → Connectors → Add custom connector → paste{" "}
              <code className="text-foreground">{MCP_URL}/mcp</code>
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
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
        <GettingStarted />

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
                        {conn.last_used_at ? new Date(conn.last_used_at).toLocaleString() : "never"} ·{" "}
                        {conn.token_count} token{conn.token_count === 1 ? "" : "s"}
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
