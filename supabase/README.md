# Supabase for TrailWaterMaps

The app is still a static, no-build site. Only accounts, community content and
the app's own usage stats talk to Supabase (project `kbdrxtyacmihabwadzzz`);
maps, flows, weather and the Field Book never do. Every file here is pasted into **SQL Editor → New query →
Run**, and every one is safe to run again.

| File | What it makes |
|---|---|
| `reports.sql` | `reports`: the "Report an issue" form. Anyone may insert; nobody reads through the public key. |
| `keepalive.sql` | `keepalive()`: called every 3 days by `.github/workflows/supabase-keepalive.yml` so the free project doesn't pause. |
| `auth.sql` | Accounts (Server roadmap step 1) and admin roles (the base of step 8): `profiles`, `user_roles`, `is_admin()`, `delete_my_account()`, `admin_stats()`, and admin read/triage on `reports`. |
| `metrics.sql` | Usage stats: `events` (insert-only for the app), `admin_metrics()` for admin.html, and `delete_my_account()` again, now erasing the user's stats. Run it after `auth.sql`. |

The browser side is `js/auth.js` (the sign-in flow over plain `fetch`),
`js/signin.js` (the email-and-code form), `js/account.js` (the app's account
sheet), `js/metrics.js` (usage stats) and `admin.html` + `js/admin.js`.

---

## Step 1: login, profiles and admin roles — what we did and why

Written to be lifted into another project. Nothing here is specific to maps.

### Sign-in by a 6-digit email code

1. `POST /auth/v1/otp` with `{email, create_user: true}`. Supabase emails a
   code. An address it hasn't seen becomes an account, so sign-up and sign-in
   are the same form.
2. `POST /auth/v1/verify` with `{type: "email", email, token}`. The code buys a
   **session**: an access token (a JWT that expires in about an hour) and a
   refresh token.
3. Every signed-in request carries `Authorization: Bearer <access token>`. The
   database reads the user's id out of it with `auth.uid()`.
4. Before the access token expires, `POST /auth/v1/token?grant_type=refresh_token`
   swaps the refresh token for a new pair. **Refresh tokens rotate**: each one
   works once. Two refreshes racing (two tabs, or two calls at once) can sign
   the user out, so the client lets only one run at a time and re-reads storage
   first in case another tab already refreshed.

**Why a code and not a magic link:** on an iPhone a link in Mail opens Safari,
and a home-screen web app keeps its storage apart from Safari's, so the session
would land in the wrong place. A code typed into the app signs in the app.
**Why not passwords:** no passwords to store, reset or leak.

**Why plain `fetch` and not supabase-js:** no third-party script to download or
keep cached for offline use, and each step of the flow is visible in one file.
The cost is writing the refresh logic ourselves (`js/auth.js`, under 300 lines with its comments).

### Why the publishable key is safe in the page

`js/config.js` holds an `sb_publishable_…` key. It says *which project* the
request is for. It grants nothing beyond what the `anon` role (signed out) or
`authenticated` role (signed in) is allowed by grants and row-level security.
It goes in the `apikey` header only. It is **not a JWT**, so it never goes in
`Authorization`; that header is only ever the user's own access token.

The key that bypasses everything is `service_role` (or a `sb_secret_…` key).
It never goes in the app, in git or in a browser. Anything that needs it runs
in an Edge Function.

### Row-level security *and* explicit grants

Two separate locks, and a table needs both:

- **Grants** say which *operations* a role may attempt: `select`, `insert`,
  `update`, `delete`. This project grants the public roles nothing by default,
  so a table with policies but no grant answers "permission denied".
- **RLS policies** say which *rows* those operations see. With RLS on and no
  matching policy, a select returns zero rows and an update changes zero rows,
  **without an error**. The admin page checks for that: a status change that
  comes back with no row is reported as refused.

Every table: `enable row level security`, a policy per operation, a grant per
operation. `auth.sql` revokes first and then grants, so a re-run (or a
project whose defaults do grant) ends in the same state.

Policies use `(select auth.uid())` rather than `auth.uid()`: wrapped in a
sub-select, Postgres works it out once per query instead of once per row.

### Column grants

`profiles` grants `update (display_name)`, not `update`. A user can change
their display name and nothing else in their own row: not `id`, not
`created_at`. Same for `reports`: admins get `update (status)`, so the
reporter's own words and email can't be edited after the fact.

**A column grant only restricts if there is no table-wide grant.** A
table-level `update` covers every column, which is why `auth.sql` runs
`revoke update` before `grant update (status)`.

### `security definer` functions, and the `search_path` trap

A normal function runs with the caller's rights. A `security definer` function
runs with its **owner's** rights, which is how:

- the sign-up trigger inserts a profile the new user has no insert right for;
- `is_admin()` reads `user_roles` whatever that table's own policies say;
- `admin_stats()` counts `auth.users`, which no app role may read;
- `delete_my_account()` deletes from `auth.users`.

The trap: such a function looks up unqualified names on the **caller's**
`search_path`. A caller who can create a function or table named like one you
use, earlier on the path, gets their code run with your rights. So every one
here has `set search_path = ''` and writes every name in full
(`public.user_roles`, `auth.users`).

Two more rules:

- **Check permission inside the function.** `admin_stats()` raises unless
  `is_admin()`, because `security definer` means RLS no longer protects what
  it reads. A definer function is a door through RLS; it must check who is
  knocking.
- **Revoke `execute` from `public` and `anon`.** Postgres grants every new
  function to everyone. Supabase exposes functions as `/rest/v1/rpc/<name>`,
  so an un-revoked function is callable by anyone holding the public key.

`auth.uid()` inside a definer function is still the *caller's* id: it reads
the request's JWT, not the owner.

### Roles in a table, never in `user_metadata`

`user_metadata` is editable by the user themselves with one call to
`/auth/v1/user`. A role stored there is a role anyone can give themselves.
Roles live in `public.user_roles`, which the app can read (your own rows) but
never write: no insert, update or delete grant. Roles are granted in the SQL
Editor, which runs as the project owner.

Policies ask `public.is_admin()`. Hiding the admin page's contents from a
non-admin is courtesy; the policies are the protection.

### Deleting an account

`delete_my_account()` deletes the caller's row from `auth.users`. Everything
keyed to it goes too, because each reference says `on delete cascade`:
`profiles`, `user_roles`, and Supabase's own sessions, refresh tokens and
identities. Issue reports are not linked to accounts and stay. Since
`metrics.sql` it first deletes the user's usage stats (see the metrics step
below).

**Every future table that references `auth.users` must say what happens on
delete** (`cascade`, or `set null` to keep the content but drop the author),
or the delete fails. Files in Storage (step 3, photos) are not rows and are
not cascaded; they will need deleting through the Storage API first.

The app store needs in-app account deletion (Apple guideline 5.1.1(v)), and
clients will ask for it. Deleting is immediate and permanent here; there is no
grace period.

### Sessions in a no-build web app

- The session is stored in `localStorage.sbSession`. In this app that is
  **user data**, not a cache: it has no `LS_CACHE_PREFIXES` prefix, so the
  storage clean-up never deletes it, and it is written through `lsSetSafe()`.
- Expiry is counted from `expires_in` on the phone's own clock, so a phone
  whose clock is off still refreshes on time. If the server refuses a token
  anyway (401), the client refreshes once and retries.
- A refresh refused with 400/401 (revoked, reused, account deleted) signs out
  on this phone. A network failure or a 5xx keeps the session and tries again
  on the next call.
- "Sign out" uses `/auth/v1/logout?scope=local`: this phone only.
- Pages on the same origin share the session (the app and `admin.html`), and a
  sign-out in one tab reaches the other through the `storage` event.
- The service worker (`sw.js`) never touches `*.supabase.co`: it handles
  same-origin files, Leaflet, fonts and map tiles only, and ignores anything
  that isn't a GET.

### The admin page

`admin.html` is a separate page, not in the offline shell, `noindex`, with a
Content-Security-Policy that runs only the site's own script files. It shows
text strangers typed into the report form to an account that can change data,
so every field is escaped and no injected markup could run as script.

---

## Step: first-party metrics, what we did and why

Written to be lifted into another project, like the step above.

### What is recorded

`js/metrics.js` records a short, fixed list of events, and the database
refuses any other `kind`:

| Kind | When | `target` |
|---|---|---|
| `launch` | once per page load | |
| `river_open`, `lake_open` | a river's or lake's sheet opened (not the tour's demo of the Snake; the same water counts once per 30 minutes) | its id, plus its `name` |
| `region_view` | the state or park under the map centre, once the view has settled for 1.5 s, from zoom 6, not while the chooser is up; once per region per 30 minutes | the zone code, plus its `name` |
| `zone_pick` | a tap on a chooser zone, or a Jump-to entry | the zone code (with `name`), or the Jump-to label |
| `layer_on` | a Map Icons chip switched on | the chip id |
| `gauge_tap` | a gauge dot, or a dot in "Every USGS gauge" | the gauge key or USGS site id |
| `trip_logged`, `favourite_add` | ✓ Fished tapped; ☆ Favorite switched on (only if the book saved it) | `river` or `lake` |
| `fieldbook_open`, `float_start`, `float_end`, `laketrip_start`, `laketrip_end`, `offline_save`, `report_sent`, `signin`, `signout`, `tour_start` | as named (`float_end` and `laketrip_end` on every way a float or trip ends: saved, empty, or discarded) | |

Each row also carries the phone's id, the app version, whether it was opened
from the home screen, and when the phone recorded it. Nothing else: no
location fix, no Field Book contents, no notes. Feature events deliberately
don't name the water (which river a trip was logged on), only the kind.

### One lasting random id per phone, and the account when signed in

The owner's decision: count people with a `crypto.randomUUID()` kept in
`localStorage.metricsDevice`. It is not under a cache prefix, so storage
clean-up never resets it. While someone is signed in, each event also
carries their `user_id`, so for that person this is a history of the rivers
and lakes they open and the regions they look at, linked to their account.
That is why the safeguards below exist.

An event keeps the account it was recorded under. Events recorded signed out
and sent later signed in go with `user_id` null; events recorded under an
account that has since signed out go without one. Sign-out sends the queue
at once, before the token goes.

### The safeguards

- **No user switch while the app is in testing** (owner's decision,
  2026-10-19): every phone sends. A privacy page disclosing the stats is
  needed before public launch. Local dev hosts (localhost, 127.0.0.1, [::1],
  `*.localhost`, `*.test`, `*.pages.dev`) never send.
- **Delete my account erases the history.** `delete_my_account()` deletes
  every event with that `user_id`, and every event from any `device_id` that
  user ever sent signed in, so the anonymous history from their phones goes
  too. Then the phone makes itself a new id, so what it sends afterwards
  isn't joined to the erased history. The function is identical in
  `auth.sql` and `metrics.sql`, and skips the events delete while the table
  doesn't exist, so re-running either file leaves the same function.
- **Only admins read it.** The table is insert-only for the app's key; an
  admin select policy and `admin_metrics()` (which checks `is_admin()`
  itself) are the only ways in.

### The table and its rules

- Insert-only for `anon` and `authenticated`, with a **column grant**: the
  app may set `device_id, user_id, kind, target, name, app_version,
  standalone, client_at` and nothing else, so it can't backdate
  `created_at`. A `select` grant to `authenticated` exists only so the admin
  policy can work; RLS returns zero rows to everyone else, and `anon` has no
  select at all. No update or delete for anyone through the app.
- The insert policy is `user_id is null or user_id = auth.uid()`: a row can
  carry no account or your own, never someone else's.
- Check constraints on every text field (length, no control characters),
  `kind` from the fixed list, and `client_at` within a day ahead of and 30
  days behind `created_at`. Measured against `created_at` rather than
  `now()` on purpose: a check that calls `now()` would fail old rows when a
  backup is restored.
- `user_id` references `auth.users` with `on delete set null`, the fallback
  rule every such table needs, even though `delete_my_account()` deletes the
  rows first.
- Indexes on `created_at`, `(kind, created_at)`, `device_id`, and a partial
  one on `user_id` for the account delete.

### Sending

- The queue is `localStorage["metrics:queue"]`, capped at 300 events. The
  `metrics:` prefix is in `LS_CACHE_PREFIXES` and ranked first in
  `lsMakeRoom()`: when the Field Book needs room the unsent stats go before
  anything else, and a stats write that doesn't fit stays in memory.
- One POST of a JSON array to `/rest/v1/events` with `Prefer:
  return=minimal`: about 20 s after launch, whenever 25 are waiting, and when
  the page is hidden (`keepalive`, at most 100 rows and 48 KB, since keepalive
  bodies share 64 KB). Signed in it goes through `Auth.authFetch` (token
  refreshed when nearly out); on page hide, a token within a minute of expiry
  can't be refreshed in time, so the queue waits for the next launch.
- `apikey` is always the publishable key; `Authorization` only ever the
  user's own token. Signed out, rows have no `user_id` key at all; signed
  in, every row has one, so the keys match across the batch.
- No signal, a timeout, a 5xx, 408 or 429: the batch goes back in the
  queue. Any other 4xx: the batch is dropped (one `console.warn`), so a bad
  row can't wedge the queue. A 404 for the table (`PGRST205`, `42P01`): stats
  switch off for that page load and the queue is kept, so nothing is lost
  before `metrics.sql` has been run.
- It never touches the USGS budget or `apiPaused()`.

### Reading it

`admin.html` has a **Usage** section: a 7, 30 or 90 day window, tiles for
phones active in the last 24 hours, 7 and 30 days (with how many were
signed in), launches and returning phones, a bar chart of launches per day
(inline SVG, no library, inside the page's CSP) with the same numbers as a
table, then folds for the top 25 rivers, lakes, regions and picks, feature
use, Map Icons chips, home screen against browser, and app versions. The
page passes the browser's time zone, so a bar is a local day.

**Names travel with the events.** `admin.html` can't load the app's 3.7 MB
river data, so the app sends the name it showed alongside the id
(`name`, on river, lake, region and zone events). It costs about 20 bytes on
those rows. Where there is no name, the id is shown.

### Size and when to think about retention

Measured on a local Postgres 16 with 100,000 rows: about **240 bytes a row**
with the indexes, so about 2 KB a launch. The free plan's 500 MB holds
roughly 200,000 launches: years at 50 a day, about a year at 500 a day,
about three months at 2,000 a day. `admin_metrics()` over 100,000 rows in
the window takes about a second. The retention statement is at the bottom of
`metrics.sql`, commented out.

### What it replaced

A third-party page-view counter (GoatCounter). Its script tag is gone from
`index.html`, and the app now loads nothing for analytics from anyone else.

---

## Owner checklist

Do these in order. Menu names are the Supabase dashboard's as of late 2025;
if one has moved, search the dashboard for the **setting** name in bold.

1. **Run `auth.sql`.** SQL Editor → New query → paste the whole file → Run.
   "Success. No rows returned" is right. Running it again is harmless.

2. **Email sign-in.** Authentication → **Sign In / Providers**:
   - **Allow new users to sign up**: on (otherwise a new address gets "Signing in
     is switched off right now").
   - Email provider → **Enable Email provider**: on.
   - **Confirm email**: leave on. Typing the code confirms the address.
   - **Email OTP Length**: **6**. The app's code box takes exactly six digits.
   - **Email OTP Expiration**: **900** seconds (15 minutes) is a reasonable
     choice: long enough to switch to Mail and back on weak signal.

3. **Email templates.** Authentication → **Emails** → Templates. Edit both
   **Confirm signup** (a new address gets this one) and **Magic Link** (a
   returning address gets this one) so they show the code instead of a link.
   Replace `{{ .ConfirmationURL }}` with `{{ .Token }}`, for example:

   Subject: `Your TrailWaterMaps sign-in code`

   ```html
   <h2>Your sign-in code</h2>
   <p>Enter this code in TrailWaterMaps:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>It works once and expires in 15 minutes. If you didn't ask for it, you can ignore this email.</p>
   ```

   If a template still has the link, people get a link, which on an iPhone
   opens Safari instead of the home-screen app.

4. **Site URL.** Authentication → **URL Configuration** → **Site URL**:
   `https://trailwatermaps.com`. Code sign-in doesn't redirect anywhere, but
   Supabase puts this in its emails. Keep
   `https://driftlesseurofisher.github.io/FlyFish-Float/` in the **Redirect
   URLs** list while GitHub Pages still runs, and remove it when it stops.

5. **Resend, on trailwatermaps.com.** (This only adds email records; the site
   stays on GitHub Pages and nothing about it moves.)
   - Create a Resend account. **Domains → Add Domain** → `trailwatermaps.com`.
   - Resend lists DNS records (a DKIM TXT record at `resend._domainkey`, and an
     MX and an SPF TXT record on a `send` subdomain). In Cloudflare →
     trailwatermaps.com → **DNS → Records**, add each exactly as shown, proxy
     status **DNS only**. Back in Resend, wait for **Verified**.
   - **API Keys → Create API Key**, permission **Sending access**, limited to
     trailwatermaps.com. Copy it once; it is the SMTP password below. It is a
     secret: it goes in the Supabase dashboard only, never in the app or git.

6. **Custom SMTP in Supabase.** Authentication → **Emails** → **SMTP Settings**
   → enable **Custom SMTP**:
   - Sender email `login@trailwatermaps.com`, sender name `TrailWaterMaps`
   - Host `smtp.resend.com`, port `465`, username `resend`, password = the
     Resend API key
   - **Minimum interval between emails** (per user): 60 seconds, which matches
     the app's "Resend code" countdown.

7. **Raise the email rate limit.** Authentication → **Rate Limits** → **Rate
   limit for sending emails**. The built-in sender allows only a handful an
   hour; with custom SMTP set, raise it (for example 100 an hour). Resend's
   free plan sends 100 a day and 3,000 a month.

8. **Make yourself admin.** In the app, tap the person button and sign in with
   your own address once. Then in the SQL Editor run the last line of
   `auth.sql` with your address in it. Open `admin.html` (same browser) and
   you should see the counts and the reports.

9. **Run `metrics.sql`** (after `auth.sql`). SQL Editor → New query → paste
   the whole file → Run. Until it has run, the app keeps its stats queued on
   each phone and the admin page's Usage section says it isn't set up. Then
   open `admin.html`: the Usage section should load (empty at first). Check
   the size of `public.events` now and then (the query is at the top of the
   file).

10. **Two-factor sign-in.** Now: turn it on for your **supabase.com** account
   (your account menu → account preferences → security; the exact menu name
   wasn't checked), and for GitHub, Resend and Cloudflare. These protect the
   SQL Editor and the secret keys, which matter more than the app's admin
   page. Later: app-level two-factor for admin accounts (Supabase Auth MFA
   with an authenticator app), with `is_admin()` also requiring the session's
   `aal` claim to be `aal2`.

11. **Try it.** Sign in on your phone; type a wrong code; use **Resend code**;
    set a display name; sign out. Make a throwaway account with another address
    and delete it from the account sheet, then check Authentication → Users
    that it is gone. Check the email comes from `login@trailwatermaps.com`.

### Traps worth knowing

Found doing the checklist for real (2026-10-19):

- **Templates can't be edited until custom SMTP is on.** Supabase now locks
  the email templates behind custom SMTP, so do steps 5–6 (Resend, SMTP)
  before step 3 (templates). Until then every email carries a link, not a
  code, and the app's code sign-in can't work.
- **Each template has a Save changes button at the bottom of its page.** An
  edited template that looks right in the preview is not in use until saved;
  reopen the page to confirm the new subject stuck.
- **Resend's DNS records are CNAMEs now** (`send` and `rsend` →
  `*.forge.rmta.net`, plus the `resend._domainkey` TXT), not the MX/SPF pair
  older guides show. Follow Resend's own list.
- **In Cloudflare they must be DNS only (grey cloud).** Proxied, Cloudflare
  answers with its own web servers and Resend never verifies. The DKIM TXT
  verified at once; the two CNAMEs sat at "pending" until unproxied.
- **The Resend API key is shown once,** in the pop-up right after Create.
  Missed it: delete that key and create another.

- **Before custom SMTP is set,** Supabase's built-in email only delivers to
  members of your Supabase organization and only a few an hour. A tester's
  address gets "Email address not authorized" (the app says "Sign-in email
  isn't set up for this address yet").
- **iPhone storage is split:** the home-screen app and Safari each sign in on
  their own, and `admin.html` opened in Safari needs its own sign-in.
- **A paused project** (no activity for about a week on the free plan) answers
  nothing; the app says the sign-in service "is asleep or unreachable". The
  keep-alive workflow prevents it; if it fails, GitHub emails you, and the fix
  is **Restore** in the dashboard.
- **If `delete_my_account()` fails with "permission denied for table users",**
  the platform no longer lets SQL-owned functions delete from `auth.users`.
  The fallback is an Edge Function that calls the Auth admin API with the
  service-role key, which stays on the server.
- **Old report statuses:** the status check was added `not valid`, so any old
  row with a status other than new / fixed / wontfix stays as it is (the admin
  counts list it separately). See the comment in `auth.sql` to tidy up and
  validate.
