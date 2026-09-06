# SUMAS E-VOTE — Backend Setup & Deployment

This turns the voting prototype into a real, deployable system. Votes,
turnout, and the "has this student already voted" check all live in a
real database now — not the browser — so results are the same for
every visitor, not just whoever cast the vote.

## How it works

- **Frontend** (`public/index.html`) — a single file that serves both
  the voter-facing site and, at the `#admin` hash route, the electoral
  committee's dashboard. It talks to your backend over the network
  instead of storing anything locally.
- **Backend** (`netlify/functions/*.js`) — nine small serverless
  functions that run on Netlify and talk to your database.
- **Database** — [Supabase](https://supabase.com) (a free, hosted
  Postgres database). Netlify doesn't include a database, so this is
  the piece that actually stores votes.

```
request-otp     → checks a matric number hasn't already voted (and is on the roll, if enforced), then emails a 6-digit code
verify-otp      → checks the code, and if correct issues a short-lived "cleared to vote" ticket
get-ballot      → returns positions & candidates from the database
submit-vote     → requires a valid ticket, records one vote per position anonymously, and consumes the ticket
get-turnout     → returns how many students have voted so far
get-results     → returns live tallies per candidate (auto-unlocks at poll close, or can be hidden manually until then)
admin-overview  → (admin key required) turnout, raw results, and current poll settings
admin-settings  → (admin key required) update poll open/close time and the results-public flag
admin-ballot    → (admin key required) add/edit/remove positions and candidates
```

Votes are stored **anonymously** — the `votes` table never records
which student cast which vote, only that a vote for a given candidate
happened. A separate `voted_log` table tracks *who has voted*
(to block double voting) but not *what they voted for*. The two are
never joined.

Voting now requires email verification: a student enters their matric
number, name, faculty, and email; if eligible, a 6-digit code is
emailed to them; entering it correctly unlocks a one-time ticket
(`vote_authorizations`) that `submit-vote` requires and immediately
deletes once used — so a ticket is good for exactly one ballot, and
expires after 15 minutes even if unused.

> **Upgrading an existing deployment?** Re-run the full contents of
> `supabase-schema.sql` in the Supabase SQL editor — every statement
> in it is idempotent (`create table if not exists`, `add column if
> not exists`, `on conflict do nothing`), so it's safe to run again
> and it will add the new poll-window and rate-limit columns/tables
> without touching your existing data.

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (free tier is enough).
2. Once it's created, open **SQL Editor** and paste in the contents of
   `supabase-schema.sql` from this project, then run it. This creates
   all the tables and loads the ballot (positions + candidates).
3. Go to **Project Settings → API**. You'll need two values from here:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (not the `anon` key) → this is
     `SUPABASE_SERVICE_ROLE_KEY`

   The service role key has full access, which is why it must **only**
   ever be set as a Netlify environment variable — never put it in the
   frontend code or commit it anywhere public.

## 2. Deploy to Netlify

**Easiest path — Netlify CLI:**

```bash
npm install -g netlify-cli
cd sumas-evote
npm install
netlify deploy --prod
```

**Or via GitHub:**

1. Push this folder to a GitHub repo.
2. In Netlify: **Add new site → Import an existing project** → pick the repo.
3. Build settings are already defined in `netlify.toml` — Netlify will
   pick up `public` as the publish directory and `netlify/functions`
   as the functions directory automatically.

## 3. Set your environment variables

In Netlify: **Site settings → Environment variables**, add:

| Key | Value |
|---|---|
| `SUPABASE_URL` | your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service role key |
| `RESEND_API_KEY` | your Resend API key (see step 4 below) — without this, OTP codes are **not emailed** and are returned directly in the response for testing only |
| `OTP_FROM_EMAIL` | *(optional)* the "from" address for OTP emails, e.g. `SUMAS E-VOTE <no-reply@yourdomain.com>`. Defaults to a Resend test address that only works for testing. |
| `TOTAL_ROLL_FALLBACK` | *(optional)* a number, used for the turnout % if `voter_roll` is empty. Defaults to 320. |
| `ADMIN_KEY` | a secret string of your choosing. Required to use the admin dashboard (reached at `/#admin` on your deployed site) — without it, the dashboard is disabled entirely rather than left open. |
| `OTP_RESEND_COOLDOWN_SECONDS` | *(optional)* minimum seconds between OTP requests for the same matric number. Defaults to 45. |
| `OTP_WINDOW_MINUTES` / `OTP_MAX_PER_WINDOW` | *(optional)* how many OTP codes a single matric number may request within a rolling window. Defaults to 4 per 30 minutes. |
| `OTP_IP_WINDOW_MINUTES` / `OTP_IP_MAX_PER_WINDOW` | *(optional)* the same, but per IP address across all matric numbers — catches someone cycling through many matric numbers to dodge the per-matric limit. Defaults to 15 per 30 minutes. |

Redeploy after adding these (Netlify → Deploys → Trigger deploy) so
the functions pick them up.

## 4. Set up OTP email delivery

OTP codes are sent using [Resend](https://resend.com) (free tier
covers a few thousand emails a month — plenty for a student election).

1. Create a free Resend account.
2. **API Keys** → create a key → set it as `RESEND_API_KEY` in Netlify.
3. For real production use, verify your own sending domain in Resend
   (**Domains** → Add domain, then follow their DNS instructions) and
   set `OTP_FROM_EMAIL` to an address on that domain, e.g.
   `SUMAS E-VOTE <no-reply@sumas.edu.ng>`. Without a verified domain,
   Resend only lets you send to your own account email — fine for
   testing, not for a real election.
4. Redeploy so the new environment variables take effect.

**Testing without setting up email:** if `RESEND_API_KEY` isn't set,
`request-otp` still works, but instead of emailing the code, it
returns it directly in the API response (`devCode`), and the frontend
displays it right on the OTP screen with a note that email isn't
configured yet. This is meant purely for development — make sure
`RESEND_API_KEY` is set before running a real election, or every code
will be visible to whoever calls the API.

## 5. Load the real voter roll (optional but recommended)

Right now `voter_roll` is empty, so `verify-voter` accepts **any**
matric number, as long as it hasn't voted yet — useful for testing.

To restrict voting to your actual student list, insert rows into
`voter_roll` via the Supabase SQL editor or table view:

```sql
insert into voter_roll (matric, full_name, faculty) values
  ('SUMAS/22/SC/0142', 'Jane Doe', 'Pharmacy'),
  ('SUMAS/21/MD/0089', 'John Smith', 'Basic Medical Sciences');
  -- ...import your full roll here
```

Once this table has even one row, `verify-voter` switches to strict
mode and rejects any matric number not on the list.

## 6. Add the real candidates

The easiest way is the admin dashboard (see step 7 below) — add
positions and candidates there directly, no SQL needed. You can also
replace the placeholder rows in `candidates` (from
`supabase-schema.sql`) by re-running edited `insert` statements or
editing rows directly in the Supabase table editor, if you'd rather
work in SQL. Either way, the frontend pulls the ballot fresh from the
database on every page load — no code changes needed.

## 7. Poll close time, results lock, and the admin dashboard

The admin dashboard lives in the same `index.html` as the voter site —
add `#admin` to your deployed site's URL (or `localhost:8888/#admin`
locally) and enter your `ADMIN_KEY` to reach it. It's a hidden route,
not a separate page: nothing links to it from the voter-facing screens,
so students never see it, but anyone who knows the URL and has the key
can get in. From there you can, without touching SQL:

- **Set when polls open/close.** Both are optional. Leave them blank
  to run with no automatic time boundary (voting stays open
  indefinitely, same as before this feature existed). Once
  `poll_close_at` is set and passes, `request-otp` and `submit-vote`
  both start rejecting new votes with a clear "polls have closed"
  message — including for a student who obtained a ticket in the last
  moments before close, since `submit-vote` re-checks the close time
  itself rather than trusting a ticket issued earlier.
- **Toggle results public.** By default `election_settings.results_public`
  is `'true'`, so results are visible live (handy for demos). Flip
  this off from the dashboard to hide results until you're ready —
  **but note results also auto-reveal the instant `poll_close_at`
  passes**, regardless of this toggle, so you don't have to remember
  to flip it back manually on election night.
- **Watch live tallies.** The dashboard always shows raw vote counts,
  independent of the results-public setting — that's what makes it
  the admin view rather than the public one.
- **Add, edit, or remove positions and candidates.** This is meant to
  be your main way of building the ballot before polls open — no SQL
  needed. Add a position, then add candidates under it directly from
  the dashboard; edit a title, name, or tag any time; reorder
  positions by editing their sort order. Once a position or candidate
  has any votes recorded against it, deleting it is blocked
  automatically at the database level, so it stays safe to use the
  dashboard even after voting is underway — you just can't remove
  something people have already voted for.

The same thing is still possible directly in SQL if you'd rather not
use the dashboard:

```sql
update election_settings set value = 'false' where key = 'results_public';
update election_settings set value = '2026-03-14T17:00:00Z' where key = 'poll_close_at';
```

## Local testing

```bash
npm install
netlify dev
```

This runs the functions and frontend together on `localhost:8888`,
using the same environment variables (put them in a `.env` file for
local runs, or `netlify env:import`).

## Security notes

- The `service_role` key bypasses Row Level Security and must never be
  exposed to the browser. It's only referenced inside
  `netlify/functions/*.js`, which run server-side.
- All tables have RLS enabled with no public policies, so Supabase's
  public `anon` key (if it ever leaked) has zero read/write access.
- `submit-vote` re-validates every submitted position/candidate pair
  against the database before recording anything, so a tampered
  request can't stuff invalid votes.
- Double voting is prevented by a database-level unique constraint on
  `voted_log.matric`, not just a client-side check — so it holds even
  under concurrent requests.
- Voting requires a one-time authorization ticket issued only after a
  correct OTP is entered. The ticket is deleted the instant it's used,
  and expires after 15 minutes even if it isn't — so it can't be
  reused or replayed by intercepting a request.
- OTP requests are rate-limited two ways: a short cooldown plus a
  rolling-window cap per matric number (stops one student's inbox, or
  a script targeting one matric number, from being flooded), and a
  coarser per-IP window across all matric numbers (stops one
  connection from working around the per-matric limit by cycling
  through many matric numbers). `verify-otp` separately still caps
  incorrect-code attempts per outstanding code at 5.
- Poll close time is enforced on the server at three points
  (`request-otp`, `verify-otp`, `submit-vote`), not just hidden in the
  UI — so a request built by hand against the API after polls close
  is rejected the same as one made through the page.
- The admin dashboard is a single shared-secret (`ADMIN_KEY`) gate. If
  that variable isn't set in Netlify, the `#admin` route and its three
  backing functions (`admin-overview`, `admin-settings`, `admin-ballot`)
  refuse every request rather than defaulting open. Reaching `/#admin`
  in a browser only reveals an empty key-entry form — the dashboard's
  markup ships to every visitor (it's the same static file as the
  voter site), but none of its data loads without a valid key.
- Live results (`get-results`) are public by default — anyone can view
  current vote counts without an admin key or logging in, including
  from a "View live results" link right on the voting page, for
  election transparency. This is separate from the admin dashboard's
  view: the admin view also shows turnout and ballot management
  regardless of the public toggle, while the public view respects
  `results_public` and the poll-close auto-unlock described above.
