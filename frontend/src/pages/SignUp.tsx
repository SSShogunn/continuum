import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSignUp } from "@clerk/react";
import { AuthShell } from "@/components/auth-shell";
import { useTheme } from "@/lib/theme-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { GoogleIcon } from "@/components/auth/google-icon";
import { GitHubIcon } from "@/components/auth/github-icon";

type Step = "details" | "code";

type AuthError = { message?: string; longMessage?: string } | null;

function errorMessage(error: AuthError): string {
  return error?.longMessage ?? error?.message ?? "Something went wrong";
}

export default function SignUpPage() {
  const { resolvedTheme } = useTheme();
  const { signUp } = useSignUp();
  const navigate = useNavigate();

  const [step, setStep] = React.useState<Step>("details");
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const UNSUPPORTED_STEP =
    "This account needs an additional step that isn't supported here yet. Please contact support.";

  async function completeIfNeeded() {
    if (signUp.status !== "complete") return false;
    await signUp.finalize({ navigate: () => navigate("/dashboard") });
    return true;
  }

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signUp.create({ emailAddress, password });
      if (error) {
        setNotice(errorMessage(error));
        return;
      }
      if (await completeIfNeeded()) return;

      if (signUp.unverifiedFields?.includes("email_address")) {
        const sent = await signUp.verifications.sendEmailCode();
        if (sent.error) {
          setNotice(errorMessage(sent.error));
          return;
        }
        setStep("code");
        return;
      }

      setNotice(UNSUPPORTED_STEP);
    } finally {
      setBusy(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code });
      if (error) {
        setNotice(errorMessage(error));
        return;
      }
      if (!(await completeIfNeeded())) setNotice(UNSUPPORTED_STEP);
    } finally {
      setBusy(false);
    }
  }

  async function handleSso(strategy: "oauth_google" | "oauth_github") {
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signUp.sso({
        strategy,
        redirectUrl: "/dashboard",
        redirectCallbackUrl: "/sso-callback",
      });
      if (error) setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
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
          onClick={() => handleSso("oauth_google")}
          disabled={busy}
          className="w-full justify-center gap-2"
        >
          <GoogleIcon className="size-4" />
          Continue with Google
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => handleSso("oauth_github")}
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
            </div>
            <Button type="submit" disabled={busy || !code} className="w-full">
              Verify
            </Button>
          </form>
        )}

        {notice && <p className="font-mono text-xs text-destructive">{notice}</p>}

        <p className="text-center font-mono text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/sign-in" className="font-semibold text-primary hover:text-primary/80">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
