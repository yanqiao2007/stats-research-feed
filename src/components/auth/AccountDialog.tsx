"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, CloudOff, Loader2, Mail, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/lib/auth/AuthProvider";

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

/** "just now" / "6 minutes ago" / a wall-clock time for anything older than an hour. */
function formatLastSynced(ms: number | null): string {
  if (ms === null) return "not yet";
  const elapsed = Date.now() - ms;
  if (elapsed < 45_000) return "just now";
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function WhatSyncs() {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
      <p>An account exists for one reason: to carry three things between your devices.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>The journals on your watchlist</li>
        <li>Which articles you have marked seen</li>
        <li>Your saved articles</li>
      </ul>
      <p>
        Those three, plus the email address you sign in with. Nothing else is uploaded — your
        searches, filters, and the cached article data stay in this browser, exactly as they do
        without an account.
      </p>
    </div>
  );
}

function SignInPanel({ onClose }: { onClose: () => void }) {
  const { sendMagicLink } = useAuth();
  const [email, setEmail] = useState("");
  const [send, setSend] = useState<SendState>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || send.kind === "sending") return;
    setSend({ kind: "sending" });
    try {
      await sendMagicLink(email);
      setSend({ kind: "sent" });
    } catch (error) {
      setSend({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not send the link.",
      });
    }
  }

  if (send.kind === "sent") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Check your email</DialogTitle>
          <DialogDescription>
            A sign-in link is on its way to{" "}
            <span className="font-medium text-foreground">{email.trim()}</span>.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>
            Open it and you will land back here, signed in. The link works once and expires after an
            hour.
          </p>
          <p>
            Nothing arrived? Check your spam folder. Institutional mail filters sometimes hold
            automated sign-in mail, and some scanners follow the link before you do, which uses it
            up — if that happens, request a new one.
          </p>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => setSend({ kind: "idle" })}>
            Use a different email
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Sign in to sync your feed</DialogTitle>
        <DialogDescription>
          Optional. The feed works fully without an account — an account just lets your watchlist
          and reading history follow you to another device.
        </DialogDescription>
      </DialogHeader>

      <Separator />

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="account-email" className="text-sm font-medium text-foreground">
            Email
          </label>
          <Input
            id="account-email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@university.edu"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby="account-email-hint"
          />
          <p id="account-email-hint" className="text-xs text-muted-foreground">
            No password. We email you a link that signs you in.
          </p>
        </div>

        {send.kind === "error" && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-foreground"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            {send.message}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={send.kind === "sending"}>
          {send.kind === "sending" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : (
            <>
              <Mail className="h-4 w-4" aria-hidden="true" />
              Send me a sign-in link
            </>
          )}
        </Button>
      </form>

      <Separator />

      <WhatSyncs />

      <p className="text-sm leading-relaxed text-muted-foreground">
        If you already have a watchlist and reading history in this browser, signing in for the
        first time keeps it and copies it up to your new account.
      </p>
    </>
  );
}

function SyncStatusLine() {
  const { sync, refresh } = useAuth();
  const [, forceRender] = useState(0);

  // "synced 3 minutes ago" would otherwise sit frozen at "just now".
  useEffect(() => {
    const timer = setInterval(() => forceRender((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const isBusy = sync.status === "syncing";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {isBusy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-secondary" aria-hidden="true" />
              Syncing…
            </>
          ) : sync.status === "error" ? (
            <>
              <AlertCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
              Sync problem
            </>
          ) : (
            <>
              <Check className="h-4 w-4 text-secondary" aria-hidden="true" />
              Synced {formatLastSynced(sync.lastSyncedAt)}
            </>
          )}
        </span>

        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={isBusy}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Sync now
        </Button>
      </div>

      {sync.pendingWrites > 0 && (
        <p className="text-xs text-muted-foreground">
          {sync.pendingWrites} change{sync.pendingWrites === 1 ? "" : "s"} still uploading.
        </p>
      )}

      {sync.status === "error" && sync.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-foreground"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            {sync.error} Your changes are still saved in this browser — nothing has been lost.
          </span>
        </p>
      )}
    </div>
  );
}

function AccountPanel({ onClose }: { onClose: () => void }) {
  const { email, signOut } = useAuth();
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    setSigningOut(false);
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Your account</DialogTitle>
        <DialogDescription>
          Signed in as <span className="font-medium text-foreground">{email}</span>
        </DialogDescription>
      </DialogHeader>

      <Separator />

      <SyncStatusLine />

      <Separator />

      <WhatSyncs />

      {confirmingSignOut ? (
        <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-sm leading-relaxed text-foreground">
            Signing out removes your watchlist, seen articles, and saved articles{" "}
            <span className="font-medium">from this browser</span>, so the next person to use it
            starts fresh. Everything stays in your account, and signing back in brings it all
            back.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmingSignOut(false)} disabled={signingOut}>
              Stay signed in
            </Button>
            <Button variant="destructive" onClick={() => void handleSignOut()} disabled={signingOut}>
              {signingOut ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Signing out…
                </>
              ) : (
                "Sign out"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => setConfirmingSignOut(true)}>
            Sign out
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      )}
    </>
  );
}

function UnconfiguredPanel({ onClose }: { onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Accounts are not set up</DialogTitle>
        <DialogDescription>
          This copy of the feed has no backend configured, so there is nothing to sign in to.
        </DialogDescription>
      </DialogHeader>

      <Separator />

      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
        <p>
          Everything works normally — your watchlist, seen articles, and saved articles are kept in
          this browser. They just will not follow you to another device.
        </p>
        <p className="flex items-start gap-2">
          <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          If you are running this yourself, see <code className="rounded bg-muted px-1 py-0.5 text-xs">SUPABASE_SETUP.md</code>{" "}
          in the repository to turn accounts on.
        </p>
      </div>

      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
}

export function AccountDialog({ open, onOpenChange }: AccountDialogProps) {
  const { status } = useAuth();
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {status === "unconfigured" ? (
          <UnconfiguredPanel onClose={close} />
        ) : status === "signedIn" ? (
          <AccountPanel onClose={close} />
        ) : (
          <SignInPanel onClose={close} />
        )}
      </DialogContent>
    </Dialog>
  );
}
