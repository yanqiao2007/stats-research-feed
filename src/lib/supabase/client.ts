/**
 * Browser-side Supabase client, created lazily and only if the project is
 * configured.
 *
 * Accounts are an *optional* feature at the deployment level, not just the
 * user level: if `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * are absent, `getSupabaseClient()` returns `null`, every auth/sync code path
 * short-circuits, and the app behaves exactly like the localStorage-only V1 —
 * no sign-in UI, no network calls, no errors. That keeps the existing
 * zero-config Vercel deploy working untouched.
 *
 * Both values are safe to ship to the browser: the anon key is a public,
 * publishable key whose privileges are defined entirely by the row-level
 * security policies in `supabase/migrations/`. It is not a secret, and the
 * service-role key is never used anywhere in this app.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Whether this build has Supabase credentials at all. Safe to call during SSR
 * and render; it only inspects inlined build-time env vars.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  // Creating the client touches `window.localStorage` for session persistence,
  // so never construct it during SSR.
  if (typeof window === "undefined") return null;

  if (client === null) {
    client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /**
         * Picks the session straight out of the magic-link redirect URL.
         *
         * With the *default* (unmodified) Supabase magic-link email template,
         * clicking the link lands back on the site with the session in the URL
         * fragment, which `detectSessionInUrl` consumes and then strips from
         * the address bar via `history.replaceState`. That is why `flowType`
         * stays on the library default of `implicit`: it means the feature
         * works against a brand-new Supabase project with no email-template
         * editing, and — unlike PKCE, whose code verifier lives in the
         * localStorage of the browser that *requested* the link — it still
         * works when someone requests the link on a laptop and opens it on
         * their phone, which is the common case for institutional email.
         *
         * `src/app/auth/confirm/page.tsx` additionally handles the stricter
         * `token_hash` style link, so the optional email-template override
         * documented in SUPABASE_SETUP.md works too, without a code change.
         */
        detectSessionInUrl: true,
        flowType: "implicit",
      },
    });
  }

  return client;
}

/** Human-readable reason the account feature is unavailable, or null if it is available. */
export function supabaseUnavailableReason(): string | null {
  if (isSupabaseConfigured()) return null;
  return "This deployment has no Supabase project configured, so accounts are turned off. The feed works normally and saves everything in this browser.";
}
