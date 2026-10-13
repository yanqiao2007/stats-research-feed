# STATS Research Feed

**Your personalized research inbox.**

A research productivity tool for organizational and I/O psychology
researchers. It pulls recent publications from a set of journals you choose,
and — unlike a plain RSS reader — it remembers what you've already seen, so
you can pick up exactly where you left off the next time you check in.

Built for the STATS Lab at CMC.

---

## What problem this solves

This project exists to fix two specific frustrations with literature feeds
that a research professor identified:

**1. "Where did I leave off?"**
Researchers check a feed sporadically — maybe once a week, maybe once a
month. When you come back, you shouldn't have to re-skim everything you've
already read to figure out what's new. STATS Research Feed tracks, in your
browser, which articles you've seen, which are new since your last visit,
and roughly where you stopped scrolling — then gives you a one-click
**"Continue where you left off"** to jump back there.

**2. "I only care about my journals."**
Every researcher follows a different slice of the literature. Instead of one
fixed list, you get a **journal watchlist** you can search, customize, and
change any time — your choices persist and immediately reshape the feed.

Everything else in the app (search, filters, sorting, abstracts, open-access
badges) exists in service of those two goals.

## Inspiration

This project was inspired by [Kayla Walters' public I/O psychology journal
feed](https://kayla-walters.github.io/io-psych-journal-feed/research_feed.html),
a great demonstration of what a lightweight literature feed can look like.
**No code from that project was used or adapted** — STATS Research Feed is
an independent implementation, built from scratch with its own data layer,
persistence model, and design system, specifically to add the seen/unseen
and watchlist-customization features described above.

---

## How it works

### The journal watchlist

The app ships with a default catalog of 26 organizational/I/O psychology
journals (see [`src/lib/journals/catalog.ts`](src/lib/journals/catalog.ts)),
all followed by default. Open **Manage journals** to search, check/uncheck
individual journals, select all, clear all, or restore the defaults. Your
choices are saved in your browser and immediately reshape the feed.

### Seen / unseen tracking

Seen/unseen state is **entirely manual and deterministic** — click
**Mark as seen** on any article, and click it again to mark it unseen.
Nothing is ever marked seen automatically by scrolling, hovering, or simply
being rendered on screen; an earlier version experimented with automatic
viewport-dwell detection and it was inconsistent in practice, so it was
removed in favor of an explicit, predictable control. Seen articles stay
fully readable but visually recede a little (lighter weight, no unread
accent stripe) so unseen articles stand out.

### "New since your last visit"

The app tracks two timestamps: your current session's activity, and the
*end* of your previous session. A page reload doesn't immediately overwrite
your "previous visit" marker — a real gap in activity (30+ minutes) has to
pass first. That's what makes "3 new since your last visit" mean something:
reloading the page five times in a row won't reset it to zero, and your
very first-ever visit never misleadingly claims the whole 90-day feed is
"new."

### Continue where you left off

The rule is simple and fully deterministic: **Continue** always points to the
*first unseen article, newest-first, across your currently followed
journals*. It's recomputed on every render from your current article set and
seen-state — never persisted, never based on scroll position, viewport
occupancy, or hover — so it can't go stale and always reflects manual
seen/unseen changes immediately, including after a refresh. If you haven't
marked anything seen yet, the banner doesn't show (there's nothing to
resume). If everything is seen, it shows a "you're all caught up" state
instead. Clicking Continue clears any active search/filter so the target is
always reachable, and scrolls straight to it.

---

## Architecture

```
src/
  app/                    Next.js App Router entry (layout, page, global CSS)
  components/
    ui/                   Small hand-built shadcn/ui-style primitives
                           (Button, Card, Dialog, Checkbox, Switch, …)
    feed/                 Feed-specific UI (ArticleCard, FeedControls,
                           FeedStatusBar, empty/loading/error states, …)
    journals/              Journal watchlist management dialog
  hooks/                  React hooks: watchlist, seen state, bookmarks,
                           visit tracking, first-run notice
    auth/                 Sign-in dialog + header account button
  lib/
    auth/AuthProvider.tsx Auth context: session state, magic link, sign-out
    supabase/client.ts    Browser Supabase client (null when unconfigured)
    sync/                 Local-first cloud sync: the store<->cloud bus,
                           the Supabase data layer, and the engine that
                           seeds/pulls/pushes — the ONLY place that talks
                           to Supabase tables
    journals/catalog.ts   The static journal catalog (name + ISSNs)
    feed/continueTarget.ts Pure function deriving the "Continue where you
                           left off" target from articles + seen state
    openalex/              OpenAlex data-access layer (client, source
                           resolution, work fetching, normalization, demo
                           fallback data) — the ONLY place that talks to
                           OpenAlex
    storage/               Isolated localStorage adapter + key registry
    types.ts               Shared Article/Journal/filter types
    utils/                 Date formatting, text sanitization, cn() helper
```

The guiding rule: **UI components never call OpenAlex or `localStorage`
directly.** They call hooks (`useWatchlist`, `useSeenState`, …) or the
`getFeedArticles()` function from `lib/openalex/feed.ts`. That keeps the
data-fetching and persistence logic centralized, testable, and swappable.

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** (strict mode)
- **Tailwind CSS v4** — design tokens from the STATS Lab style guide (cream
  background, maroon primary, restrained blue/purple accents, Inter
  typeface, `0.5rem` corner radii, no gradients/glassmorphism)
- Hand-built **shadcn/ui-style** primitives on top of Radix UI primitives
  (`@radix-ui/react-dialog`, `-checkbox`, `-switch`, `-separator`) — no
  heavyweight component library
- **React hooks + `useSyncExternalStore`** for state — no Redux/Zustand/etc.
- **OpenAlex** as the live research metadata source (see below)
- **Supabase** (Postgres + Auth) for the *optional* account layer — magic-link
  sign-in and cross-device sync. Entirely opt-in at both the deployment level
  (no env vars → no accounts) and the user level (no sign-in → no server)

## OpenAlex integration

[OpenAlex](https://openalex.org) is a free, fully open scholarly index that
requires **no API key**. The data-access layer (`src/lib/openalex/`) does
the following, without ever hand-typing a guessed OpenAlex ID:

1. **Resolve journals → OpenAlex Source IDs by ISSN, cached per journal.**
   Every journal in the catalog carries its print/online ISSNs (cross-checked
   against the ISSN International Centre portal, publisher pages, and
   Wikipedia). Each journal's resolved Source ID (or confirmed
   "unresolvable") is cached independently in `localStorage` for 24 hours
   (`src/lib/openalex/sources.ts`). Only journals whose cached resolution is
   missing or stale are looked up — and those are still batched into as few
   `GET /sources?filter=issn:a|b|c|...` requests as possible (never one
   request per journal), never a fuzzy title match.
2. **Fetch recent works by source, cached per journal.** Each journal's
   recent works are cached independently for 20 minutes
   (`src/lib/openalex/feed.ts`). Only journals whose cache is missing or
   stale get fetched, and — same principle — every stale/missing journal in
   one load is OR'd together into as few
   `GET /works?filter=primary_location.source.id:S1|S2|...,
   from_publication_date:<90 days ago>,type:article|review,is_retracted:false`
   requests as possible, paginated via OpenAlex's cursor API and capped at a
   sane number of pages per batch. Because each journal's data is cached
   independently, **toggling a journal in the watchlist is a purely local
   operation** — unfollowing never triggers a network call, and re-following
   a journal whose data is still fresh is instant. Only genuinely new or
   stale journals ever hit the network, and identical concurrent requests
   (same URL in flight at the same time) are de-duplicated in
   `src/lib/openalex/client.ts`.
3. **Filter to genuine scholarly content.** The `type:article|review,
   is_retracted:false` filter (verified against OpenAlex's current API docs,
   including its July 2026 type-classification overhaul) excludes errata,
   corrections, editorials, letters, and retracted works server-side, while
   keeping legitimate review articles. `normalize.ts` re-checks the same
   condition defensively in case a record is missing the field or a future
   code path queries OpenAlex without the filter.
4. **Normalize** every OpenAlex work into a consistent internal `Article`
   shape — reconstructing the abstract from OpenAlex's inverted-index
   format, extracting a safe DOI/article URL, and gracefully defaulting
   missing authors/dates/OA status/abstracts instead of erroring. Only these
   normalized fields are cached — never raw OpenAlex response payloads — to
   keep the `localStorage` footprint compact.
5. **De-duplicate** by work ID and then by DOI.

All UI-level filtering and sorting — text search, seen/unseen, Open Access,
sort order, expanding an abstract, marking an article seen — operates
entirely on the already-fetched, already-cached article set in memory and
never triggers a new OpenAlex request.

If OpenAlex can't be reached, or a specific journal's source can't be
resolved, the app **never fabricates data or fakes a live result**. Instead
it falls back to a small, clearly-labeled demo dataset (every title is
prefixed "Demo Article:", carries a "Demo data" badge, and a banner explains
what happened) so the app still renders something useful. Any journal that
couldn't be resolved is flagged directly in the "Manage journals" dialog.

### Caching model at a glance

| What | Where | Granularity | TTL |
|---|---|---|---|
| Journal → OpenAlex Source ID | `localStorage` (`stats-feed:openalex-source-cache`) | per journal | 24h |
| Recent works per journal | `localStorage` (`stats-feed:openalex-works-cache`) | per journal | 20min |
| In-flight duplicate requests | in-memory (per browser tab) | per exact URL | until settled |

Everything is per-browser, client-side `localStorage` — there's no server, so
nothing is shared across users or devices, and a hard refresh just re-reads
the same cache (no data loss). This is intentionally simple for a research
prototype; a future version with a backend could add a shared server-side
cache, but that's out of scope here.

## Running it locally

Requirements: Node.js 18.18+ (Node 22 recommended) and npm.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). No environment
variables, API keys, or accounts are required — it works immediately.

To additionally turn on optional accounts, follow
[`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) (about 15 minutes). Without it the
app simply renders no sign-in UI and makes no calls to anything but OpenAlex.

Other useful commands:

```bash
npm run build   # production build
npm run start   # run the production build locally
npm run lint    # ESLint
```

> **Verification status (Oct 2026):** the two earlier build sessions ran in
> sandboxes with no outbound network access, so neither `npm run build` nor a
> live OpenAlex request had ever actually been exercised. Both have now been
> run successfully on a normal connection: `npm run build`, `npm run lint`,
> and `npx tsc --noEmit` all pass, and a cold load retrieved **339 real
> articles across all 26 journals** from `api.openalex.org` with no demo
> fallback and no unresolved journals. The Supabase account layer's own
> verification status is noted in the section below.

## How local persistence works

Everything the app remembers about you lives in your browser's
`localStorage`. Without an account that is the whole story — nothing leaves
your device. With an account, three of these keys additionally sync (see
"Optional accounts and cross-device sync" below); the rest never do.
See `src/lib/storage/localStorageAdapter.ts` and
`src/lib/storage/keys.ts` for the full list of keys. In short, it persists:

- Your followed journal IDs
- Which article IDs you've marked seen (manually — see "Seen / unseen
  tracking" above)
- Your previous-visit timestamp (used for "new since last visit")
- Saved/bookmarked articles — a **full snapshot** of each article (title,
  authors, journal, date, abstract, link), not just its id, so a saved
  article stays viewable in the **Saved** tab even if you later unfollow
  its journal or it ages out of the 90-day feed window
- Whether you've dismissed the first-run notice
- Which account the synced state belongs to, when signed in (so one person's
  local state can never be pushed up into another person's new account on a
  shared machine)
- Per-journal caches of OpenAlex source-ID resolutions and recent works (to
  avoid refetching data that's already fresh — see "Caching model at a
  glance" above)

"Continue where you left off" is **not** persisted — it's recomputed on every
render from your current articles and seen-state (see "Continue where you
left off" above), so there's nothing to list here for it.

All reads/writes go through one small adapter (`storage.get/set/remove`),
and every hook that owns a piece of state (`useWatchlist`, `useSeenState`,
etc.) is built on that adapter plus `useSyncExternalStore` — never
`localStorage` calls scattered through components.

## Optional accounts and cross-device sync

Accounts are off until someone configures them, and optional for every reader
even then. The model is **local-first**: `localStorage` remains the single
synchronous source of truth the UI renders from, signed in or not. That is
what keeps the read path free of loading spinners and keeps the whole app
working offline and signed out, exactly as V1 did.

Setup lives in [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md); the schema and its
row-level security policies live in
[`supabase/migrations/0001_user_state.sql`](supabase/migrations/0001_user_state.sql).

### What syncs, and what deliberately doesn't

| State | Syncs? | Why |
|---|---|---|
| Followed journals | Yes | Real curation effort; the main thing worth carrying between devices |
| Seen article ids | Yes | The feature the app exists for — "where did I leave off" should survive a change of machine |
| Saved articles (full snapshots) | Yes | Same reasoning, and the snapshot keeps them readable after a journal is unfollowed |
| Previous-visit timestamps | No | Genuinely per-device: "new since your last visit" means your last visit *here* |
| OpenAlex source/works caches | No | Disposable performance data with a 20-minute/24-hour TTL. Syncing them would add write traffic and staleness bugs for no benefit |

### How it behaves

- **Signing in for the first time** seeds the cloud *from* the browser, so a
  reader who spent months curating a watchlist anonymously keeps all of it.
- **Every load after that** treats the cloud as authoritative and overwrites
  local state. This is deliberately not a merge: a union cannot tell "absent"
  from "deliberately deleted", so merging would resurrect journals the user
  unfollowed and articles they marked unseen.
- **Each change pushes a delta** (one row), not a rewrite of the whole list,
  and writes are queued strictly in order so two rapid toggles cannot land
  backwards.
- **A click during the opening pull is replayed** on top of whatever the
  server sent, rather than being silently overwritten.
- **Signing out clears the synced slices from the browser** — the data stays
  in the account. This matters on a shared lab machine, and the sign-out
  confirmation says so plainly.
- **One person's local state never seeds another person's new account.** The
  browser records which user its synced state belongs to, and refuses to push
  it up into a different account.

### Where the code lives

```
hooks/createPersistedStore.ts   Emits a delta on each mutation; registers
                                 snapshot/applyRemote/resetLocal per slice
lib/sync/bus.ts                 Dependency-free seam between the two (no
                                 React, no Supabase — avoids an import cycle)
lib/sync/remote.ts              Every Supabase table query, and nothing else
lib/sync/engine.ts              Seed/pull/push orchestration + write queue
lib/auth/AuthProvider.tsx       Session state and the magic-link call
```

The same containment rule as the OpenAlex layer applies: UI components never
touch Supabase directly.

## Current limitations

- **Accounts are optional, and off by default.** With no Supabase project
  configured, state lives in one browser: clear your browser data (or switch
  browsers/devices) and it's gone. See
  [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) to turn sync on.
- **Signed in, the server wins on load.** A change made while genuinely
  offline is lost if the tab reloads before reconnecting. Queued writes live
  in memory, not on disk. For a feed you check periodically this is a fair
  trade for never resurrecting deleted state, but it is a real limitation.
- **No realtime.** Another device's changes arrive on page load or when the
  tab regains focus, not instantly. Two devices edited simultaneously will
  not fight, but they will not live-update each other either.
- **Sync is per-tab.** Two tabs of this app open at once do not notify each
  other of local changes; the second tab picks them up on reload or refocus.
- **No self-service account deletion.** Removing a user is a manual
  `delete from auth.users` in the Supabase dashboard (it cascades).
- **The Supabase account layer has not been run against a live Supabase
  project.** The machine this was built on had no Docker or Supabase CLI, so
  no Postgres could be started locally. Typecheck, lint, and production build
  pass; the signed-out path, the sign-in dialog, the unreachable-server error
  path, and the `/auth/confirm` failure screen were all exercised in a
  browser. What remains unverified is everything that needs a real server:
  the migration SQL actually applying, the RLS policies, a real magic-link
  round trip, and sync between two devices. Walk through "Checking it
  actually works" in [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) once before
  relying on it.
- **Topic filtering was intentionally not built.** OpenAlex's topic/concept
  metadata isn't reliably populated for every work, and the brief explicitly
  said not to sacrifice core functionality for it.
- **No push notifications or email digests** — this is a pull-based feed you
  check when you want to.
- The 90-day retrieval window and per-request page caps are reasonable
  defaults, not tuned against real traffic volume for all 26 journals at
  once.
- OpenAlex's `type`/`is_retracted` classification (verified current as of
  2026-08-26) is itself imperfect — its July 2026 overhaul improved accuracy
  to ~78% against ground truth, up from ~69%, so a small amount of
  misclassified content may still slip through or be over-excluded. The
  `type:article|review` allowlist plus `is_retracted:false` is the best
  currently-available filter, not a guarantee of a perfectly clean corpus.

## Journal source mapping status

All 26 requested journals are in the catalog with print **and** online
ISSNs cross-checked against multiple independent sources (the ISSN
International Centre portal, publisher pages, Wikipedia) — no journal was
dropped, and no OpenAlex Source ID was hand-typed or guessed anywhere in the
codebase. Resolution from ISSN → OpenAlex Source ID happens **live, at
runtime**, via OpenAlex's own `/sources?filter=issn:...` endpoint, cached
independently per journal for 24h (see `src/lib/openalex/sources.ts`), and
any journal OpenAlex doesn't return a match for is surfaced directly in the
"Manage journals" dialog rather than silently dropped or faked.

This live resolution step has now been exercised against the real API: a cold
load resolved all 26 journals to OpenAlex Source IDs and returned 339
articles, with nothing flagged as unresolved in "Manage journals".

## Deploying to Vercel

This is a standard Next.js App Router project, so it deploys to Vercel with
no configuration: connect the GitHub repo, accept the defaults, deploy. No
environment variables are required — a deployment without them simply has no
accounts, and the feed works exactly as described above.

To enable accounts on a deployment, add `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in the Vercel project settings and add that
origin's `/auth/confirm` to Supabase's redirect allowlist — see
[`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) step 6.

## Roadmap ideas beyond V1

- Optional email/weekly-digest summaries of new articles
- Author-level or topic-level following, once OpenAlex's topic metadata is
  reliably populated across these journals
