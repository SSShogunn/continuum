"use client";

import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";
import { getClerkAppearance } from "@/lib/clerk-appearance";
import { useTheme } from "@/lib/theme-context";

export default function SignUpPage() {
  const { resolvedTheme } = useTheme();

  return (
    <AuthShell tab="NEW FILE" stamp={"OPEN\nFILE"}>
      <SignUp appearance={getClerkAppearance(resolvedTheme)} />
    </AuthShell>
  );
}
