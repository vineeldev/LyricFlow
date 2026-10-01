# Lyric Flow — Firm Priorities Dashboard (Lyric Capital Group)

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

## The Vault (weekly partner triage)

The **Vault** tab holds everything that hasn't been given a timeline yet — the
firm's full laundry list, grouped Deals first, then Operations & Firm Build.
Vault items are invisible to every other view (Chief View, Partner view,
Action list, stats, everyone's "My week") until they're scheduled.

Monday routine with the partners:

1. Open the Vault. Each row has owner, due date, and a timeline dropdown.
2. Set owner and date if you want them, then pick a timeline —
   Today / This week / Next week / This month / Next month / This quarter /
   Next quarter. The task leaves the Vault instantly and appears on the
   dashboards; its project is scheduled with it.
3. Anything can be sent *back*: every timeline dropdown in the app includes
   "Vault".

Add new items straight into the Vault ("New vault project" or the "+ Add a
task" line under any project) and the search box filters as you type.

### Loading the Vault into an existing installation

`reset-to-vault.sql` wipes the current tasks and loads the 28 Sep 2026
Priority Register (81 projects — every deal standalone — and 165 tasks). Order matters:

1. Deploy the new `index.html` first (it knows the new timelines and the
   Vault). Wait for Vercel to finish.
2. Then run `reset-to-vault.sql` in Supabase → SQL Editor.
3. Reload the dashboard. Team, out-of-office, and label customizations are
   kept; only tasks are replaced (and the team list gains Thomas, Victor,
   Mason, and Adam).

Fresh installations get the same Vault from `schema.sql` directly.

## Asana mirror (one-way: Flow → Asana)

Every save in Flow — projects, tasks, owners, dates, timelines, completions,
and next-step notes — is pushed into a **"Lyric Flow"** project in Asana.
Supabase stays the live store; Asana holds a complete, always-current copy
(and gives the team Asana's mobile app and notifications). Edits made in
Asana do not flow back.

### One-time setup (~5 minutes)

1. **Get an Asana token:** Asana → your avatar → Settings → Apps →
   Developer apps → "Create new token". Copy it (shown once).
2. **Add environment variables in Vercel:** Project → Settings →
   Environment Variables → add, then redeploy:
   - `ASANA_PAT` — the token from step 1
   - `SUPABASE_URL` — same as `CONFIG.SUPABASE_URL` in `index.html`
   - `SUPABASE_ANON_KEY` — same as `CONFIG.SUPABASE_ANON_KEY`
   - `ASANA_WORKSPACE_GID` — optional; only if the token sees more than one
     workspace (otherwise the first one is used)
3. **Commit `api/asana.js`** (this repo's `api` folder). Vercel deploys it as
   a serverless function at `/api/asana` automatically — nothing to configure.
4. In Flow: **Account → Set up Asana**. This creates the "Lyric Flow"
   project and three custom fields (Flow Timeline, Flow Group, Flow Owner)
   in your workspace, and remembers them.
5. **Account → Sync everything now** pushes the whole current board once.
   From then on every save mirrors itself within about a second.

Notes:
- The token never reaches the browser. `/api/asana` holds it and only serves
  requests carrying a valid Flow (Supabase) login.
- Asana assignees are set by email. Only team members with an email saved in
  Flow (Vinny, Ross, Rich today) get a real Asana assignee; everyone else is
  recorded in the "Flow Owner" field. Add emails to the team data to extend.
- Custom fields need an Asana Premium+ workspace. If unavailable, the mirror
  still works and writes timeline/group/owner into each task's description.
- If a push fails (network, token expired), Flow shows a toast and keeps the
  Supabase save; "Sync everything now" reconciles later.
- Quick to-dos (personal) are not mirrored.

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
