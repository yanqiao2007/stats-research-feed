# Turning on optional accounts

STATS Research Feed works with no backend at all. Everything a reader does —
their watchlist, what they have marked seen, what they have saved — lives in
their browser, and that stays true whether or not you follow this guide.

Setting up Supabase adds **one optional thing**: a reader can sign in with
their email and have those three things follow them to another computer. No
part of the app requires it, and if the environment variables below are
absent, no sign-in UI is rendered and no network calls are made.

Budget about 15 minutes. You need a free Supabase account.

---

## 1. Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a
   new project.
2. Give it a name (`stats-research-feed` is fine), set a database password,
   and pick the region closest to your users.
3. Wait for provisioning to finish — a couple of minutes.

## 2. Create the tables

In the dashboard, open **SQL Editor → New query**. Paste the entire contents
of [`supabase/migrations/0001_user_state.sql`](supabase/migrations/0001_user_state.sql)
and press **Run**.

That creates three tables and — importantly — the row-level security policies
that make each row readable and writable only by the user it belongs to. The
script is idempotent, so re-running it is harmless.

| Table | Holds |
|---|---|
| `user_settings` | One row per user: their followed journal ids. The row's existence also marks the account as initialized. |
| `seen_articles` | One row per article marked seen. |
| `saved_articles` | One row per bookmark, with a full snapshot of the article. |

Verify it worked: **Table Editor** should list all three, each showing an
"RLS enabled" badge. If any table says RLS is *disabled*, stop and re-run the
script — without those policies every user could read every other user's rows.

## 3. Point the app at the project

In the dashboard, open **Project Settings → API** and copy:

- the **Project URL**, and
- the **anon / public** key (also labelled *publishable*).

Create `.env.local` in the repository root:

```bash
cp .env.example .env.local
```

Then edit it to hold your two real values:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Restart `npm run dev`. A **Sign in** button should now appear in the header.

> **Never put the `service_role` key here.** It bypasses row-level security
> entirely, and anything in a `NEXT_PUBLIC_*` variable is compiled into the
> JavaScript every visitor downloads. The anon key is designed to be public;
> the service-role key is not, and this app never uses it.

## 4. Allow the redirect URLs

Supabase will only send people back to URLs you have allowlisted. Under
**Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` while developing, your real domain in
  production.
- **Redirect URLs**: add every origin the app runs on, with the callback path:
  - `http://localhost:3000/auth/confirm`
  - `https://your-app.vercel.app/auth/confirm`
  - `https://your-app-*.vercel.app/auth/confirm` *(only if you want Vercel
    preview deployments to be able to sign in — wildcards are supported)*

Getting this wrong is the single most common cause of a link that opens to
"Sign-in failed". The app always asks Supabase to redirect to
`<current origin>/auth/confirm`, so whatever origin you browse from must be
listed.

## 5. Sort out email delivery before you share it

This is the step people skip and regret.

Supabase's built-in email service is **rate-limited to 2 messages per hour**
and is explicitly described by Supabase as best-effort and *not* for
production — it exists for exploring Auth and testing templates. That is
enough to test the flow yourself. It is nowhere near enough for a lab, a
seminar, or anyone you share the link with.

For real use, connect a custom SMTP provider under **Authentication → Emails
→ SMTP Settings**. [Resend](https://resend.com) has a free tier that is ample
here. Once custom SMTP is configured Supabase applies a default limit of 30
messages per hour, which you can raise under **Authentication → Rate Limits**.

While you are there, know that **institutional mail is the other hazard**.
University filters sometimes quarantine automated sign-in mail, and some
security scanners *follow* links in incoming mail before the human does —
which consumes a one-time sign-in link and produces a confusing failure. The
app's "check your email" screen warns about exactly this. A properly
configured sending domain (SPF/DKIM via your SMTP provider) makes it much
rarer.

## 6. Deploy

Add the same two variables in **Vercel → your project → Settings →
Environment Variables**, for every environment you want accounts on, then
redeploy. Add the deployed origin's `/auth/confirm` to the Supabase redirect
allowlist from step 4.

If you deploy *without* the variables, the deployment simply has no accounts —
which is a perfectly reasonable thing to do for a public demo.

---

## Optional: harden the sign-in link

By default the app uses Supabase's unmodified magic-link email, which works
immediately and — usefully — works even when someone requests the link on
their laptop and opens it on their phone. The trade-off is that the session
arrives in the URL fragment.

If you would rather the link carry a single-use hash and no access token, edit
**Authentication → Emails → Magic Link** and replace the link with:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">
  Sign in to STATS Research Feed
</a>
```

No code change is needed — `src/app/auth/confirm/page.tsx` already handles
both link shapes. Test it before relying on it; a typo in the template breaks
sign-in for everyone.

---

## Checking it actually works

1. Click **Sign in**, enter your email, submit.
2. The dialog should switch to "Check your email".
3. Open the link. You should land on `/auth/confirm`, see "Signing you in…",
   and be returned to the feed with your email in the header.
4. Open **Table Editor → user_settings**. There should be exactly one row,
   with your followed journal ids in it.
5. Mark an article seen, then check `seen_articles` for a new row.
6. Open the app in a different browser, sign in as the same user, and confirm
   the watchlist and seen article carry over.

Step 6 is the one worth doing — it is the only one that proves sync, rather
than proving that writes happen.

## When something goes wrong

| Symptom | Cause |
|---|---|
| No **Sign in** button at all | Environment variables missing or the dev server was not restarted after adding them. `NEXT_PUBLIC_*` values are inlined at build time. |
| "Could not reach the sign-in service" | `NEXT_PUBLIC_SUPABASE_URL` is wrong, or the project is paused. Free projects pause after a week of inactivity — resume it in the dashboard. |
| Link opens to "Sign-in failed" | The origin you are browsing from is not in the redirect allowlist (step 4), or the link was already used or expired. |
| No email arrives | The 2-per-hour built-in limit, or a spam filter. See step 5. |
| Signed in, but nothing syncs | The migration did not run, or RLS policies are missing. Check **Table Editor** for the three tables and the "RLS enabled" badge. The account dialog shows the server's actual error message. |
| "new row violates row-level security policy" | The tables exist but the policies from step 2 do not. Re-run the migration. |

## What this does and does not protect

The anon key in the browser bundle grants nothing on its own. Every table
denies access by default and allows a row only when `auth.uid()` matches that
row's `user_id`, checked by Postgres on both read and write. A reader cannot
see, modify, or delete another reader's data, and an unauthenticated visitor
cannot touch any of it.

What it does *not* do: there is no encryption at rest beyond what Supabase
provides, no audit log, and no deletion UI. A user who wants their data gone
has to ask you to delete their row — `delete from auth.users where email =
'...'` cascades to all three tables. If you plan to use this with human
subjects or anything IRB-relevant, that gap is worth closing first.
