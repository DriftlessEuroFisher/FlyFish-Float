-- Accounts (Server roadmap step 1) and admin roles (the base of step 8).
-- Paste into Supabase: SQL Editor -> New query -> Run. Safe to run again:
-- every statement replaces or skips what an earlier run made.
--
-- Read supabase/README.md first; it explains each choice below and lists
-- the dashboard settings that go with this file.
--
-- Two rules this project lives by:
--  * Row-level security (RLS) on every table, AND explicit grants. This
--    project grants the public roles (anon = signed out, authenticated =
--    signed in) no table access by default, so a policy with no grant does
--    nothing, and a grant with no policy returns nothing.
--  * Functions that must see past RLS are `security definer` with
--    `set search_path = ''` and fully qualified names, so a caller can't
--    plant a same-named table or function earlier on the search path.


-- ---------------------------------------------------------------------------
-- Profiles: one row per account, made by a trigger when the account is made.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  -- Stored trimmed, 1-40 characters, no control characters (newlines, tabs):
  -- this will be shown to other people in step 2. Null = not set.
  display_name text check (display_name is null or (
                 display_name = btrim(display_name)
                 and char_length(display_name) between 1 and 40
                 and display_name !~ '[[:cntrl:]]')),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A user sees and edits only their own row. Display names are not visible
-- to anyone else yet: step 2 (user-submitted access points) will add a
-- read policy for them, and the email never becomes visible (it isn't in
-- this table at all; it stays in auth.users).
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Revoke first so the column grant below is the only update right: a
-- table-level UPDATE would cover every column, id included. No insert
-- (the trigger makes the row) and no delete (deleting the account does).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- The trigger. It runs as its owner (security definer) because the new user
-- has no insert right on profiles. Keep it tiny: if it fails, sign-up fails
-- ("Database error saving new user").
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Accounts made before this file ran (e.g. from the dashboard) get a row too.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- Roles. In a table, never in user_metadata: a signed-in user can rewrite
-- their own user_metadata with one API call, so a role kept there is a role
-- anyone can give themselves.
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'moderator')),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;

drop policy if exists "read own roles" on public.user_roles;
create policy "read own roles" on public.user_roles
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Select only. There is deliberately no insert, update or delete grant:
-- roles are granted in the SQL Editor (see the last line of this file),
-- which runs as the project owner, never through the app's key.
revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;


-- ---------------------------------------------------------------------------
-- is_admin(): the one question every admin policy asks.
-- security definer so it reads user_roles whatever that table's own policies
-- say (a future "admins read all roles" policy that called is_admin() would
-- otherwise recurse). auth.uid() still answers for the caller: it reads the
-- request's JWT, not the function owner.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- Reports: admins can now read them and change their status. The existing
-- "anyone can send a report" insert policy and its insert grant
-- (supabase/reports.sql) are left exactly as they are.
-- ---------------------------------------------------------------------------
drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports" on public.reports
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists "admins triage reports" on public.reports;
create policy "admins triage reports" on public.reports
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Any signed-in user holds these grants, but RLS hands a non-admin zero rows
-- to read and zero rows to update. Status is the only column anyone may
-- change; the reporter's words and email can't be edited after the fact.
revoke update on public.reports from authenticated;
grant select on public.reports to authenticated;
grant update (status) on public.reports to authenticated;

-- Status is one of three words from now on. NOT VALID: new and changed rows
-- are checked, rows already there are not, so an old row with some other
-- status can't make this file fail. To check them:
--   select status, count(*) from public.reports group by status;
-- and once every row is new / fixed / wontfix:
--   alter table public.reports validate constraint reports_status_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass and conname = 'reports_status_check'
  ) then
    alter table public.reports
      add constraint reports_status_check
      check (status in ('new', 'fixed', 'wontfix')) not valid;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- delete_my_account(): the account sheet's "Delete my account".
-- Deleting the auth.users row cascades to profiles and user_roles (above)
-- and to Supabase's own sessions, refresh tokens and identities. Issue
-- reports are not linked to accounts and are not touched.
-- Any future table that references auth.users must say what happens on
-- delete (cascade or set null), or this delete will fail.
-- KEEP THIS FUNCTION IDENTICAL IN auth.sql AND metrics.sql, so running
-- either file again leaves the same function behind. The usage-stats
-- delete is skipped while public.events doesn't exist (before metrics.sql
-- has been run).
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
-- admin_stats(): the counts on admin.html. Usage counts only, no analytics.
-- security definer because it counts auth.users, which no app role can read;
-- that is exactly why it checks is_admin() itself before answering.
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return json_build_object(
    'users_total', (select count(*) from auth.users),
    'users_7d',    (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'reports',     coalesce(
                     (select json_object_agg(status, n)
                        from (select status, count(*) as n from public.reports group by status) s),
                     '{}'::json)
  );
end;
$$;

revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;


-- ---------------------------------------------------------------------------
-- Make yourself admin: sign in once in the app (so your account exists),
-- then put your address in and run this line on its own. "Success. No rows
-- returned" is normal; check with: select * from public.user_roles;
-- ---------------------------------------------------------------------------
-- insert into public.user_roles (user_id, role) select id, 'admin' from auth.users where email = '<your email>' on conflict do nothing;
