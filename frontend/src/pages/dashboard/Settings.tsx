import { useEffect, useState } from "react";
import { UserProfile } from "@clerk/clerk-react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme-context";
import { useWorkspace } from "@/lib/workspace-context";
import { useApiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TokenMeta {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

const MCP_URL = import.meta.env.VITE_CONTINUUM_MCP_URL || "https://continuum-mcp.sshogunn.org";

function maskSecret(value: string, prefixLen = 8, suffixLen = 4): string {
  if (value.length <= prefixLen + suffixLen) return value;
  return `${value.slice(0, prefixLen)}${"•".repeat(12)}${value.slice(-suffixLen)}`;
}

const THEME_OPTIONS = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System", icon: Monitor },
];

function PreferencesTab() {
  const { theme, setTheme } = useTheme();
  const { workspace, workspaces, setWorkspace } = useWorkspace();

  return (
    <div className="grid gap-4 mt-4 sm:grid-cols-2">
      <Card>
        <CardContent className="space-y-3">
          <h3 className="text-sm font-medium">Theme</h3>
          <div className="flex gap-2">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant={theme === value ? "default" : "outline"}
                onClick={() => setTheme(value)}
                className="gap-1.5"
              >
                <Icon className="size-3.5" />
                {label}
                {theme === value && <Check className="size-3.5" />}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h3 className="text-sm font-medium">Default workspace</h3>
          <p className="text-muted-foreground text-xs">
            The workspace selected here is remembered across sessions.
          </p>
          <div className="flex flex-wrap gap-2">
            {workspaces.map((ws) => (
              <Button
                key={ws}
                variant={workspace === ws ? "default" : "outline"}
                size="sm"
                onClick={() => setWorkspace(ws)}
              >
                {ws}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TokensTab() {
  const api = useApiClient();
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [hookEnabled, setHookEnabled] = useState<boolean | null>(null);
  const [hookToggling, setHookToggling] = useState(false);

  useEffect(() => {
    api.get<TokenMeta[]>("/api/tokens").then(setTokens);
    api
      .get<{ hook_context_enabled: boolean }>("/api/account/hook-settings")
      .then((data) => setHookEnabled(data.hook_context_enabled));
  }, [api]);

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
      setTokens((prev) =>
        ([{ id: data.id, label: data.label, createdAt: data.createdAt, revokedAt: null, lastUsedAt: null }] as TokenMeta[]).concat(
          prev.map((t) => ({ ...t, revokedAt: t.revokedAt ?? new Date().toISOString() }))
        )
      );
    } catch (e) {
      setMintError(e instanceof Error ? e.message : String(e));
    } finally {
      setMinting(false);
    }
  }

  async function revokeToken(id: string) {
    setRevokingId(id);
    try {
      await api.delete(`/api/tokens/${encodeURIComponent(id)}`);
      setTokens((prev) =>
        prev.map((t) => (t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t))
      );
    } catch {
      // no-op — token stays active in the list if the revoke failed
    } finally {
      setRevokingId(null);
    }
  }

  async function copy() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const [installOpen, setInstallOpen] = useState(false);
  const [installCopied, setInstallCopied] = useState(false);
  const installCommand = newToken
    ? `curl -fsSL ${MCP_URL}/install-hook.sh | CONTINUUM_TOKEN=${newToken} bash`
    : "";
  const installCommandDisplay = newToken
    ? `curl -fsSL ${MCP_URL}/install-hook.sh | CONTINUUM_TOKEN=${maskSecret(newToken)} bash`
    : "";

  async function copyInstallCommand() {
    if (!installCommand) return;
    await navigator.clipboard.writeText(installCommand);
    setInstallCopied(true);
    setTimeout(() => setInstallCopied(false), 2000);
  }

  const activeToken = tokens.find((t) => !t.revokedAt);

  return (
    <div className="space-y-6 mt-4">
      {newToken && (
        <Card className="border-accent bg-accent/25">
          <CardContent className="space-y-3">
            <p className="text-accent-foreground text-sm font-medium">
              Copy this token now — it won&apos;t be shown again after you leave this page.
            </p>
            <code className="block text-xs break-all rounded border border-border bg-background/60 p-3 font-mono">
              {maskSecret(newToken)}
            </code>
            <Button onClick={copy}>{copied ? "Copied!" : "Copy to clipboard"}</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3">
          {activeToken ? (
            <p className="text-sm text-muted-foreground">
              Active token: <span className="text-foreground">{activeToken.label}</span>{" "}
              — created {new Date(activeToken.createdAt).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No active token. Generate one to use Continuum with MCP clients.</p>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={mintToken} disabled={minting}>
              {minting ? "Generating…" : activeToken ? "Rotate token" : "Generate token"}
            </Button>
            <Button variant="outline" onClick={() => setInstallOpen(true)}>
              Set up auto-context for Claude Code
            </Button>
          </div>
          {mintError && (
            <p className="text-destructive text-xs mt-2 font-mono">{mintError}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Auto-context injection</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              Lets the Claude Code hook and other connected clients pull relevant memory into
              every message automatically. Turn off to stop all automatic retrieval for your
              account.
            </p>
          </div>
          <Switch
            checked={hookEnabled ?? true}
            disabled={hookEnabled === null || hookToggling}
            onCheckedChange={toggleHookEnabled}
          />
        </CardContent>
      </Card>

      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Auto-context for Claude Code</DialogTitle>
            <DialogDescription>
              Injects relevant memory into every message automatically, instead of relying on
              Claude to call memory_search itself — scoped to whichever project workspace Claude
              has already picked for the current directory (falling back to &quot;default&quot;),
              plus your default workspace so cross-project facts still surface.
            </DialogDescription>
          </DialogHeader>
          {newToken ? (
            <div className="space-y-3">
              <code className="block text-xs break-all rounded border border-border bg-muted/40 p-3 font-mono">
                {installCommandDisplay}
              </code>
              <Button onClick={copyInstallCommand} variant="outline" size="sm">
                {installCopied ? "Copied!" : "Copy command"}
              </Button>
              <p className="text-muted-foreground text-xs">
                The token above is masked on screen — the copy button places the full working
                command on your clipboard. Run it in a terminal.
              </p>
            </div>
          ) : (
            <Button onClick={mintToken} disabled={minting} variant="outline" size="sm">
              {minting ? "Generating…" : "Generate a token to get the install command"}
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {tokens.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-3">Token history</h3>
          <div className="space-y-2">
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-3 py-2 rounded-md border text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{t.label}</span>
                    <Badge variant={t.revokedAt ? "secondary" : "default"}>
                      {t.revokedAt ? "revoked" : "active"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    Created {new Date(t.createdAt).toLocaleDateString()}
                    {t.lastUsedAt && ` · last used ${new Date(t.lastUsedAt).toLocaleDateString()}`}
                  </p>
                </div>
                {!t.revokedAt && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => revokeToken(t.id)}
                    disabled={revokingId === t.id}
                  >
                    {revokingId === t.id ? "Revoking…" : "Revoke"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DangerZoneTab() {
  const api = useApiClient();
  const { workspace, workspaces, setWorkspace, setWorkspaces } = useWorkspace();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDefault = workspace === "default";

  async function deleteWorkspace() {
    setDeleting(true);
    setError(null);
    try {
      await api.post("/api/memory/delete-workspace", { workspace });
      setConfirmOpen(false);
      setConfirmText("");
      setWorkspace("default");
      setWorkspaces(workspaces.filter((w) => w !== workspace));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6 mt-4">
      <Card className="border-destructive/40">
        <CardContent className="space-y-3">
          <h3 className="text-sm font-medium">Delete workspace</h3>
          <p className="text-muted-foreground text-xs">
            Permanently deletes every memory entry and knowledge-graph fact in the{" "}
            <span className="text-foreground">&quot;{workspace}&quot;</span> workspace. This cannot
            be undone. The default workspace cannot be deleted.
          </p>
          <Button variant="destructive" disabled={isDefault} onClick={() => setConfirmOpen(true)}>
            Delete &quot;{workspace}&quot;
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <p className="text-muted-foreground text-xs">
            To delete your account entirely, use the account portal in the{" "}
            <span className="text-foreground">Profile</span> tab.
          </p>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={(open) => { setConfirmOpen(open); if (!open) setConfirmText(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workspace?</DialogTitle>
            <DialogDescription>
              Type <span className="font-mono text-foreground">{workspace}</span> to confirm. This
              permanently deletes all memories and graph data in this workspace.
            </DialogDescription>
          </DialogHeader>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={workspace} />
          {error && <p className="text-destructive text-xs font-mono">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={confirmText !== workspace || deleting}
              onClick={deleteWorkspace}
            >
              {deleting ? "Deleting…" : "Delete workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState("profile");

  return (
    <main className="max-w-4xl mx-auto px-6 py-10">
      <h2 className="text-xl font-semibold mb-6">Settings</h2>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="tokens">API Tokens</TabsTrigger>
          <TabsTrigger value="danger">Danger Zone</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <div className="mt-4">
            <UserProfile
              routing="hash"
              appearance={{ elements: { rootBox: "w-full", cardBox: "w-full shadow-none" } }}
            />
          </div>
        </TabsContent>

        <TabsContent value="preferences">
          <PreferencesTab />
        </TabsContent>

        <TabsContent value="tokens">
          <TokensTab />
        </TabsContent>

        <TabsContent value="danger">
          <DangerZoneTab />
        </TabsContent>
      </Tabs>
    </main>
  );
}
