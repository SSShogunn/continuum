"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { GoogleIcon } from "@/components/auth/google-icon";
import { GitHubIcon } from "@/components/auth/github-icon";

type Step = "identifier" | "password" | "code";

export default function SignInPage() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();

  const [step, setStep] = React.useState<Step>("identifier");
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);

  const busy = fetchStatus === "fetching";

  async function afterFactorAttempt() {
    if (signIn.status === "complete") {
      await signIn.finalize();
      router.push("/dashboard");
      return;
    }
    setNotice(
      "This account needs an additional verification step that isn't supported here yet. Please contact support."
    );
  }

  async function handleIdentifierSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await signIn.create({ identifier });
    if (error) return;

    if (signIn.status === "needs_first_factor") {
      const supportsPassword = signIn.supportedFirstFactors.some(
        (f) => f.strategy === "password"
      );
      if (supportsPassword) {
        setStep("password");
        return;
      }
      const { error: codeError } = await signIn.emailCode.sendCode();
      if (codeError) return;
      setStep("code");
      return;
    }

    await afterFactorAttempt();
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await signIn.password({ password });
    if (error) return;
    await afterFactorAttempt();
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await signIn.emailCode.verifyCode({ code });
    if (error) return;
    await afterFactorAttempt();
  }

  async function handleGoogle() {
    const { error } = await signIn.sso({
      strategy: "oauth_google",
      redirectUrl: "/dashboard",
      redirectCallbackUrl: "/sso-callback",
    });
    if (error) {
      console.error("Google sign-in failed:", error);
    }
  }

  async function handleGithub() {
    const { error } = await signIn.sso({
      strategy: "oauth_github",
      redirectUrl: "/dashboard",
      redirectCallbackUrl: "/sso-callback",
    });
    if (error) {
      console.error("GitHub sign-in failed:", error);
    }
  }

  return (
    <AuthShell tab="ACCOUNT ACCESS" stamp={"WELCOME\nBACK"}>
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="font-heading text-lg font-semibold text-card-foreground">
            Sign in to Continuum
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            Welcome back! Please sign in to continue
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

        <Button
          type="button"
          variant="outline"
          onClick={handleGithub}
          disabled={busy}
          className="w-full justify-center gap-2"
        >
          <GitHubIcon className="size-4" />
          Continue with GitHub
        </Button>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="font-mono text-[0.62rem] tracking-[0.08em] text-muted-foreground uppercase">
            or
          </span>
          <Separator className="flex-1" />
        </div>

        {step === "identifier" && (
          <form onSubmit={handleIdentifierSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="identifier"
                className="font-mono text-[0.68rem] tracking-[0.06em] text-muted-foreground uppercase"
              >
                Email address
              </Label>
              <Input
                id="identifier"
                type="email"
                required
                autoFocus
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@example.com"
              />
              {errors.fields.identifier && (
                <p className="font-mono text-xs text-destructive">
                  {errors.fields.identifier.longMessage ?? errors.fields.identifier.message}
                </p>
              )}
            </div>
            <Button type="submit" disabled={busy || !identifier} className="w-full">
              Continue
            </Button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
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
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {errors.fields.password && (
                <p className="font-mono text-xs text-destructive">
                  {errors.fields.password.longMessage ?? errors.fields.password.message}
                </p>
              )}
            </div>
            <Button type="submit" disabled={busy || !password} className="w-full">
              Sign in
            </Button>
            <button
              type="button"
              onClick={() => setStep("identifier")}
              className="font-mono text-xs text-muted-foreground transition-colors hover:text-card-foreground"
            >
              ← use a different email
            </button>
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
                We sent a code to {identifier}
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

        {notice && <p className="font-mono text-xs text-destructive">{notice}</p>}

        {errors.global && errors.global.length > 0 && (
          <p className="font-mono text-xs text-destructive">
            {errors.global[0].longMessage ?? errors.global[0].message}
          </p>
        )}

        <p className="text-center font-mono text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/sign-up" className="font-semibold text-primary hover:text-primary/80">
            Sign up
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
