"use client";

import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";
import { getClerkAppearance } from "@/lib/clerk-appearance";
import { useTheme } from "@/lib/theme-context";

export default function SignInPage() {
  const { resolvedTheme } = useTheme();

  return (
    <AuthShell tab="ACCOUNT ACCESS" stamp={"WELCOME\nBACK"}>
      <SignIn appearance={getClerkAppearance(resolvedTheme)} />
    </AuthShell>
  );
}
