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

An article is marked "seen" only after it has spent real time meaningfully
visible in your browser viewport (using an `IntersectionObserver` with a
short dwell timer) — never just because it was fetched or rendered
off-screen. You can also mark any article seen/unseen manually. Seen
articles stay fully readable but visually recede a little (lighter weight,
no unread accent stripe) so unseen articles stand out.

### "New since your last visit"

The app tracks two timestamps: your current session's activity, and the
*end* of your previous session. A page reload doesn't immediately overwrite
your "previous visit" marker — a real gap in activity (30+ minutes) has to
pass first. That's what makes "3 new since your last visit" mean something:
reloading the page five times in a row won't reset it to zero, and your
very first-ever visit never misleadingly claims the whole 90-day feed is
"new."

### Continue where you left off

As you scroll, the app keeps track of whichever article currently occupies
the most of your viewport and saves its stable ID (not a fragile scroll
pixel offset). A banner at the top of the feed lets you jump straight back
to it, even after closing the tab and coming back days later.

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
                           visit tracking, first-run notice, continue-reading
                           position, and the IntersectionObserver-based
                           visibility tracker
  lib/
    journals/catalog.ts   The static journal catalog (name + ISSNs)
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
- No backend, no database, no authentication — this is a client-only V1

## OpenAlex integration

[OpenAlex](https://openalex.org) is a free, fully open scholarly index that
requires **no API key**. The data-access layer (`src/lib/openalex/`) does
the following, without ever hand-typing a guessed OpenAlex ID:

1. **Resolve journals → OpenAlex Source IDs by ISSN.** Every journal in the
   catalog carries its print/online ISSNs (cross-checked against the ISSN
   International Centre portal, publisher pages, and Wikipedia). All of a
   watchlist's ISSNs are sent in a single batched
   `GET /sources?filter=issn:a|b|c|...` request — never one request per
   journal, and never a fuzzy title match. The result is cached in
   `localStorage` for 24 hours.
2. **Fetch recent works by source, batched.** Resolved Source IDs are
   OR'd into `GET /works?filter=primary_location.source.id:S1|S2|...,
   from_publication_date:<90 days ago>`, paginated via OpenAlex's cursor
   API, capped at a sane number of pages, and cached for 20 minutes.
3. **Normalize** every OpenAlex work into a consistent internal `Article`
   shape — reconstructing the abstract from OpenAlex's inverted-index
   format, extracting a safe DOI/article URL, and gracefully defaulting
   missing authors/dates/OA status/abstracts instead of erroring.
4. **De-duplicate** by work ID and then by DOI.

If OpenAlex can't be reached, or a specific journal's source can't be
resolved, the app **never fabricates data or fakes a live result**. Instead
it falls back to a small, clearly-labeled demo dataset (every title is
prefixed "Demo Article:", carries a "Demo data" badge, and a banner explains
what happened) so the app still renders something useful. Any journal that
couldn't be resolved is flagged directly in the "Manage journals" dialog.

## Running it locally

Requirements: Node.js 18.18+ (Node 22 recommended) and npm.

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). No environment
variables, API keys, or accounts are required — it works immediately.

Other useful commands:

```bash
npm run build   # production build
npm run start   # run the production build locally
npm run lint    # ESLint
```

> **Note on this development environment:** the sandbox this app was built
> in blocks outbound network access to `api.openalex.org` at the network
> policy level, so live OpenAlex retrieval could not be exercised end-to-end
> during this build session — the app was verified instead in its automatic
> demo-data fallback mode (see "Current limitations" below). The OpenAlex
> integration code itself is complete and follows OpenAlex's documented,
> no-key REST API; it should fetch real results as soon as it runs
> somewhere with normal internet access (your own machine, Vercel, etc.).

## How local persistence works

Everything the app remembers about you lives in your browser's
`localStorage` — there is no server, no account, and nothing leaves your
device. See `src/lib/storage/localStorageAdapter.ts` and
`src/lib/storage/keys.ts` for the full list of keys. In short, it persists:

- Your followed journal IDs
- Which article IDs you've marked seen
- Your previous-visit timestamp (used for "new since last visit")
- Your current reading position (used for "continue where you left off")
- Saved/bookmarked articles — a **full snapshot** of each article (title,
  authors, journal, date, abstract, link), not just its id, so a saved
  article stays viewable in the **Saved** tab even if you later unfollow
  its journal or it ages out of the 90-day feed window
- Whether you've dismissed the first-run notice
- Short-lived caches of OpenAlex responses (to avoid refetching on every
  reload)

All reads/writes go through one small adapter (`storage.get/set/remove`),
and every hook that owns a piece of state (`useWatchlist`, `useSeenState`,
etc.) is built on that adapter plus `useSyncExternalStore` — never
`localStorage` calls scattered through components.

## Migrating from localStorage to a real backend later

Because persistence is isolated behind one adapter, moving to Supabase (or
any backend) later mainly means changing `localStorageAdapter.ts`'s
implementation of `get`/`set`/`remove` to make network calls instead of
touching `window.localStorage` — the hooks and components that call it
wouldn't need to change. The pieces that would still need real work:

- Adding authentication (there is none in V1 — anyone opening the app in a
  browser gets their own local, unauthenticated state)
- Moving the per-key store model to a per-user schema in Postgres
- Deciding a sync strategy for state that currently assumes "one browser,
  one user" (e.g. merging seen-state across devices)

## Current V1 limitations

- **No accounts / no cross-device sync.** State lives in one browser. Clear
  your browser data (or switch browsers/devices) and it's gone.
- **Live OpenAlex retrieval was not exercised end-to-end in this build
  session** because outbound requests to `api.openalex.org` were blocked by
  this sandbox's network policy (confirmed directly — the request fails at
  the proxy layer, not from the OpenAlex API itself). The integration code
  is complete and built against OpenAlex's documented, no-key REST API; it
  needs to be exercised once against a live network connection (e.g. `npm
  run dev` on your own machine, or a Vercel deployment) to confirm the exact
  shape of live responses matches expectations everywhere.
- **Topic filtering was intentionally not built.** OpenAlex's topic/concept
  metadata isn't reliably populated for every work, and the brief explicitly
  said not to sacrifice core functionality for it.
- **No push notifications or email digests** — this is a pull-based feed you
  check when you want to.
- The 90-day retrieval window and per-request page caps are reasonable
  defaults, not tuned against real traffic volume for all 26 journals at
  once.

## Journal source mapping status

All 26 requested journals are in the catalog with print **and** online
ISSNs cross-checked against multiple independent sources (the ISSN
International Centre portal, publisher pages, Wikipedia) — no journal was
dropped, and no OpenAlex Source ID was hand-typed or guessed anywhere in the
codebase. Resolution from ISSN → OpenAlex Source ID happens **live, at
runtime**, via OpenAlex's own `/sources?filter=issn:...` endpoint (see
`src/lib/openalex/sources.ts`), and any journal OpenAlex doesn't return a
match for is surfaced directly in the "Manage journals" dialog rather than
silently dropped or faked.

Because this build session's network policy blocked outbound requests to
OpenAlex entirely, **that live resolution step could not itself be executed
during development** — it's untested against the real API, though it's a
straightforward, documented OpenAlex query. Confirming it end-to-end (and
noting here if any specific journal genuinely fails to resolve against
live OpenAlex data) is the first thing worth doing once this runs somewhere
with normal internet access.

## Future: deploying to Vercel

This is a standard Next.js App Router project, so it deploys to Vercel with
no configuration: connect the GitHub repo, accept the defaults, deploy. No
environment variables are required for V1 since there's no backend yet.

## Roadmap ideas beyond V1

- Supabase-backed accounts so seen-state and watchlists sync across devices
- Optional email/weekly-digest summaries of new articles
- Author-level or topic-level following, once OpenAlex's topic metadata is
  reliably populated across these journals
