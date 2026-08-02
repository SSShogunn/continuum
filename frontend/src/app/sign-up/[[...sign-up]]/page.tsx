"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SignUp, useSignUp } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";
import { getClerkAppearance } from "@/lib/clerk-appearance";
import { useTheme } from "@/lib/theme-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { GoogleIcon } from "@/components/auth/google-icon";

type Step = "details" | "code";

export default function SignUpPage() {
  const { resolvedTheme } = useTheme();
  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();

  const [fallback, setFallback] = React.useState(false);
  const [step, setStep] = React.useState<Step>("details");
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");

  const busy = fetchStatus === "fetching";

  async function afterSignUpAttempt() {
    if (signUp.status === "complete") {
      await signUp.finalize();
      router.push("/dashboard");
      return;
    }
    if (
      signUp.status === "missing_requirements" &&
      signUp.unverifiedFields.includes("email_address")
    ) {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) return;
      setStep("code");
      return;
    }
    setFallback(true);
  }

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await signUp.password({ emailAddress, password });
    if (error) return;
    await afterSignUpAttempt();
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) return;
    await afterSignUpAttempt();
  }

  async function handleGoogle() {
    const { error } = await signUp.sso({
      strategy: "oauth_google",
      redirectUrl: "/dashboard",
      redirectCallbackUrl: "/sso-callback",
    });
    if (error) {
      console.error("Google sign-up failed:", error);
      setFallback(true);
    }
  }

  if (fallback) {
    return (
      <AuthShell tab="NEW FILE" stamp={"OPEN\nFILE"}>
        <SignUp appearance={getClerkAppearance(resolvedTheme)} />
      </AuthShell>
    );
  }

  return (
    <AuthShell tab="NEW FILE" stamp={"OPEN\nFILE"}>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="font-heading text-lg font-semibold text-card-foreground">
            Create your account
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            Start filing memories with Continuum
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleGoogle}
          disabled={busy}
          className="w-full justify-center gap-2"
        >
          <GoogleIcon className="size-4" />
          Continue with Google
        </Button>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="font-mono text-[0.62rem] tracking-[0.08em] text-muted-foreground uppercase">
            or
          </span>
          <Separator className="flex-1" />
        </div>

        {step === "details" && (
          <form onSubmit={handleDetailsSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="emailAddress"
                className="font-mono text-[0.68rem] tracking-[0.06em] text-muted-foreground uppercase"
              >
                Email address
              </Label>
              <Input
                id="emailAddress"
                type="email"
                required
                autoFocus
                value={emailAddress}
                onChange={(e) => setEmailAddress(e.target.value)}
                placeholder="you@example.com"
              />
              {errors.fields.emailAddress && (
                <p className="font-mono text-xs text-destructive">
                  {errors.fields.emailAddress.longMessage ?? errors.fields.emailAddress.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="password"
                className="font-mono text-[0.68rem] tracking-[0.06em] text-muted-foreground uppercase"
              >
                Password
              </Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {errors.fields.password && (
                <p className="font-mono text-xs text-destructive">
                  {errors.fields.password.longMessage ?? errors.fields.password.message}
                </p>
              )}
            </div>
            <div id="clerk-captcha" data-cl-theme={resolvedTheme} data-cl-size="flexible" />
            <Button
              type="submit"
              disabled={busy || !emailAddress || !password}
              className="w-full"
            >
              Continue
            </Button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="code"
                className="font-mono text-[0.68rem] tracking-[0.06em] text-muted-foreground uppercase"
              >
                Verification code
              </Label>
              <p className="font-mono text-xs text-muted-foreground">
                We sent a code to {emailAddress}
              </p>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              {errors.fields.code && (
                <p className="font-mono text-xs text-destructive">
                  {errors.fields.code.longMessage ?? errors.fields.code.message}
                </p>
              )}
            </div>
            <Button type="submit" disabled={busy || !code} className="w-full">
              Verify
            </Button>
          </form>
        )}

        {errors.global && errors.global.length > 0 && (
          <p className="font-mono text-xs text-destructive">
            {errors.global[0].longMessage ?? errors.global[0].message}
          </p>
        )}

        <p className="text-center font-mono text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-semibold text-primary hover:text-primary/80">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
