# Lyric Capital Group — Firm Priorities Dashboard

A self-contained dashboard (single `index.html`) with real email/password login,
a shared Postgres database, and live sync between viewers.

- **Hosting:** any static host (Vercel)
- **Auth + database:** Supabase (free tier is plenty)
- **Login:** email + password, verified server-side by Supabase. Passwords are
  never stored or checked in the page. Built-in "Forgot password" reset emails
  and an in-app "Account" panel to change passwords.

---

## 1. Supabase setup (~10 minutes, once)

1. Go to https://supabase.com → create a project (or use your existing one).
2. **Run the schema:** SQL Editor → New query → paste all of `schema.sql` → Run.
   This creates the tables, locks them down so only signed-in users can read or
   write (row-level security), turns on live sync, and seeds the board with the
   current data exported from the Claude version.
3. **Turn off public sign-ups** so only accounts you create exist:
   Authentication → Sign In / Up → disable "Allow new users to sign up".
4. **Create the three accounts:** Authentication → Users → "Add user" →
   "Create new user", one per person:
   - vdevalapalli@lyriccapitalgroup.com
   - rcameron@lyriccapitalgroup.com
   - rgarzia@lyriccapitalgroup.com
   Check "Auto Confirm User" for each. You set an initial password here.
   **Please don't use `firstname1`** — those are guessed in one try on a public
   URL. Use the "Send invitation" option instead (each person sets their own
   password from an email link), or set a long random temporary password and
   have everyone change it via the dashboard's **Account → Update password**
   on first login.
5. **Allow your site's URL for password-reset links:**
   Authentication → URL Configuration → set Site URL to your Vercel URL
   (e.g. `https://lyric-priorities.vercel.app`) once you have it, and add it
   to Redirect URLs.
6. **Copy your keys:** Project Settings → API →
   - Project URL  (looks like `https://xxxxxxxx.supabase.co`)
   - `anon` public key

## 2. Configure the app (1 minute)

Open `index.html`, find the `CONFIG` block at the top of the `<script>`,
and paste in:

```js
SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
SUPABASE_ANON_KEY: "eyJ...",
```

The anon key is designed to be public — the row-level security rules in
`schema.sql` are what protect the data (nothing is readable without a valid
login). `EMAIL_TO_PERSON` maps each login to their team member so the
personalized "My week" tab works with zero setup; edit it if emails change.

With `CONFIG` left empty, the page runs in demo mode (no login, data stays in
the browser) — handy for previewing locally.

## 3. GitHub + Vercel (~5 minutes)

1. Create a GitHub repo, add `index.html`, `schema.sql`, `README.md`, push.
2. On https://vercel.com → Add New → Project → import the repo.
   Framework preset: **Other**. No build command, no env vars — it's static.
   Deploy.
3. Take the deployed URL back to Supabase step 5 (Site URL / Redirect URLs)
   so "Forgot password" emails link back to the dashboard.

That's it. The repo is public-readable only if you make it so — a private repo
is fine; Vercel deploys from private repos.

## What each person experiences

- Opening the URL shows the **sign-in page** (email + password).
- After signing in, the dashboard opens on **their personalized tab**
  ("Ross's week"): overdue first, then Today / This week / This month /
  Long term, plus workstreams they lead and their upcoming time off.
- **Account** (top right): change password, sign out.
- All edits save to the shared database instantly and appear live for anyone
  else viewing — same behavior as the Claude-hosted version.

## Security model, plainly

- Authentication and password checks happen on Supabase's servers, never in
  the page. The page ships no secrets (the anon key is public by design).
- Data access requires a valid session; with sign-ups disabled, the only
  sessions possible are the accounts you created.
- Anyone signed in can read/write the whole board (that's the intent — it's a
  shared firm board). The `profiles` table (who's linked to which team member)
  is per-user: each account can only touch its own row.
- Password resets go through Supabase's emailed magic link; the dashboard
  handles the "set a new password" step when someone arrives from that link.
