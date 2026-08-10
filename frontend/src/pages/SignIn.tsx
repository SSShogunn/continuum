import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSignIn } from "@clerk/clerk-react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { GoogleIcon } from "@/components/auth/google-icon";
import { GitHubIcon } from "@/components/auth/github-icon";

type Step = "identifier" | "password" | "code";

function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "errors" in err) {
    const errors = (err as { errors?: { longMessage?: string; message?: string }[] }).errors;
    const first = errors?.[0];
    if (first) return first.longMessage ?? first.message ?? "Something went wrong";
  }
  return "Something went wrong";
}

export default function SignInPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const navigate = useNavigate();

  const [step, setStep] = React.useState<Step>("identifier");
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function completeIfNeeded(status: string | null, createdSessionId: string | null) {
    if (status === "complete" && createdSessionId) {
      await setActive?.({ session: createdSessionId });
      navigate("/dashboard");
      return true;
    }
    return false;
  }

  async function handleIdentifierSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await signIn.create({ identifier });
      if (await completeIfNeeded(result.status, result.createdSessionId)) return;

      const passwordFactor = result.supportedFirstFactors?.find((f) => f.strategy === "password");
      if (passwordFactor) {
        setStep("password");
        return;
      }

      const emailCodeFactor = result.supportedFirstFactors?.find((f) => f.strategy === "email_code");
      if (emailCodeFactor && "emailAddressId" in emailCodeFactor) {
        await signIn.prepareFirstFactor({
          strategy: "email_code",
          emailAddressId: emailCodeFactor.emailAddressId,
        });
        setStep("code");
        return;
      }

      setNotice("This account needs an additional verification step that isn't supported here yet. Please contact support.");
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await signIn.attemptFirstFactor({ strategy: "password", password });
      if (!(await completeIfNeeded(result.status, result.createdSessionId))) {
        setNotice("This account needs an additional verification step that isn't supported here yet. Please contact support.");
      }
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await signIn.attemptFirstFactor({ strategy: "email_code", code });
      if (!(await completeIfNeeded(result.status, result.createdSessionId))) {
        setNotice("This account needs an additional verification step that isn't supported here yet. Please contact support.");
      }
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    if (!isLoaded) return;
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/dashboard",
      });
    } catch (err) {
      console.error("Google sign-in failed:", err);
    }
  }

  async function handleGithub() {
    if (!isLoaded) return;
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_github",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/dashboard",
      });
    } catch (err) {
      console.error("GitHub sign-in failed:", err);
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
            </div>
            <Button type="submit" disabled={busy || !code} className="w-full">
              Verify
            </Button>
          </form>
        )}

        {notice && <p className="font-mono text-xs text-destructive">{notice}</p>}

        <p className="text-center font-mono text-xs text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link to="/sign-up" className="font-semibold text-primary hover:text-primary/80">
            Sign up
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
