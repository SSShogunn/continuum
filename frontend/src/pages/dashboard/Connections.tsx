import { useEffect, useState } from "react";
import { useApiClient } from "@/lib/api-client";
import { useOnboarding } from "@/lib/onboarding-context";
import { maskSecret } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Page, Section } from "@/components/page";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, Plug } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Connection {
  client_id: string;
  name: string | null;
  granted_at: string;
  last_used_at: string | null;
  token_count: number;
}

const MCP_URL = import.meta.env.VITE_CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org";
const CLAUDE_CODE_CONNECT_COMMAND = `claude mcp add --transport http continuum ${MCP_URL}/mcp`;

type InstallPlatform = "unix" | "windows";

function detectPlatform(): InstallPlatform {
  const hint =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.userAgent;
  return /win/i.test(hint) ? "windows" : "unix";
}

function GettingStarted() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(CLAUDE_CODE_CONNECT_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Section title="Getting started">
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
    </Section>
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
  const api = useApiClient();
  const { refresh: refreshOnboarding } = useOnboarding();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [manualTokens, setManualTokens] = useState<ManualToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<Connection | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const [hookEnabled, setHookEnabled] = useState<boolean | null>(null);
  const [hookToggling, setHookToggling] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [installPlatform, setInstallPlatform] = useState<InstallPlatform>(detectPlatform);
  const [installCopied, setInstallCopied] = useState(false);

  useEffect(() => {
    api
      .get<{ connections: Connection[]; manual_tokens: ManualToken[] }>("/api/connections")
      .then((data) => {
        setConnections(data.connections ?? []);
        setManualTokens(data.manual_tokens ?? []);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
    api
      .get<{ hook_context_enabled: boolean }>("/api/account/hook-settings")
      .then((data) => setHookEnabled(data.hook_context_enabled));
  }, [api]);

  async function confirmDisconnect() {
    if (!pendingDisconnect) return;
    setDisconnecting(true);
    try {
      await api.delete(`/api/connections/${encodeURIComponent(pendingDisconnect.client_id)}`);
      setConnections((prev) => prev.filter((c) => c.client_id !== pendingDisconnect.client_id));
      refreshOnboarding();
    } catch {
      // no-op — connection stays in the list if the disconnect failed
    } finally {
      setDisconnecting(false);
      setPendingDisconnect(null);
    }
  }

  async function toggleHookEnabled(next: boolean) {
    setHookToggling(true);
    const prev = hookEnabled;
    setHookEnabled(next);
    try {
      await api.post("/api/account/hook-settings", { hook_context_enabled: next });
    } catch {
      setHookEnabled(prev);
    } finally {
      setHookToggling(false);
    }
  }

  async function mintToken() {
    setMinting(true);
    setMintError(null);
    try {
      const data = await api.post<{ token: string; id: string; label: string; createdAt: string }>(
        "/api/tokens",
        { label: "default" }
      );
      setNewToken(data.token);
      setManualTokens((prev) =>
        ([{ id: data.id, label: data.label, createdAt: data.createdAt, revokedAt: null, lastUsedAt: null }] as ManualToken[]).concat(
          prev.map((t) => ({ ...t, revokedAt: t.revokedAt ?? new Date().toISOString() }))
        )
      );
      refreshOnboarding();
    } catch (e) {
      setMintError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }

  function installCommand(os: InstallPlatform, token: string) {
    return os === "windows"
      ? `$env:CONTINUUM_TOKEN="${token}"; irm ${MCP_URL}/install_hook.js | node -`
      : `curl -fsSL ${MCP_URL}/install_hook.js | CONTINUUM_TOKEN=${token} node`;
  }

  async function copyInstallCommand() {
    if (!newToken) return;
    await navigator.clipboard.writeText(installCommand(installPlatform, newToken));
    setInstallCopied(true);
    setTimeout(() => setInstallCopied(false), 2000);
  }

  const activeManualToken = manualTokens.find((t) => !t.revokedAt);

  return (
    <>
      <Page
        title="Connections"
        description="Connect MCP clients and manage access tokens"
        icon={Plug}
        width="narrow"
      >
        <div className="space-y-10">
        <GettingStarted />

        <Section title="Auto-context">
          <Card>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-muted-foreground text-sm">
                  Adds relevant memory to every message automatically, so you don&apos;t have to
                  ask for it.
                </p>
                <Switch
                  aria-label="Auto-context"
                  checked={hookEnabled ?? true}
                  disabled={hookEnabled === null || hookToggling}
                  onCheckedChange={toggleHookEnabled}
                />
              </div>
              <Collapsible open={setupOpen} onOpenChange={setSetupOpen}>
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 text-left text-sm font-medium hover:text-primary">
                  Set up for Claude Code
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-3 pt-3">
                    <Separator />
                    {newToken ? (
                      <Tabs
                        value={installPlatform}
                        onValueChange={(value) => {
                          setInstallPlatform(value as InstallPlatform);
                          setInstallCopied(false);
                        }}
                        className="space-y-3"
                      >
                        <TabsList>
                          <TabsTrigger value="unix">macOS / Linux</TabsTrigger>
                          <TabsTrigger value="windows">Windows</TabsTrigger>
                        </TabsList>
                        {(["unix", "windows"] as const).map((os) => (
                          <TabsContent key={os} value={os} className="space-y-3">
                            <code className="block text-xs break-all rounded border border-border bg-muted/40 p-3 font-mono">
                              {installCommand(os, maskSecret(newToken))}
                            </code>
                            <Button onClick={copyInstallCommand} variant="outline" size="sm">
                              {installCopied ? "Copied!" : "Copy command"}
                            </Button>
                          </TabsContent>
                        ))}
                        <p className="text-muted-foreground text-xs">
                          {installPlatform === "windows"
                            ? "Run it in PowerShell. Requires Node 18 or newer."
                            : "Run it in a terminal. Requires Node 18 or newer."}{" "}
                          Use the copy button — your token is hidden above.
                        </p>
                      </Tabs>
                    ) : (
                      <div className="space-y-2">
                        <Button onClick={mintToken} disabled={minting} variant="outline" size="sm">
                          {minting ? "Generating…" : "Generate a token to get the install command"}
                        </Button>
                        {mintError && (
                          <p className="text-destructive text-xs font-mono">{mintError}</p>
                        )}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </CardContent>
          </Card>
        </Section>

        <Section title="Connected clients">

          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-52" />
            </div>
          ) : error ? (
            <ErrorState title="Couldn't load connections" description={error} className="py-10" />
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
        </Section>

        {!loading && !error && manualTokens.length > 0 && (
          <Section title="Manual tokens">
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
          </Section>
        )}
        </div>
      </Page>

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
