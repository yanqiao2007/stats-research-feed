"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  getInitialSyncState,
  getSyncState,
  refreshSync,
  startSync,
  stopSync,
  subscribeToSyncState,
  type SyncState,
} from "@/lib/sync/engine";

/**
 * `"unknown"` is the pre-hydration state and is why the header renders no
 * account control at all on the server: Supabase keeps its session in
 * localStorage, so whether someone is signed in is simply not knowable until
 * the client has mounted. Rendering "Sign in" first and then swapping it for
 * an email address would be a visible flash and a hydration mismatch.
 */
export type AuthStatus = "unconfigured" | "unknown" | "signedOut" | "signedIn";

export interface AuthContextValue {
  status: AuthStatus;
  email: string | null;
  userId: string | null;
  sync: SyncState;
  /** Sends a magic link. Resolves on success; rejects with a user-facing message. */
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const UNREACHABLE =
  "Could not reach the sign-in service. Check your connection — or, if you are running this yourself, that NEXT_PUBLIC_SUPABASE_URL points at a live project.";

/**
 * Supabase surfaces a bare `"Failed to fetch"` for anything that never reached
 * the server — offline, DNS failure, CORS, a wrong project URL. Passing that
 * string through to a researcher tells them nothing, so network-class failures
 * get a message that names something they can actually check.
 */
function describeAuthError(error: unknown): string {
  if (!(error instanceof Error)) return UNREACHABLE;
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) return UNREACHABLE;
  return error.message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>(configured ? "unknown" : "unconfigured");

  const syncState = useSyncExternalStore(
    subscribeToSyncState,
    getSyncState,
    getInitialSyncState,
  );

  /**
   * Tracks which user the engine has been started for, so repeated
   * `TOKEN_REFRESHED` / `SIGNED_IN` events (Supabase emits one on every token
   * refresh) don't each trigger a fresh pull.
   */
  const syncedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!configured) return;
    const client = getSupabaseClient();
    if (!client) return;

    let cancelled = false;

    // `getSession()` also completes the magic-link redirect: the client is
    // created with `detectSessionInUrl`, so by the time this resolves the
    // token has been taken out of the URL and persisted.
    client.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setStatus(data.session ? "signedIn" : "signedOut");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("signedOut");
      });

    const { data: subscription } = client.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return;
      setSession(nextSession);
      setStatus(nextSession ? "signedIn" : "signedOut");

      if (event === "SIGNED_OUT") {
        // Local wiping is handled by the explicit sign-out path, which knows
        // the user meant it. An expired session must not delete visible state.
        stopSync({ clearLocal: false });
        syncedUserIdRef.current = null;
      }
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [configured]);

  // Start syncing once, per signed-in user.
  useEffect(() => {
    const userId = session?.user.id ?? null;
    if (!userId) return;
    if (syncedUserIdRef.current === userId) return;

    const client = getSupabaseClient();
    if (!client) return;

    syncedUserIdRef.current = userId;
    void startSync(client, userId);
  }, [session]);

  // Pick up changes made on another device when the tab comes back into view.
  useEffect(() => {
    if (status !== "signedIn") return;

    function onVisible() {
      if (document.visibilityState === "visible") void refreshSync();
    }

    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [status]);

  const sendMagicLink = useCallback(async (email: string) => {
    const client = getSupabaseClient();
    if (!client) throw new Error("Accounts are not available on this deployment.");

    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // Must be present in the Supabase dashboard's redirect allowlist.
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
        shouldCreateUser: true,
      },
    });

    if (error) throw new Error(describeAuthError(error));
  }, []);

  const signOut = useCallback(async () => {
    const client = getSupabaseClient();
    // Clear local state first: an explicit sign-out should leave nothing of
    // this account behind in the browser even if the network call fails.
    stopSync({ clearLocal: true });
    syncedUserIdRef.current = null;
    if (client) await client.auth.signOut();
    setSession(null);
    setStatus("signedOut");
  }, []);

  const refresh = useCallback(async () => {
    await refreshSync();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      email: session?.user.email ?? null,
      userId: session?.user.id ?? null,
      sync: syncState,
      sendMagicLink,
      signOut,
      refresh,
    }),
    [status, session, syncState, sendMagicLink, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}
