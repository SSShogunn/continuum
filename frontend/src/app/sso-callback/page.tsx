"use client";

import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";

export default function SSOCallbackPage() {
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
