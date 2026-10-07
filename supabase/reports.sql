-- Issue reports from the app's "Report an issue" form.
-- Paste into Supabase: SQL Editor -> New query -> Run.
-- Anyone may send a report; nobody can read them through the app's public
-- key. You read them in the dashboard (Table Editor -> reports), which uses
-- your own login, not the anon key.

create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  river_id    text check (river_id is null or char_length(river_id) <= 64),
  river_name  text check (river_name is null or char_length(river_name) <= 120),
  issue       text not null check (char_length(issue) between 3 and 2000),
  email       text check (email is null or (char_length(email) <= 200
                     and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  status      text not null default 'new'   -- for you: new / fixed / wontfix
);

alter table public.reports enable row level security;

-- Insert only. There is deliberately no select, update or delete policy,
-- so the public key can add a report but never read one back (reporters'
-- email addresses stay private).
drop policy if exists "anyone can send a report" on public.reports;
create policy "anyone can send a report" on public.reports
  for insert to anon, authenticated
  with check (status = 'new');

-- Newer Supabase projects don't grant table access to the public roles by
-- default, so the policy above has nothing to act on without this. Insert
-- only: no select, so reports can't be read back with the public key.
grant insert on public.reports to anon, authenticated;
