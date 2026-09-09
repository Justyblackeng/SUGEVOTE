# Deploying SUMAS E-VOTE (Netlify frontend + Supabase backend)

## Layout

```
index.html              → deployed to Netlify (static site only)
netlify.toml             → Netlify build config, no functions
supabase-schema.sql      → run once in Supabase's SQL editor
supabase/
  config.toml             → disables JWT auth on all 9 functions
  functions/
    _shared/cors.ts         → shared CORS helper
    _shared/admin.ts         → shared x-admin-key auth check
    _shared/settings.ts      → shared poll-window / results-visibility helper
    get-ballot/index.ts
    get-results/index.ts
    get-turnout/index.ts
    request-otp/index.ts
    submit-vote/index.ts
    verify-otp/index.ts
    admin-overview/index.ts
    admin-ballot/index.ts
    admin-settings/index.ts
```

## 1. Supabase — database

In your Supabase project's SQL editor, run `supabase-schema.sql` (same as before — nothing changed there).

## 2. Supabase — Edge Functions

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

supabase functions deploy get-ballot
supabase functions deploy get-results
supabase functions deploy get-turnout
supabase functions deploy request-otp
supabase functions deploy submit-vote
supabase functions deploy verify-otp
supabase functions deploy admin-overview
supabase functions deploy admin-ballot
supabase functions deploy admin-settings
```

`config.toml` already sets `verify_jwt = false` for all nine, so the CLI picks that up automatically — you don't need `--no-verify-jwt` on the command line.

Set secrets for anything that isn't auto-injected (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` *are* auto-injected into every function — you don't need to set those):

```bash
supabase secrets set RESEND_API_KEY=your_resend_key
supabase secrets set OTP_FROM_EMAIL="SUMAS E-VOTE <onboarding@resend.dev>"
supabase secrets set TOTAL_ROLL_FALLBACK=320
supabase secrets set ALLOWED_ORIGIN=https://your-site.netlify.app
supabase secrets set ADMIN_KEY=some-long-random-string
```

- Skip `RESEND_API_KEY` and `request-otp` will keep working in "dev mode," returning the OTP code directly in the response (same fallback behavior as before).
- `ALLOWED_ORIGIN` locks CORS down to your Netlify domain. Leave it unset and it defaults to `*` (works, but any site can call your endpoints from a browser).
- `ADMIN_KEY` **must** be set, or every admin call fails closed with 401 by design (see `_shared/admin.ts`). This is the value you'll type into the admin unlock screen at `/#admin` — pick something long and random, not a real password you reuse.

Your function URLs will be:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/get-ballot
https://YOUR_PROJECT_REF.supabase.co/functions/v1/get-results
... etc
```

## 3. Frontend — index.html

In `index.html`, replace `YOUR_PROJECT_REF` in the `API` constant near the top of the `<script>` block with your actual Supabase project ref:

```js
const API = "https://YOUR_PROJECT_REF.supabase.co/functions/v1";
```

## 4. Netlify

Deploy this folder (or just `index.html` + `netlify.toml`) to Netlify as a static site — no functions directory, no build step needed. `netlify.toml` publishes `.` and has no `[functions]` block.

## What the admin functions do

- **admin-overview** — returns everything the dashboard renders on load/refresh: turnout, poll settings, and full per-candidate vote tallies. Requires a valid `x-admin-key` header or returns 401.
- **admin-settings** — saves `resultsPublic`, `pollOpenAt`, `pollCloseAt` into `election_settings`. Validates dates and rejects a close time at or before the open time.
- **admin-ballot** — a single endpoint dispatching on `action`: `addPosition`, `updatePosition`, `deletePosition`, `addCandidate`, `updateCandidate`, `deleteCandidate`. Deleting a position or candidate is blocked with `"has_votes"` if any votes already reference it, so results can't be silently erased.

## Poll-window enforcement (new)

The schema and frontend already expected `poll_open_at`/`poll_close_at` to gate voting and reveal results automatically, but the original functions never checked them. That's now wired up:

- `request-otp` and `verify-otp` reject with `poll_not_open` / `poll_closed` once outside the window.
- `submit-vote` rejects with `poll_closed` once the poll has closed.
- `get-results` auto-reveals results once `poll_close_at` passes, even if `results_public` is still `false`, and returns `pollCloseAt` in its "not visible yet" response (which `index.html` already reads).

Leave both `poll_open_at` and `poll_close_at` unset (`null`) in `election_settings` to run with no automatic time boundary — voting stays open and results follow `results_public` only, same as before.
