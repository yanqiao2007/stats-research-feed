"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/AuthProvider";

/**
 * Where the magic link lands.
 *
 * Two link shapes reach this page, and it handles both so that the feature
 * works against a brand-new Supabase project *and* against one whose email
 * template has been hardened:
 *
 *   1. **Default template.** `{{ .ConfirmationURL }}` sends the session back in
 *      the URL fragment. The Supabase client is created with
 *      `detectSessionInUrl`, so `AuthProvider` has already consumed and
 *      stripped it by the time this page settles — there is nothing to do here
 *      but wait for the auth state and move on.
 *
 *   2. **`token_hash` template** (the optional override in SUPABASE_SETUP.md).
 *      The link carries a single-use hash in the query string instead of a
 *      live token, which never puts an access token in browser history. That
 *      one has to be redeemed explicitly via `verifyOtp`.
 *
 * Errors arrive as `error`/`error_description`, in the query string or the
 * fragment depending on how far the request got, so both are checked.
 */

type Phase = { kind: "working" } | { kind: "done" } | { kind: "error"; message: string };

/** Reads a param from the query string, falling back to the URL fragment. */
function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  const fromQuery = new URLSearchParams(window.location.search).get(name);
  if (fromQuery) return fromQuery;
  return new URLSearchParams(window.location.hash.replace(/^#/, "")).get(name);
}

export default function ConfirmPage() {
  const { status } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });

  useEffect(() => {
    /**
     * Reasons the link is dead on arrival, knowable from the URL alone. The
     * URL is an external system that can only be read once mounted, so
     * reflecting it into state here is this effect's purpose — the same
     * pattern (and the same lint exemption) as `useVisitTracking`.
     */
    const blocker = !isSupabaseConfigured()
      ? "This deployment has no Supabase project configured, so sign-in links cannot be used."
      : (readParam("error_description") ?? readParam("error"))?.replace(/\+/g, " ");

    if (blocker) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase({ kind: "error", message: blocker });
      return;
    }

    const tokenHash = readParam("token_hash");
    if (!tokenHash) return; // Fragment-style link: AuthProvider handles it.

    const client = getSupabaseClient();
    if (!client) return;

    let cancelled = false;

    client.auth
      .verifyOtp({
        token_hash: tokenHash,
        // `email` covers magic links and signup confirmations alike; the
        // template chooses which `type` it sends.
        type: (readParam("type") as "email" | "magiclink" | "recovery" | null) ?? "email",
      })
      .then(({ error }) => {
        if (cancelled) return;
        if (error) {
          setPhase({ kind: "error", message: error.message });
          return;
        }
        // Clear the single-use hash out of the address bar.
        window.history.replaceState(window.history.state, "", "/auth/confirm");
        setPhase({ kind: "done" });
      })
      .catch(() => {
        if (cancelled) return;
        setPhase({
          kind: "error",
          message: "Could not reach the sign-in service. Check your connection and try again.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Once a session exists — by either route — send the reader to the feed.
  useEffect(() => {
    if (status !== "signedIn") return;
    window.location.replace("/");
  }, [status]);

  // A link that is expired, already used, or consumed by a mail scanner
  // produces no session and no explicit error, so give up rather than spin
  // forever. If a session does arrive, this effect re-runs and its cleanup
  // cancels the timer before it can fire.
  useEffect(() => {
    if (phase.kind === "error" || status === "signedIn") return;
    const timer = setTimeout(() => {
      setPhase({
        kind: "error",
        message:
          "This sign-in link did not work. Links can only be used once and expire after an hour — request a fresh one.",
      });
    }, 10_000);
    return () => clearTimeout(timer);
  }, [phase.kind, status]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center px-4 py-10">
      <Card className="w-full">
        <CardContent className="space-y-4 p-6 text-center">
          {phase.kind === "error" ? (
            <>
              <AlertCircle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
              <div className="space-y-1.5">
                <h1 className="text-lg font-semibold text-foreground">Sign-in failed</h1>
                <p role="alert" className="text-sm leading-relaxed text-muted-foreground">
                  {phase.message}
                </p>
              </div>
              <Button asChild className="w-full">
                <Link href="/">Back to the feed</Link>
              </Button>
              <p className="text-xs text-muted-foreground">
                Your watchlist and reading history in this browser are untouched.
              </p>
            </>
          ) : (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-secondary" aria-hidden="true" />
              <div className="space-y-1.5">
                <h1 className="text-lg font-semibold text-foreground">Signing you in…</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  One moment while we confirm your link.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
