-- First-party usage stats, kept in this project rather than a third-party counter.
-- Paste into Supabase: SQL Editor -> New query -> Run, AFTER auth.sql (it
-- uses public.is_admin()). Safe to run again: every statement replaces or
-- skips what an earlier run made.
--
-- Read supabase/README.md ("Step: first-party metrics") for the why. The
-- browser side is js/metrics.js; the admin page's Usage section reads
-- admin_metrics() below.
--
-- What a row is: one thing someone did in the app (a launch, a river or
-- lake opened, a region looked at, a feature used), from one phone. Each
-- phone carries one lasting random id (device_id); while someone is signed
-- in, their account id rides along too (user_id). So for a signed-in user
-- this is a history of the rivers and lakes they open and the regions they
-- look at. Only admins can read it (RLS below), and delete_my_account()
-- erases it.
--
-- Storage, roughly (measured on a local Postgres 16 with 100,000 rows of
-- the app's own shape, table plus its five indexes): about 240 bytes a row.
-- A launch writes about 6-10 rows (the launch, a region or two, a few
-- rivers or lakes opened, the odd feature), so call it 2 KB a launch.
-- The free plan's database is 500 MB, shared with everything else, so
-- about 200,000 launches fit before this table alone fills it:
--     50 launches a day   -> about 11 years
--    500 launches a day   -> about a year
--  2,000 launches a day   -> about 3 months
-- Check the size now and then (Database -> Tables, or
--   select pg_size_pretty(pg_total_relation_size('public.events'));
-- ) and switch on the retention line at the bottom of this file before it
-- matters. Nothing is deleted automatically yet. Speed, from the same test:
-- admin_metrics() over a window holding 100,000 rows answers in about a
-- second, which is the other sign that it's time for retention (or for
-- daily roll-ups).


-- ---------------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),    -- when the server got it
  device_id   uuid not null,                         -- the phone's lasting random id
  -- The account, when the event was recorded signed in. The app's
  -- delete_my_account() deletes these rows first; `set null` is the
  -- fallback rule every table referencing auth.users needs, so a delete
  -- made any other way (the dashboard) can't fail on this table.
  user_id     uuid references auth.users (id) on delete set null,
  kind        text not null check (kind in (
                'launch', 'river_open', 'lake_open', 'region_view', 'zone_pick',
                'fieldbook_open', 'trip_logged', 'favourite_add',
                'float_start', 'float_end', 'laketrip_start', 'laketrip_end',
                'offline_save', 'report_sent', 'signin', 'signout',
                'tour_start', 'layer_on', 'gauge_tap')),
  -- A river or lake id, a state or park zone code, a Jump-to entry, a
  -- Map Icons chip id, a gauge, or a feature detail.
  target      text check (target is null or (
                char_length(target) between 1 and 64 and target !~ '[[:cntrl:]]')),
  -- The target's name as the app showed it ("Snake River", "Idaho"), so
  -- admin.html can show names without loading the app's 3.7 MB river data.
  name        text check (name is null or (
                char_length(name) between 1 and 120 and name !~ '[[:cntrl:]]')),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  standalone  boolean,                               -- home-screen app (true) or a browser tab
  -- When the phone recorded it. Events wait on the phone while it's
  -- offline, so this can be well before created_at; a phone clock more
  -- than a day fast, or an event over 30 days old, is refused. Measured
  -- against created_at, not now(), so a backup restore re-checks every row
  -- the same way it was checked on the day it arrived.
  client_at   timestamptz constraint events_client_at_check check (client_at is null or (
                client_at <= created_at + interval '1 day'
                and client_at >= created_at - interval '30 days'))
);

create index if not exists events_created_at_idx on public.events (created_at);
create index if not exists events_kind_created_idx on public.events (kind, created_at);
create index if not exists events_device_idx on public.events (device_id);
-- For delete_my_account() and the signed-in counts, and so the `set null`
-- rule doesn't scan the whole table on every account deletion.
create index if not exists events_user_idx on public.events (user_id) where user_id is not null;

alter table public.events enable row level security;

-- Anyone may record, signed in or not; a row may carry no account or the
-- caller's own, never someone else's. Insert only: nobody reads events
-- back through the app's key.
drop policy if exists "anyone can record usage" on public.events;
create policy "anyone can record usage" on public.events
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

-- Admins can read rows (the admin page itself only calls admin_metrics()).
drop policy if exists "admins read usage" on public.events;
create policy "admins read usage" on public.events
  for select to authenticated
  using ((select public.is_admin()));

-- Revoke first, so the column grant below is the only insert right: the
-- app can't set created_at (or id, which is generated always). The select
-- grant exists only for the admin policy above; RLS hands everyone else
-- zero rows, and anon has no select at all. No update, no delete: what was
-- recorded can't be changed through the app, only erased by
-- delete_my_account().
revoke all on public.events from anon, authenticated;
grant insert (device_id, user_id, kind, target, name, app_version, standalone, client_at)
  on public.events to anon, authenticated;
grant select on public.events to authenticated;


-- ---------------------------------------------------------------------------
-- delete_my_account(), now erasing the usage history too.
-- KEEP THIS FUNCTION IDENTICAL IN auth.sql AND metrics.sql, so running
-- either file again leaves the same function behind. (The events delete is
-- skipped when the table doesn't exist, which is what lets auth.sql carry
-- it before this file has ever been run.)
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- Usage stats: every event sent signed in as this user, and every event,
  -- signed in or not, from any phone that ever sent one signed in as them.
  -- The phone makes itself a new id afterwards (js/metrics.js), so what it
  -- sends from then on isn't joined to the history erased here.
  if pg_catalog.to_regclass('public.events') is not null then
    delete from public.events
     where user_id = uid
        or device_id in (select e.device_id from public.events e where e.user_id = uid);
  end if;
  -- Cascades to profiles, user_roles and Supabase's own sessions, refresh
  -- tokens and identities. Issue reports are not linked to accounts.
  delete from auth.users where id = uid;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;


-- ---------------------------------------------------------------------------
-- admin_metrics(): the Usage section on admin.html.
-- security definer so it can read every row; that is exactly why it checks
-- is_admin() itself before answering. `days` is the window for everything
-- except the active counts, which are always the last 1, 7 and 30 days.
-- `tz` is the admin's own time zone, so "a day" is their day (an unknown
-- name falls back to UTC). Windows are on created_at, the server's clock:
-- an event that waited on an offline phone counts on the day it arrived.
-- ---------------------------------------------------------------------------
create or replace function public.admin_metrics(days int default 30, tz text default 'UTC')
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n     int  := greatest(1, least(coalesce(admin_metrics.days, 30), 366));
  zone  text := coalesce(admin_metrics.tz, 'UTC');
  today date;
  since timestamptz;
  result json;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = zone) then
    zone := 'UTC';
  end if;
  -- From local midnight n-1 days ago: "30 days" is today plus 29 whole days.
  today := (now() at time zone zone)::date;
  since := (today - (n - 1))::timestamp at time zone zone;

  with w as (
    select e.created_at, e.device_id, e.user_id, e.kind, e.target, e.name,
           e.app_version, e.standalone, (e.created_at at time zone zone)::date as day
      from public.events e
     where e.created_at >= since
  )
  select json_build_object(
    'days', n,
    'tz', zone,
    'since', since,
    'events', (select count(*) from w),
    'devices', (select count(distinct device_id) from w),
    'users', (select count(distinct user_id) from w),
    -- seen on more than one day in the window
    'returning', (select count(*) from (
        select device_id from w group by device_id having count(distinct day) > 1) r),
    'active', (select json_build_object(
        'd1_devices',  count(distinct device_id) filter (where e.created_at > now() - interval '1 day'),
        'd1_users',    count(distinct user_id)   filter (where e.created_at > now() - interval '1 day'),
        'd7_devices',  count(distinct device_id) filter (where e.created_at > now() - interval '7 days'),
        'd7_users',    count(distinct user_id)   filter (where e.created_at > now() - interval '7 days'),
        'd30_devices', count(distinct device_id),
        'd30_users',   count(distinct user_id))
      from public.events e where e.created_at > now() - interval '30 days'),
    -- every day in the window, zeros included, so a chart has every bar
    'per_day', (select coalesce(json_agg(json_build_object(
          'day', g.d, 'launches', coalesce(x.launches, 0), 'devices', coalesce(x.devices, 0)) order by g.d), '[]'::json)
      from (select (today - i) as d from pg_catalog.generate_series(0, n - 1) as i) g
      left join (select day, count(*) filter (where kind = 'launch') as launches,
                        count(distinct device_id) as devices
                   from w group by day) x on x.day = g.d),
    'rivers', (select coalesce(json_agg(t), '[]'::json) from (
        select target, max(name) as name, count(*) as opens, count(distinct device_id) as devices
          from w where kind = 'river_open' and target is not null
         group by target order by count(*) desc, count(distinct device_id) desc, target limit 25) t),
    'lakes', (select coalesce(json_agg(t), '[]'::json) from (
        select target, max(name) as name, count(*) as opens, count(distinct device_id) as devices
          from w where kind = 'lake_open' and target is not null
         group by target order by count(*) desc, count(distinct device_id) desc, target limit 25) t),
    'regions', (select coalesce(json_agg(t), '[]'::json) from (
        select target, max(name) as name, count(*) as views, count(distinct device_id) as devices
          from w where kind = 'region_view' and target is not null
         group by target order by count(*) desc, count(distinct device_id) desc, target limit 25) t),
    'zone_picks', (select coalesce(json_agg(t), '[]'::json) from (
        select target, max(name) as name, count(*) as n, count(distinct device_id) as devices
          from w where kind = 'zone_pick' and target is not null
         group by target order by count(*) desc, target limit 25) t),
    'features', (select coalesce(json_agg(t), '[]'::json) from (
        select kind, count(*) as n, count(distinct device_id) as devices
          from w where kind not in ('launch', 'river_open', 'lake_open', 'region_view')
         group by kind order by count(*) desc, kind) t),
    'layers', (select coalesce(json_agg(t), '[]'::json) from (
        select target, count(*) as n, count(distinct device_id) as devices
          from w where kind = 'layer_on' and target is not null
         group by target order by count(*) desc, target) t),
    -- launches and phones, home-screen app against a browser tab
    'standalone', (select json_build_object(
        'app_launches',     count(*) filter (where standalone),
        'browser_launches', count(*) filter (where standalone is false),
        'app_devices',      count(distinct device_id) filter (where standalone),
        'browser_devices',  count(distinct device_id) filter (where standalone is false))
      from w where kind = 'launch'),
    'versions', (select coalesce(json_agg(t), '[]'::json) from (
        select coalesce(app_version, '(none)') as app_version, count(*) as launches,
               count(distinct device_id) as devices
          from w where kind = 'launch'
         group by 1 order by count(*) desc, 1 limit 20) t)
  ) into result;
  return result;
end;
$$;

revoke execute on function public.admin_metrics(int, text) from public, anon;
grant execute on function public.admin_metrics(int, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Retention, for when the table grows (see the storage note at the top).
-- Not switched on. To keep, say, 13 months, run this by hand now and then,
-- or schedule it (Database -> Cron, the pg_cron extension):
-- ---------------------------------------------------------------------------
-- delete from public.events where created_at < now() - interval '13 months';
