import { AuthenticateWithRedirectCallback } from "@clerk/clerk-react";
import { AuthShell } from "@/components/auth-shell";

export default function SsoCallbackPage() {
  return (
    <AuthShell tab="AUTHORIZING" stamp={"ONE\nMOMENT"}>
      <p className="font-mono text-sm text-muted-foreground">Completing sign-in…</p>
      <AuthenticateWithRedirectCallback
        signInUrl="/sign-in"
        signUpUrl="/sign-up"
        signInFallbackRedirectUrl="/dashboard"
        signUpFallbackRedirectUrl="/dashboard"
      />
    </AuthShell>
  );
}
