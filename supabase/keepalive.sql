-- Keep-alive for the free Supabase project, which pauses after about a week
-- with no activity. A GitHub Actions job (.github/workflows/supabase-keepalive.yml)
-- calls this every 3 days. It reads nothing and writes nothing.
-- Paste into Supabase: SQL Editor -> New query -> Run.
create or replace function public.keepalive()
returns timestamptz
language sql stable
as $$ select now() $$;

grant execute on function public.keepalive() to anon, authenticated;
