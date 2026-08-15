import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun, Settings as SettingsIcon } from "lucide-react";
import { useTheme } from "@/lib/theme-context";
import { useWorkspace } from "@/lib/workspace-context";
import { useApiClient } from "@/lib/api-client";
import { maskSecret } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Page } from "@/components/page";
import { DeleteAccountCard, ProfileTab } from "@/components/account-profile";
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

  useEffect(() => {
    api.get<TokenMeta[]>("/api/tokens").then(setTokens);
  }, [api]);

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
          <Button onClick={mintToken} disabled={minting}>
            {minting ? "Generating…" : activeToken ? "Rotate token" : "Generate token"}
          </Button>
          {mintError && (
            <p className="text-destructive text-xs mt-2 font-mono">{mintError}</p>
          )}
        </CardContent>
      </Card>

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

      <DeleteAccountCard />

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
    <Page
      title="Settings"
      description="Profile, preferences, and API tokens"
      icon={SettingsIcon}
      width="content"
    >

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="tokens">API Tokens</TabsTrigger>
          <TabsTrigger value="danger">Danger Zone</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileTab />
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
    </Page>
  );
}
