-- STATS Research Feed — per-user synced state.
--
-- Run this once against a fresh Supabase project (SQL Editor → New query →
-- paste → Run). It is idempotent, so re-running it is harmless.
--
-- Design notes:
--
--   * Three slices sync: the journal watchlist, seen article ids, and saved
--     articles. OpenAlex caches and visit timestamps deliberately stay in the
--     browser — they are disposable performance data and genuinely per-device.
--
--   * The watchlist lives in a single `text[]` column because it is tiny
--     (bounded by the journal catalog) and because its *absence* has to be
--     distinguishable from "follows nothing". The existence of a
--     `user_settings` row is what tells the client this account has synced
--     before; without that marker, a user who deliberately cleared their
--     watchlist would have the defaults silently restored on every load.
--
--   * Seen and saved articles are one row per item instead, so marking a
--     single article seen is a one-row insert rather than a rewrite of a list
--     that grows without bound over years of use. It also makes concurrent
--     edits from two devices merge naturally instead of clobbering.
--
--   * Every table is protected by row-level security keyed on `auth.uid()`.
--     The browser only ever holds the publishable anon key, so these policies
--     are the entire authorization model: a signed-in user can read and write
--     exactly their own rows and nothing else, and an anonymous caller can do
--     nothing at all. The service-role key is not used by this app.

-- ---------------------------------------------------------------------------
-- user_settings: one row per user. Row existence == "this account has synced".
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  followed_journal_ids text[]      not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.user_settings is
  'Per-user feed settings. The presence of a row marks an account as initialized, which is what lets the client tell "cleared their watchlist" apart from "never synced".';

-- ---------------------------------------------------------------------------
-- seen_articles: which articles the user has manually marked as seen.
-- ---------------------------------------------------------------------------
create table if not exists public.seen_articles (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  article_id text        not null,
  seen_at    timestamptz not null default now(),
  primary key (user_id, article_id)
);

comment on table public.seen_articles is
  'One row per (user, article) marked seen. Row-per-item so a single click is a one-row write.';

-- ---------------------------------------------------------------------------
-- saved_articles: bookmarks, carrying a full snapshot of the article.
-- ---------------------------------------------------------------------------
create table if not exists public.saved_articles (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  article_id text        not null,
  article    jsonb       not null,
  saved_at   timestamptz not null default now(),
  primary key (user_id, article_id)
);

comment on column public.saved_articles.article is
  'Full normalized Article snapshot (title, authors, journal, date, abstract, link), not just an id — so a saved article stays readable after its journal is unfollowed or it ages out of the 90-day OpenAlex window.';

-- Listing a user's saved articles newest-first is the only access pattern that
-- is not already served by the primary key.
create index if not exists saved_articles_user_saved_at_idx
  on public.saved_articles (user_id, saved_at desc);

-- ---------------------------------------------------------------------------
-- Keep user_settings.updated_at honest.
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_settings_touch_updated_at on public.user_settings;
create trigger user_settings_touch_updated_at
  before update on public.user_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security. Deny by default, then allow owner-only access.
-- ---------------------------------------------------------------------------
alter table public.user_settings  enable row level security;
alter table public.seen_articles  enable row level security;
alter table public.saved_articles enable row level security;

-- `for all` covers select/insert/update/delete. `using` gates reads and the
-- rows an update/delete may touch; `with check` gates the rows an insert or
-- update may produce — both are required, or a user could write a row owned by
-- someone else.
drop policy if exists "user_settings are private to their owner" on public.user_settings;
create policy "user_settings are private to their owner"
  on public.user_settings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "seen_articles are private to their owner" on public.seen_articles;
create policy "seen_articles are private to their owner"
  on public.seen_articles
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "saved_articles are private to their owner" on public.saved_articles;
create policy "saved_articles are private to their owner"
  on public.saved_articles
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
