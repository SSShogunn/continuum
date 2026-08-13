import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { useApiClient } from "@/lib/api-client";

export default function OAuthConnectPage() {
  const { isSignedIn, isLoaded, user } = useUser();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const api = useApiClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const state = params.get("state") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  const codeChallengeMethod = params.get("code_challenge_method") ?? "";

  const pkceError = !codeChallenge
    ? "This client did not send a PKCE code_challenge, which Continuum requires for every connection."
    : codeChallengeMethod !== "S256"
      ? `This client asked for an unsupported PKCE method (${codeChallengeMethod || "none"}). Only S256 is accepted.`
      : null;

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      navigate(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
    }
  }, [isLoaded, isSignedIn, navigate]);

  async function allow() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<{ redirect_url: string }>("/api/oauth/complete", {
        client_id: clientId,
        redirect_uri: redirectUri,
        state: state || null,
        code_challenge: codeChallenge || null,
        code_challenge_method: codeChallengeMethod || null,
      });
      window.location.href = data.redirect_url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <AuthShell tab="AUTHORIZE CLIENT" stamp={"PENDING\nREVIEW"}>
        <p className="font-mono text-sm text-muted-foreground">Loading…</p>
      </AuthShell>
    );
  }

  if (pkceError) {
    return (
      <AuthShell tab="AUTHORIZE CLIENT" stamp={"REQUEST\nREJECTED"}>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-foreground">
            <ShieldAlert className="size-4 text-destructive" />
            <h1 className="font-heading text-lg font-semibold tracking-tight">
              Cannot authorize this client
            </h1>
          </div>
          <p className="font-mono text-sm text-muted-foreground">{pkceError}</p>
          <p className="font-mono text-xs text-muted-foreground">
            Nothing was authorized. Reconnect using a client that supports PKCE.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell tab="AUTHORIZE CLIENT" stamp={"PENDING\nREVIEW"}>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="size-4 text-primary" />
            <h1 className="font-heading text-lg font-semibold tracking-tight">Connect to Continuum</h1>
          </div>
          <p className="font-mono text-sm text-muted-foreground">
            An MCP client is requesting access to your Continuum memory.
          </p>
        </div>

        <div className="space-y-1.5 rounded-[var(--radius)] border border-border bg-background/60 px-4 py-3 font-mono text-sm">
          <p>
            <span className="text-muted-foreground">Signed in as </span>
            <span className="text-foreground">{user?.primaryEmailAddress?.emailAddress}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Redirect to </span>
            <span className="break-all text-xs text-muted-foreground">{redirectUri}</span>
          </p>
        </div>

        <div className="font-mono text-sm text-muted-foreground">
          <p className="mb-2 text-[0.68rem] uppercase tracking-[0.06em]">This will allow the client to</p>
          <ul className="list-inside list-disc space-y-1 text-foreground/90">
            <li>Read and write your memory entries</li>
            <li>Use Continuum tools on your behalf</li>
          </ul>
        </div>

        {error && (
          <p className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <Button onClick={allow} disabled={loading} className="flex-1 font-mono">
            {loading ? "Authorizing…" : "Allow access"}
          </Button>
          <Button onClick={() => window.close()} variant="outline" className="flex-1 font-mono">
            Deny
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
