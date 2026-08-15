import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSignIn } from "@clerk/react";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { GoogleIcon } from "@/components/auth/google-icon";
import { GitHubIcon } from "@/components/auth/github-icon";

type Step = "identifier" | "password" | "code" | "reset-code" | "reset-password";

type AuthError = { message?: string; longMessage?: string } | null;

function errorMessage(error: AuthError): string {
  return error?.longMessage ?? error?.message ?? "Something went wrong";
}

export default function SignInPage() {
  const { signIn } = useSignIn();
  const navigate = useNavigate();

  const [step, setStep] = React.useState<Step>("identifier");
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [canReset, setCanReset] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const UNSUPPORTED_STEP =
    "This account needs an additional verification step that isn't supported here yet. Please contact support.";

  async function completeIfNeeded() {
    if (signIn.status !== "complete") return false;
    await signIn.finalize({ navigate: () => navigate("/dashboard") });
    return true;
  }

  async function handleIdentifierSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signIn.create({ identifier });
      if (error) {
        setNotice(errorMessage(error));
        return;
      }
      if (await completeIfNeeded()) return;

      const factors = signIn.supportedFirstFactors ?? [];
      setCanReset(factors.some((f) => f.strategy === "reset_password_email_code"));

      if (factors.some((f) => f.strategy === "password")) {
        setStep("password");
        return;
      }

      const emailCodeFactor = factors.find((f) => f.strategy === "email_code");
      if (emailCodeFactor && "emailAddressId" in emailCodeFactor) {
        const sent = await signIn.emailCode.sendCode({
          emailAddressId: emailCodeFactor.emailAddressId,
        });
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

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signIn.password({ password });
      if (error) {
        setNotice(errorMessage(error));
        return;
      }
      if (!(await completeIfNeeded())) setNotice(UNSUPPORTED_STEP);
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signIn.resetPasswordEmailCode.sendCode();
      if (error) {
        setNotice(errorMessage(error));
        return;
      }
      setPassword("");
      setCode("");
      setStep("reset-code");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code });
      if (error) {
        setNotice(errorMessage(error));
        return;
      }
      if (await completeIfNeeded()) return;
      if (signIn.status !== "needs_new_password") {
        setNotice(UNSUPPORTED_STEP);
        return;
      }
      setCode("");
      setStep("reset-password");
    } finally {
      setBusy(false);
    }
  }

  async function handleNewPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setNotice("Passwords don't match");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signIn.resetPasswordEmailCode.submitPassword({
        password: newPassword,
        signOutOfOtherSessions: true,
      });
      if (error) {
        setNotice(errorMessage(error));
        return;
      }
      if (!(await completeIfNeeded())) setNotice(UNSUPPORTED_STEP);
    } finally {
      setBusy(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await signIn.emailCode.verifyCode({ code });
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
      const { error } = await signIn.sso({
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
              <div className="flex items-baseline justify-between gap-2">
                <Label
                  htmlFor="password"
                  className="font-mono text-[0.68rem] tracking-[0.06em] text-muted-foreground uppercase"
                >
                  Password
                </Label>
                {canReset && (
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={busy}
                    className="font-mono text-xs text-muted-foreground transition-colors hover:text-card-foreground disabled:opacity-50"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
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

        {step === "reset-code" && (
          <form onSubmit={handleResetCodeSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="reset-code"
                className="font-mono text-[0.68rem] tracking-[0.06em] text-muted-foreground uppercase"
              >
                Reset code
              </Label>
              <p className="font-mono text-xs text-muted-foreground">
                We sent a password reset code to {identifier}
              </p>
              <Input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy || !code} className="w-full">
              Continue
            </Button>
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={busy}
              className="font-mono text-xs text-muted-foreground transition-colors hover:text-card-foreground disabled:opacity-50"
            >
              resend code
            </button>
            <button
              type="button"
              onClick={() => setStep("password")}
              className="font-mono text-xs text-muted-foreground transition-colors hover:text-card-foreground"
            >
              ← back to password
            </button>
          </form>
        )}

        {step === "reset-password" && (
          <form onSubmit={handleNewPasswordSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="new-password"
                className="font-mono text-[0.68rem] tracking-[0.06em] text-muted-foreground uppercase"
              >
                New password
              </Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                autoFocus
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="confirm-password"
                className="font-mono text-[0.68rem] tracking-[0.06em] text-muted-foreground uppercase"
              >
                Confirm password
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={busy || !newPassword || !confirmPassword}
              className="w-full"
            >
              Reset password
            </Button>
            <p className="font-mono text-xs text-muted-foreground">
              This signs you out of any other active sessions.
            </p>
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
