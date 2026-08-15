import { useEffect, useRef, useState } from "react";
import { useSession, useUser } from "@clerk/react";
import { UserRound } from "lucide-react";
import { relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GoogleIcon } from "@/components/auth/google-icon";
import { GitHubIcon } from "@/components/auth/github-icon";

type UserResource = NonNullable<ReturnType<typeof useUser>["user"]>;
type EmailAddress = UserResource["emailAddresses"][number];
type ExternalAccount = UserResource["externalAccounts"][number];
type ActiveSession = Awaited<ReturnType<UserResource["getSessions"]>>[number];

const OAUTH_PROVIDERS = [
  { strategy: "oauth_google" as const, provider: "google", label: "Google", Icon: GoogleIcon },
  { strategy: "oauth_github" as const, provider: "github", label: "GitHub", Icon: GitHubIcon },
];

function clerkError(e: unknown): string {
  const errors = (e as { errors?: { longMessage?: string; message?: string }[] } | null)?.errors;
  const first = errors?.[0];
  if (first) return first.longMessage ?? first.message ?? "Something went wrong";
  return e instanceof Error ? e.message : String(e);
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-destructive text-xs font-mono">{error}</p>;
}

function ProfileDetails({ user }: { user: UserResource }) {
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = firstName !== (user.firstName ?? "") || lastName !== (user.lastName ?? "");

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await action();
      setSaved(true);
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await run(() => user.setProfileImage({ file }));
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <h3 className="text-sm font-medium">Profile</h3>

        <div className="flex items-center gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-secondary/40 text-lg font-medium text-muted-foreground">
            {user.hasImage ? (
              <img src={user.imageUrl} alt="" className="size-full object-cover" />
            ) : (
              <UserRound className="size-7 text-primary" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={pickImage}
              className="hidden"
            />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
              Upload image
            </Button>
            {user.hasImage && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => run(() => user.setProfileImage({ file: null }))}
              >
                Remove
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="first-name">First name</Label>
            <Input id="first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="last-name">Last name</Label>
            <Input id="last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            disabled={busy || !dirty}
            onClick={() => run(() => user.update({ firstName, lastName }))}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
          {saved && !dirty && <span className="text-muted-foreground text-xs">Saved</span>}
        </div>

        <ErrorLine error={error} />
      </CardContent>
    </Card>
  );
}

function EmailAddresses({ user }: { user: UserResource }) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<EmailAddress | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  }

  async function addEmail() {
    const email = draft.trim();
    if (!email) return;
    await run(async () => {
      const created = await user.createEmailAddress({ email });
      await created.prepareVerification({ strategy: "email_code" });
      setPending(created);
      setDraft("");
    });
  }

  async function sendCode(email: EmailAddress) {
    await run(async () => {
      await email.prepareVerification({ strategy: "email_code" });
      setPending(email);
    });
  }

  async function verify() {
    if (!pending) return;
    await run(async () => {
      await pending.attemptVerification({ code });
      await user.reload();
      setPending(null);
      setCode("");
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <h3 className="text-sm font-medium">Email addresses</h3>

        <div className="space-y-2">
          {user.emailAddresses.map((email) => {
            const isPrimary = email.id === user.primaryEmailAddressId;
            const isVerified = email.verification.status === "verified";
            return (
              <div
                key={email.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>{email.emailAddress}</span>
                  {isPrimary && <Badge>primary</Badge>}
                  {!isVerified && <Badge variant="secondary">unverified</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  {!isVerified && pending?.id !== email.id && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => sendCode(email)}>
                      Verify
                    </Button>
                  )}
                  {isVerified && !isPrimary && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => run(() => user.update({ primaryEmailAddressId: email.id }))}
                    >
                      Make primary
                    </Button>
                  )}
                  {!isPrimary && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await email.destroy();
                          if (pending?.id === email.id) setPending(null);
                          await user.reload();
                        })
                      }
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {pending ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-muted-foreground text-xs">
              Enter the code we sent to{" "}
              <span className="text-foreground">{pending.emailAddress}</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Verification code"
                className="max-w-48"
              />
              <Button disabled={busy || !code} onClick={verify}>
                Verify
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setCode("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Input
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="you@example.com"
              className="max-w-64"
            />
            <Button variant="outline" disabled={busy || !draft.trim()} onClick={addEmail}>
              Add email
            </Button>
          </div>
        )}

        <ErrorLine error={error} />
      </CardContent>
    </Card>
  );
}

function PasswordCard({ user }: { user: UserResource }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signOutOfOtherSessions, setSignOutOfOtherSessions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await user.updatePassword({
        newPassword,
        currentPassword: user.passwordEnabled ? currentPassword : undefined,
        signOutOfOtherSessions,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setDone(true);
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <h3 className="text-sm font-medium">
            {user.passwordEnabled ? "Change password" : "Set a password"}
          </h3>
          {!user.passwordEnabled && (
            <p className="text-muted-foreground text-xs">
              You currently sign in with a connected account only. Setting a password lets you sign
              in with your email address as well.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {user.passwordEnabled && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="sm:max-w-64"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-new-password">Confirm password</Label>
              <Input
                id="confirm-new-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          <Label htmlFor="sign-out-others" className="text-muted-foreground text-xs font-normal">
            <Switch
              id="sign-out-others"
              checked={signOutOfOtherSessions}
              onCheckedChange={setSignOutOfOtherSessions}
            />
            Sign out of all other devices
          </Label>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !newPassword || !confirmPassword}>
              {busy ? "Saving…" : user.passwordEnabled ? "Change password" : "Set password"}
            </Button>
            {done && <span className="text-muted-foreground text-xs">Password updated</span>}
          </div>

          <ErrorLine error={error} />
        </form>
      </CardContent>
    </Card>
  );
}

function ConnectedAccounts({ user }: { user: UserResource }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setBusy(false);
    }
  }

  async function connect(strategy: (typeof OAUTH_PROVIDERS)[number]["strategy"]) {
    await run(async () => {
      const account = await user.createExternalAccount({
        strategy,
        redirectUrl: `${window.location.origin}/dashboard/settings`,
      });
      const target = account.verification?.externalVerificationRedirectURL;
      if (target) window.location.href = target.href;
    });
  }

  async function disconnect(account: ExternalAccount) {
    await run(async () => {
      await account.destroy();
      await user.reload();
    });
  }

  const unconnected = OAUTH_PROVIDERS.filter(
    (p) => !user.externalAccounts.some((a) => a.provider === p.provider)
  );

  return (
    <Card>
      <CardContent className="space-y-3">
        <h3 className="text-sm font-medium">Connected accounts</h3>

        {user.externalAccounts.length === 0 ? (
          <p className="text-muted-foreground text-xs">No connected accounts yet.</p>
        ) : (
          <div className="space-y-2">
            {user.externalAccounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>{account.providerTitle()}</span>
                  {account.emailAddress && (
                    <span className="text-muted-foreground text-xs">{account.emailAddress}</span>
                  )}
                  {account.verification?.status !== "verified" && (
                    <Badge variant="secondary">needs reconnect</Badge>
                  )}
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => disconnect(account)}
                >
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        )}

        {unconnected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unconnected.map(({ strategy, label, Icon }) => (
              <Button
                key={strategy}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => connect(strategy)}
                className="gap-1.5"
              >
                <Icon className="size-3.5" />
                Connect {label}
              </Button>
            ))}
          </div>
        )}

        <ErrorLine error={error} />
      </CardContent>
    </Card>
  );
}

function ActiveDevices({ user }: { user: UserResource }) {
  const { session } = useSession();
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    user
      .getSessions()
      .then((list) => {
        if (active) setSessions(list);
      })
      .catch((e) => {
        if (active) setError(clerkError(e));
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function revoke(target: ActiveSession) {
    setRevokingId(target.id);
    setError(null);
    try {
      await target.revoke();
      setSessions((prev) => prev?.filter((s) => s.id !== target.id) ?? null);
    } catch (e) {
      setError(clerkError(e));
    } finally {
      setRevokingId(null);
    }
  }

  function describe(target: ActiveSession) {
    const { browserName, deviceType, city, country } = target.latestActivity;
    const device = [browserName, deviceType].filter(Boolean).join(" · ");
    const place = [city, country].filter(Boolean).join(", ");
    return [device || "Unknown device", place].filter(Boolean).join(" — ");
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <h3 className="text-sm font-medium">Active devices</h3>

        {sessions === null ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{describe(s)}</span>
                    {s.id === session?.id && <Badge>this device</Badge>}
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {s.latestActivity.ipAddress && `${s.latestActivity.ipAddress} · `}
                    last active {relativeTime(s.lastActiveAt.toISOString())}
                  </p>
                </div>
                {s.id !== session?.id && (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={revokingId === s.id}
                    onClick={() => revoke(s)}
                  >
                    {revokingId === s.id ? "Signing out…" : "Sign out"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <ErrorLine error={error} />
      </CardContent>
    </Card>
  );
}

export function DeleteAccountCard() {
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.primaryEmailAddress?.emailAddress ?? "";

  async function deleteAccount() {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await user.delete();
      window.location.href = "/";
    } catch (e) {
      setError(clerkError(e));
      setBusy(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardContent className="space-y-3">
        <h3 className="text-sm font-medium">Delete account</h3>
        <p className="text-muted-foreground text-xs">
          Permanently deletes your Continuum account, every workspace you own, and all memories in
          them. This cannot be undone.
        </p>
        <Button variant="destructive" disabled={!user} onClick={() => setOpen(true)}>
          Delete my account
        </Button>

        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) {
              setConfirmText("");
              setError(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                Type <span className="font-mono text-foreground">{email}</span> to confirm. Every
                memory, workspace, and API token tied to this account is destroyed permanently.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={email}
            />
            <ErrorLine error={error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={confirmText !== email || busy}
                onClick={deleteAccount}
              >
                {busy ? "Deleting…" : "Delete account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function ProfileTab() {
  const { user, isLoaded } = useUser();

  if (!isLoaded || !user) {
    return <p className="text-muted-foreground text-sm mt-4">Loading account…</p>;
  }

  return (
    <div className="space-y-6 mt-4">
      <ProfileDetails user={user} />
      <EmailAddresses user={user} />
      <PasswordCard user={user} />
      <ConnectedAccounts user={user} />
      <ActiveDevices user={user} />
    </div>
  );
}
