import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useUser } from "@clerk/react";
import { ShieldCheck, ShieldX, TerminalSquare } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiClient } from "@/lib/api-client";

interface DeviceRequest {
  user_code: string;
  device_name: string;
  status: "pending" | "approved" | "denied";
}

export default function DevicePage() {
  const { isSignedIn, isLoaded, user } = useUser();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const api = useApiClient();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [request, setRequest] = useState<DeviceRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      navigate(`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`);
    }
  }, [isLoaded, isSignedIn, navigate]);

  const lookup = useCallback(
    async (value: string) => {
      setLoading(true);
      setError(null);
      try {
        setRequest(await api.get<DeviceRequest>(`/api/device?user_code=${encodeURIComponent(value)}`));
      } catch (e) {
        setRequest(null);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [api]
  );

  const initialCode = params.get("code");
  useEffect(() => {
    if (isLoaded && isSignedIn && initialCode) lookup(initialCode);
  }, [isLoaded, isSignedIn, initialCode, lookup]);

  async function decide(approve: boolean) {
    if (!request) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<{ status: DeviceRequest["status"] }>("/api/device", {
        user_code: request.user_code,
        approve,
      });
      setRequest({ ...request, status: data.status });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <AuthShell tab="DEVICE SIGN-IN" stamp={"PENDING\nREVIEW"}>
        <p className="font-mono text-sm text-muted-foreground">Loading…</p>
      </AuthShell>
    );
  }

  if (request && request.status !== "pending") {
    const approved = request.status === "approved";
    return (
      <AuthShell tab="DEVICE SIGN-IN" stamp={approved ? "ACCESS\nGRANTED" : "REQUEST\nREJECTED"}>
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-foreground">
            {approved ? (
              <ShieldCheck className="size-4 text-primary" />
            ) : (
              <ShieldX className="size-4 text-destructive" />
            )}
            <h1 className="font-heading text-lg font-semibold tracking-tight">
              {approved ? "Device approved" : "Device denied"}
            </h1>
          </div>
          <p className="font-mono text-sm text-muted-foreground">
            {approved
              ? `${request.device_name} is signed in. Return to your terminal — the install finishes on its own.`
              : "Nothing was authorized. You can close this tab."}
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell tab="DEVICE SIGN-IN" stamp={"PENDING\nREVIEW"}>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-foreground">
            <TerminalSquare className="size-4 text-primary" />
            <h1 className="font-heading text-lg font-semibold tracking-tight">Sign in a device</h1>
          </div>
          <p className="font-mono text-sm text-muted-foreground">
            {request
              ? "Check that this code matches the one in your terminal."
              : "Enter the code shown by the Continuum installer."}
          </p>
        </div>

        {request ? (
          <div className="space-y-1.5 rounded-[var(--radius)] border border-border bg-background/60 px-4 py-3 font-mono text-sm">
            <p className="text-2xl tracking-[0.2em] text-foreground">{request.user_code}</p>
            <p>
              <span className="text-muted-foreground">Device </span>
              <span className="text-foreground">{request.device_name}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Signed in as </span>
              <span className="text-foreground">{user?.primaryEmailAddress?.emailAddress}</span>
            </p>
          </div>
        ) : (
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) lookup(code.trim());
            }}
          >
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-[0.15em]"
            />
            <Button type="submit" disabled={loading || !code.trim()} className="font-mono">
              {loading ? "Checking…" : "Continue"}
            </Button>
          </form>
        )}

        {request && (
          <div className="font-mono text-sm text-muted-foreground">
            <p className="mb-2 text-[0.68rem] uppercase tracking-[0.06em]">This will allow the device to</p>
            <ul className="list-inside list-disc space-y-1 text-foreground/90">
              <li>Add relevant memory to your Claude Code prompts</li>
              <li>Save durable facts from your sessions</li>
            </ul>
          </div>
        )}

        {error && (
          <p className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </p>
        )}

        {request && (
          <div className="flex gap-3">
            <Button onClick={() => decide(true)} disabled={loading} className="flex-1 font-mono">
              {loading ? "Approving…" : "Approve"}
            </Button>
            <Button onClick={() => decide(false)} disabled={loading} variant="outline" className="flex-1 font-mono">
              Deny
            </Button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}
