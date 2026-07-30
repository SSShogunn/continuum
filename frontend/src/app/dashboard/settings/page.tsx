"use client";

import { useEffect, useState } from "react";
import { UserProfile } from "@clerk/nextjs";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme-context";
import { useWorkspace } from "@/lib/workspace-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
    <div className="space-y-8 mt-4">
      <section>
        <h3 className="text-sm font-medium mb-3">Theme</h3>
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
      </section>

      <section>
        <h3 className="text-sm font-medium mb-3">Default workspace</h3>
        <p className="text-muted-foreground text-xs mb-3">
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
      </section>
    </div>
  );
}

function TokensTab() {
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then(setTokens);
  }, []);

  async function mintToken() {
    setMinting(true);
    setMintError(null);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "default" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMintError(`Error ${res.status}: ${data.detail ?? JSON.stringify(data)}`);
        return;
      }
      setNewToken(data.token);
      setTokens((prev) =>
        ([{ id: data.id, label: data.label, createdAt: data.createdAt, revokedAt: null, lastUsedAt: null }] as TokenMeta[]).concat(
          prev.map((t) => ({ ...t, revokedAt: t.revokedAt ?? new Date().toISOString() }))
        )
      );
    } catch (e) {
      setMintError(String(e));
    } finally {
      setMinting(false);
    }
  }

  async function revokeToken(id: string) {
    setRevokingId(id);
    try {
      const res = await fetch(`/api/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) {
        setTokens((prev) =>
          prev.map((t) => (t.id === id ? { ...t, revokedAt: new Date().toISOString() } : t))
        );
      }
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
      {newToken ? (
        <Card className="border-yellow-700 bg-yellow-900/20">
          <CardContent className="space-y-3">
            <p className="text-yellow-300 text-sm font-medium">
              Copy this token now — it will not be shown again.
            </p>
            <code className="block text-xs break-all bg-black/30 rounded p-3 font-mono">
              {newToken}
            </code>
            <Button onClick={copy} className="bg-yellow-600 hover:bg-yellow-500 text-white">
              {copied ? "Copied!" : "Copy to clipboard"}
            </Button>
          </CardContent>
        </Card>
      ) : (
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
      )}

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
      const res = await fetch("/api/memory/delete-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail ?? `Error ${res.status}`);
        return;
      }
      setConfirmOpen(false);
      setConfirmText("");
      setWorkspace("default");
      setWorkspaces(workspaces.filter((w) => w !== workspace));
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
  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <h2 className="text-xl font-semibold mb-6">Settings</h2>

      <Tabs defaultValue="profile">
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
